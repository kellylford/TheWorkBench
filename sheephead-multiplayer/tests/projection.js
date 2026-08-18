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
  if (st.lastTrick) (st.lastTrick.plays || []).forEach(p => ok.add(p.card.id || p.card));

  if (st.picker === seat) {            // the picker's own business
    add(st.buried);
    (st.pickedUp || []).forEach(id => ok.add(id));
  }
  if (st.phase === 'handOver') {       // everything is shown when the hand ends
    C.newDeck([]).forEach(c => ok.add(c.id));
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

/* Drive two games identically. Because the seed is reset, both get the same
 * deal; the only difference is where the Jack of Diamonds sits. */
function twin(n, atSeed, moveJack) {
  const st = game(n, atSeed);

  const picker = st.turn;
  const viewer = (picker + 2) % n;

  if (moveJack) {
    // Move it between two seats that are neither the viewer nor the picker, so
    // the partnership changes and nothing the viewer is entitled to does.
    const candidates = [];
    for (let i = 0; i < n; i++) if (i !== viewer && i !== picker) candidates.push(i);
    let from = -1, at = -1;
    for (const i of candidates) {
      const k = st.players[i].hand.findIndex(c => c.id === 'JD');
      if (k >= 0) { from = i; at = k; break; }
    }
    if (from >= 0) {
      const to = candidates.find(i => i !== from);
      const swapAt = st.players[to].hand.findIndex(c => c.id !== 'JD');
      if (to !== undefined && swapAt >= 0) {
        const tmp = st.players[from].hand[at];
        st.players[from].hand[at] = st.players[to].hand[swapAt];
        st.players[to].hand[swapAt] = tmp;
      }
    }
  }

  G.applyAction(st, picker, { type: 'pick' });
  const bury = C.ids(st.players[picker].hand).filter(id => id !== 'JD').slice(0, G.DEAL[n].blind);
  G.applyAction(st, picker, { type: 'bury', cards: bury });
  return { st, picker, viewer };
}

for (const n of [4, 5, 6]) {
  for (let round = 0; round < 30; round++) {
    const s = 900 + round * 17;
    const a = twin(n, s, false);
    const b = twin(n, s, true);

    check(a.viewer === b.viewer && a.picker === b.picker, `${n}p: twins disagreed on seats`);

    // Same deal, so the viewer's own hand must be identical — if this fails the
    // counterfactual is not controlled and the comparison below proves nothing.
    check(JSON.stringify(C.ids(a.st.players[a.viewer].hand)) ===
          JSON.stringify(C.ids(b.st.players[b.viewer].hand)),
      `${n}p: the twins were not dealt the same hand — the counterfactual is uncontrolled`);

    // The thing that must differ, or the test is vacuous.
    const moved = a.st.partner !== b.st.partner || a.st.alone !== b.st.alone;

    const va = JSON.stringify(V.forSeat(a.st, a.viewer));
    const vb = JSON.stringify(V.forSeat(b.st, b.viewer));
    check(va === vb,
      `${n}p: a bystander's view changed when the Jack moved — the partnership is visible in the projection`);

    // Events too: the private sentence the picker gets must not reach the viewer.
    const ea = JSON.stringify(G.eventsFor(a.st, a.viewer));
    const eb = JSON.stringify(G.eventsFor(b.st, b.viewer));
    check(ea === eb,
      `${n}p: a bystander's events changed when the Jack moved`);

    if (moved) {
      // ...and the picker, who is entitled, does see the difference. Otherwise
      // the two views could be identical because the projection sends nothing.
      const pa = JSON.stringify(V.forSeat(a.st, a.picker));
      const pb = JSON.stringify(V.forSeat(b.st, b.picker));
      const epa = JSON.stringify(G.eventsFor(a.st, a.picker));
      const epb = JSON.stringify(G.eventsFor(b.st, b.picker));
      check(pa !== pb || epa !== epb,
        `${n}p: the picker could not tell the partnership apart either — the projection may be sending nothing at all`);
    }
  }
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
