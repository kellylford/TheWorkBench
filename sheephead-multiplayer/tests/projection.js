/* What one seat is allowed to see.
 *
 * This is the test the multiplayer build exists or fails on. Everything else can
 * be fixed in a patch release; a projection leak means people have been playing
 * a game where the cards were visible to anyone who opened developer tools, and
 * no apology puts that back.
 *
 * Three things are checked, and the third is the one that catches real bugs:
 *
 *   1. Entitlement — no card id appears in a seat's view unless that seat is
 *      entitled to know it.
 *   2. Completeness — every top-level key of `state` has been given an explicit
 *      ruling. The projection is an allowlist, and the failure mode of an
 *      allowlist is that somebody adds a field to createGame and never thinks
 *      about this file. So the ruling list lives here and the test fails on any
 *      key it has not seen.
 *   3. Indistinguishability — two games differing ONLY in hidden information
 *      must produce byte-identical views for a seat that is not entitled to that
 *      information. This is what catches leaks through absence: `partner: -1`
 *      versus the key being missing, `buried: []` versus undefined, an array
 *      length, a key order. Checking "the secret is not present" cannot catch
 *      any of those; checking "the two are the same string" catches all of them.
 *
 * The counterfactuals are CONSTRUCTED, not sampled. You cannot hold a deal fixed
 * while moving the Jack of Diamonds by dealing twice and hoping. The seed is
 * reset so both games get the same deal, and then one of them has the Jack moved
 * between two seats that are neither the viewer nor the picker.
 *
 *   node tests/projection.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 4242;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, setTimeout, Set };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, AI, Cards: C, View: V } = sandbox.SH;

let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const NAMES = ['You', 'A', 'B', 'C', 'D', 'E'];

function game(n, atSeed) {
  if (atSeed !== undefined) seed = atSeed;
  const st = G.createGame({
    numPlayers: n, names: NAMES.slice(0, n),
    allPass: 'leaster', difficulty: 'hard',
    blackQueenDoubler: true, redQueenDoubler: true, redealDoubler: true,
    // Keys that have no business crossing the wire, present so the test can
    // prove they do not.
    name: 'Kelly', pace: 4000, verbose: true, skin: 'traditional', layout: 'auto'
  });
  G.newHand(st);
  return st;
}

/* ---------------- 1. Every field of state has a ruling ---------------- */

/* Each top-level key of `state`, and what the projection decided about it. The
 * point is not the values — it is that adding a field to createGame without
 * touching js/view.js fails here, loudly, instead of shipping. */
const RULINGS = {
  config: 'allowlisted to room-level rules',
  players: 'per-seat: own hand in full, others as counts',
  dealer: 'public',
  handNumber: 'public',
  phase: 'public',
  turn: 'public',
  blind: 'count only, never contents',
  buried: 'picker only, until handOver',
  picker: 'public',
  partner: 'withheld until the sides are known',
  alone: 'withheld until the sides are known',
  partnerRevealed: 'public',
  isLeaster: 'public',
  passCount: 'public',
  trick: 'public',
  leader: 'public',
  lastTrick: 'public',
  played: 'public',
  result: 'public; only ever set at handOver',
  events: 'not here — G.eventsFor(state, seat) projects these',
  history: 'excluded; two summary numbers instead',
  dealt: 'handOver only — the snapshot of every hand as dealt',
  pickLog: 'public: who picked or passed, not what they hold',
  pickedUp: 'picker only',
  trickLog: 'public',
  doublers: 'handOver only — entries name their holder',
  redealDoubler: 'public (this hand is doubled)',
  nextHandDoubler: 'public',
  revealInfo: 'public; created at the moment of reveal'
};

{
  const st = game(5);
  const unruled = Object.keys(st).filter(k => !(k in RULINGS));
  check(unruled.length === 0,
    'state has fields the projection has never ruled on: ' + unruled.join(', ') +
    ' — add them to js/view.js and to RULINGS here');

  const stale = Object.keys(RULINGS).filter(k => !(k in st));
  check(stale.length === 0, 'RULINGS names fields that no longer exist: ' + stale.join(', '));
}

/* ---------------- 2. Entitlement ---------------- */

/* Which card ids a seat may legitimately know about at this moment. */
function entitled(st, seat) {
  const ok = new Set();
  const add = cards => (cards || []).forEach(c => ok.add(c.id || c));

  add(st.players[seat].hand);          // own hand
  add(st.played);                      // everything played is on the table
  st.trick.forEach(t => ok.add(t.card.id));

  if (st.picker === seat) {            // the picker's own business
    add(st.buried);
    (st.pickedUp || []).forEach(id => ok.add(id));
  }
  /* At hand end the deal opens up — but only the deal. Granting the whole deck
   * here made this check vacuous at exactly the phase where dealt, buried,
   * doublers and result all become visible, which is the phase most worth
   * checking. Naming the specific sources means a handOver view that ships
   * something BEYOND them still fails. */
  if (st.phase === 'handOver' && st.dealt) {
    st.dealt.hands.forEach(h => h.forEach(id => ok.add(id)));
    st.dealt.blind.forEach(id => ok.add(id));
    add(st.buried);
  }
  return ok;
}

function leakedIds(view, allowed) {
  const text = JSON.stringify(view);
  const found = [];
  for (const c of C.newDeck([])) {
    // Card ids are two characters and the view carries no prose, so a bare
    // substring search is exact enough — and errs toward false positives, which
    // is the right direction for this particular test to err in.
    if (!allowed.has(c.id) && new RegExp('"' + c.id + '"').test(text)) found.push(c.id);
  }
  return found;
}

for (const n of [3, 4, 5, 6]) {
  for (let round = 0; round < 40; round++) {
    const st = game(n);
    let guard = 0;

    // Walk the whole hand, checking every seat's view at every step. Not just
    // phase boundaries: a leak that exists for one trick is still a leak.
    while (guard++ < 400) {
      for (let seat = 0; seat < n; seat++) {
        const view = V.forSeat(st, seat);
        const bad = leakedIds(view, entitled(st, seat));
        check(bad.length === 0,
          `${n}p ${st.phase}: seat ${seat} was shown cards it may not know: ${bad.join(', ')}`);

        // Other seats are counts, never cards.
        for (let i = 0; i < n; i++) {
          if (i === seat) continue;
          check(view.players[i].hand.length === st.players[i].hand.length,
            `${n}p: seat ${seat} got the wrong card count for seat ${i}`);
          check(view.players[i].hand.every(c => c.hidden === true && c.id === undefined),
            `${n}p: seat ${seat} received real cards for seat ${i}`);
        }
        // Own hand is intact and usable.
        check(JSON.stringify(C.ids(view.players[seat].hand)) === JSON.stringify(C.ids(st.players[seat].hand)),
          `${n}p: seat ${seat} did not get its own hand`);

        // Private client settings never cross.
        for (const k of ['name', 'pace', 'verbose', 'skin', 'layout']) {
          check(!(k in view.config), `${n}p: config.${k} was sent to seat ${seat}`);
        }
        check(view.config.allPass !== undefined, `${n}p: room rules were dropped from config`);

        // History is summarised, not shipped.
        check(view.history === undefined, `${n}p: history was sent to seat ${seat}`);
        check(typeof view.handsPlayed === 'number', `${n}p: handsPlayed missing`);
      }
      if (st.phase === 'handOver') break;
      AI.act(st);
    }

    // At handOver the deal is finally revealed, or the review screen has nothing
    // to show. A projection that never opens up is as broken as one that leaks.
    const over = V.forSeat(st, 0);
    check(over.dealt !== null, `${n}p: the deal was still hidden at handOver`);
    check(over.result !== null, `${n}p: the result was withheld at handOver`);
    check(over.buried.length === st.buried.length, `${n}p: the bury was still hidden at handOver`);
  }
}

/* ---------------- 3. Indistinguishability ---------------- */

/* Two games that differ ONLY in something hidden must look byte-identical to a
 * seat not entitled to it.
 *
 * The previous version of this section varied exactly one fact — the Jack of
 * Diamonds moved between two bystanders — and anchored its anti-vacuity check on
 * the picker being able to tell the difference. Both were wrong, and each hid the
 * other:
 *
 *   - Moving the Jack between two BYSTANDERS never changes `alone`. So `alone`
 *     had no counterfactual at all, and broadcasting it to the whole table passed
 *     the entire suite.
 *   - The only thing that let the picker distinguish the twins was `view.partner`
 *     — which the picker is not entitled to. The anti-vacuity check was anchored
 *     on a leak, so fixing the leak broke the test. That is the shape of a test
 *     written to agree with the code rather than with the rules.
 *
 * So: several families, each varying a different secret, and the anchor moved to
 * the one partnership fact the picker legitimately holds — whether they are
 * alone.
 *
 * Everything is compared at the moment just after the bury. That is where the
 * most hidden information exists and where no behaviour has diverged yet; once
 * play starts the twins legitimately diverge, because a bot that knows a
 * different partner correctly plays differently, and comparing past that point
 * would be measuring the AI rather than the projection.
 */

function seatsExcept(n, excluded) {
  const out = [];
  for (let i = 0; i < n; i++) if (excluded.indexOf(i) < 0) out.push(i);
  return out;
}

function findCard(st, seats, id) {
  for (const i of seats) {
    const k = st.players[i].hand.findIndex(c => c.id === id);
    if (k >= 0) return { seat: i, at: k };
  }
  return null;
}

function swapCards(st, a, b) {
  const tmp = st.players[a.seat].hand[a.at];
  st.players[a.seat].hand[a.at] = st.players[b.seat].hand[b.at];
  st.players[b.seat].hand[b.at] = tmp;
}

/* Build one half of a twin pair. `mutate` runs before the pick, on the same deal.
 * Returns null when the mutation could not be applied, so the caller can count
 * how often the counterfactual was real rather than silently comparing two
 * identical games and calling it a pass. */
function half(n, atSeed, mutate, buryPick) {
  const st = game(n, atSeed);
  const picker = st.turn;
  const touched = mutate ? mutate(st, picker) : [];
  if (touched === false) return null;

  G.applyAction(st, picker, { type: 'pick' });
  const hand = C.ids(st.players[picker].hand);
  const d = G.DEAL[n];
  const bury = buryPick ? buryPick(hand, d) : hand.filter(id => id !== 'JD').slice(0, d.blind);
  if (bury.length !== d.blind) return null;
  const r = G.applyAction(st, picker, { type: 'bury', cards: bury });
  if (!r.ok) return null;
  return { st, picker, touched: touched || [] };
}

function family(label, n, mutate, opts) {
  opts = opts || {};
  const floor = opts.floor === undefined ? 5 : opts.floor;
  let real = 0, rounds = 0;

  for (let round = 0; round < 40; round++) {
    const atSeed = 7000 + round * 23 + n * 101;
    const a = half(n, atSeed, null, opts.buryA);
    const b = half(n, atSeed, mutate, opts.buryB);
    if (!a || !b) continue;
    rounds++;

    // The mutation has to have actually changed a secret, or the comparison is
    // two identical games agreeing with each other.
    if (!opts.changed(a.st, b.st)) continue;
    real++;

    /* Every seat that is not entitled — but a seat whose OWN HAND the mutation
     * changed is entitled by definition, because a player may always see their
     * own cards. Excluding them is not weakening the test: including them was
     * asserting that moving a card out of somebody's hand is invisible to them,
     * which is neither true nor desirable. */
    const entitledHere = opts.entitledSeats(a).concat(a.touched, b.touched);
    const bystanders = seatsExcept(n, entitledHere);
    for (const seat of bystanders) {
      const va = JSON.stringify(V.forSeat(a.st, seat));
      const vb = JSON.stringify(V.forSeat(b.st, seat));
      check(va === vb, label + ' ' + n + 'p: seat ' + seat + ' saw a difference it may not see');

      const ea = JSON.stringify(G.eventsFor(a.st, seat));
      const eb = JSON.stringify(G.eventsFor(b.st, seat));
      check(ea === eb, label + ' ' + n + 'p: seat ' + seat + ' got events it may not have');
    }

    if (opts.pickerMustSee) {
      const pa = JSON.stringify(V.forSeat(a.st, a.picker)) + JSON.stringify(G.eventsFor(a.st, a.picker));
      const pb = JSON.stringify(V.forSeat(b.st, b.picker)) + JSON.stringify(G.eventsFor(b.st, b.picker));
      check(pa !== pb,
        label + ' ' + n + 'p: the picker could not tell either — the projection may be sending nothing at all');
    }
  }

  // A family that never fired proves nothing, and would go on printing success.
  check(real >= floor,
    label + ' ' + n + 'p: the counterfactual fired only ' + real + ' times in ' + rounds +
    ' usable rounds — too few to be evidence');
  return real;
}

for (const n of [3, 4, 5, 6]) {
  if (G.DEAL[n].partner) {
    /* A. The Jack moves between two bystanders: the partner's IDENTITY changes
     *    and nothing else. NOBODY may see a difference, the picker included —
     *    they know they have a partner, never which seat. */
    family('jack between bystanders', n, function (st, picker) {
      const cands = seatsExcept(n, [picker]);
      const found = findCard(st, cands, 'JD');
      if (!found) return false;
      const to = cands.find(i => i !== found.seat);
      if (to === undefined) return false;
      const at = st.players[to].hand.findIndex(c => c.id !== 'JD');
      if (at < 0) return false;
      swapCards(st, found, { seat: to, at: at });
      return [found.seat, to];
    }, {
      changed: function (a, b) { return a.partner !== b.partner; },
      entitledSeats: function () { return []; },
      floor: 3
    });

    /* B. The Jack moves into the picker's own hand: `alone` flips. Bystanders
     *    must not see it; the picker MUST, because they can see their own hand.
     *    This is the anchor that stops every check here passing vacuously. */
    family('jack into the picker hand', n, function (st, picker) {
      const found = findCard(st, seatsExcept(n, [picker]), 'JD');
      if (!found) return false;
      const at = st.players[picker].hand.findIndex(c => c.id !== 'JD');
      if (at < 0) return false;
      swapCards(st, found, { seat: picker, at: at });
      return [found.seat, picker];
    }, {
      changed: function (a, b) { return a.alone !== b.alone; },
      entitledSeats: function (a) { return [a.picker]; },
      pickerMustSee: true,
      floor: 3
    });
  }

  /* C. Same deal, DIFFERENT bury. Catches anything derived from the bury — its
   *    point value, its suits, how much trump went down. None of that is a card
   *    id, so the entitlement scan is blind to all of it. */
  family('a different bury', n, null, {
    buryA: function (hand, d) { return hand.slice(0, d.blind); },
    buryB: function (hand, d) { return hand.slice(-d.blind); },
    changed: function (a, b) { return JSON.stringify(C.ids(a.buried)) !== JSON.stringify(C.ids(b.buried)); },
    entitledSeats: function (a) { return [a.picker]; },
    floor: 5
  });

  /* D. Two ordinary cards swapped between two bystanders. No partnership, no
   *    doubler, no bury — purely hand composition, which a projection could leak
   *    through a count, a suit tally or a sort order. */
  family('two ordinary cards swapped', n, function (st, picker) {
    const cands = seatsExcept(n, [picker]);
    if (cands.length < 2) return false;
    const x = cands[0], y = cands[1];
    const ax = st.players[x].hand.findIndex(c => c.id !== 'JD');
    const ay = st.players[y].hand.findIndex(c => c.id !== 'JD');
    if (ax < 0 || ay < 0) return false;
    swapCards(st, { seat: x, at: ax }, { seat: y, at: ay });
    return [x, y];
  }, {
    changed: function () { return true; },
    entitledSeats: function (a) { return [a.picker]; },
    floor: 5
  });
}

/* ---------------- 4. Doubler holders are not visible ---------------- */

for (const n of [4, 5]) {
  for (let round = 0; round < 25; round++) {
    const st = game(n, 5000 + round * 31);
    const picker = st.turn;
    const viewer = (picker + 1) % n;
    G.applyAction(st, picker, { type: 'pick' });
    const bury = C.ids(st.players[picker].hand).slice(0, G.DEAL[n].blind);
    G.applyAction(st, picker, { type: 'bury', cards: bury });

    if (!st.doublers.length) continue;

    const view = V.forSeat(st, viewer);
    check(view.doublers.length === 0,
      `${n}p: the doubler holders were shown to seat ${viewer} mid-hand`);
    const text = JSON.stringify(view);
    for (const d of st.doublers) {
      check(!new RegExp('"' + d.text + '"').test(text),
        `${n}p: a doubler's description leaked mid-hand`);
    }

    // The holder is told, privately.
    const holder = st.doublers[0].player;
    const own = JSON.stringify(G.eventsFor(st, holder));
    const other = JSON.stringify(G.eventsFor(st, holder === viewer ? (viewer + 1) % n : viewer));
    check(own.indexOf('counts double') >= 0, `${n}p: the doubler holder was not told`);
    check(other.indexOf('counts double') < 0, `${n}p: somebody else was told about the doubler`);
  }
}

/* ---------------- 5. Gates that guard against a future, not a present ----------------
 *
 * state.result is null outside handOver today, so removing its phase gate in
 * view.js changes nothing any hand can observe — which is precisely why it is
 * worth a direct test. result.summary is the most revealing string in the game:
 * it names the partner, says whether the picker was alone, and lists the bury and
 * the blind card by card. The first feature that computes a provisional result —
 * a concede button, a running score, an "are you sure?" — would ship the whole
 * hand through a field nothing was watching, and no play-through test could have
 * caught it because no play-through produces that state.
 *
 * So this fabricates the state the engine does not yet produce. */

{
  const st = game(5);
  const picker = st.turn;
  G.applyAction(st, picker, { type: 'pick' });
  G.applyAction(st, picker, { type: 'bury', cards: C.ids(st.players[picker].hand).slice(0, 2) });

  st.result = {
    leaster: false, pickerPts: 61, oppPts: 59, buriedPts: 12,
    pickerWins: true, mult: 1, factor: 1, label: 'won',
    deltas: [2, -1, -1, 2, -2],
    summary: 'A and B took 61 points. Buried: Queen of Clubs, Jack of Diamonds.'
  };
  st.dealt = st.dealt || { hands: [], blind: [] };

  for (let seat = 0; seat < 5; seat++) {
    const v = V.forSeat(st, seat);
    check(v.result === null,
      `a provisional result was shipped to seat ${seat} mid-hand — result.summary names the partner and lists the bury`);
    check(JSON.stringify(v).indexOf('Jack of Diamonds') < 0,
      `the provisional summary text reached seat ${seat}`);
  }

  // ...and it does arrive once the hand is genuinely over.
  st.phase = 'handOver';
  check(V.forSeat(st, 0).result !== null, 'the result was withheld at handOver');
}

/* dealt is gated the same way, and unlike result it CAN be non-null mid-hand:
 * deal() writes it at the start of every hand and it simply never goes away. */
{
  const st = game(5);
  check(st.dealt !== null, 'dealt was not written at deal time');
  for (let seat = 0; seat < 5; seat++) {
    check(V.forSeat(st, seat).dealt === null,
      `the deal snapshot — every hand as dealt — was shipped to seat ${seat} during the hand`);
  }
}

/* ---------------- report ---------------- */

if (fails.length) {
  console.error('\nFAILED:');
  [...new Set(fails)].slice(0, 25).forEach(f => console.error('  - ' + f));
  if (new Set(fails).size > 25) console.error(`  ... and ${new Set(fails).size - 25} more`);
  process.exit(1);
}
console.log('every field of state has an explicit ruling');
console.log('views checked at 3, 4, 5 and 6 players, every seat, every step of the hand');
console.log('constructed counterfactuals: moving the Jack changes nothing a bystander can see');
console.log('No seat was shown a card it was not entitled to.');
