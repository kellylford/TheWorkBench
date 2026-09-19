/* Who is allowed to act, and what a refusal must leave behind.
 *
 * Every other suite in this directory asks whether the engine plays the right
 * game. This one assumes it does and asks a different question: when a message
 * arrives from a player who is not entitled to send it, what happens?
 *
 * That question had never been asked here, and it had a bad answer. Single-player
 * hid it completely — the only seat that could reach the engine was the one a
 * person was sitting in, so "is this sender allowed to do this" was answered by
 * the architecture rather than by any code. Two of the three things this file now
 * pins were live defects when it was written:
 *
 *   1. doBury took no actor at all. It checked the phase and then acted on
 *      state.players[state.picker] no matter who asked. Any seat could bury the
 *      picker's cards.
 *
 *   2. A rejected bury was not atomic. doBury spliced each card out as it
 *      validated it and returned false on the first id it could not find, so
 *      [good, garbage] removed the good card and destroyed it — the picker was
 *      left one card short, permanently, in a phase that requires an exact count.
 *
 * Both are unreachable from the single-player UI and trivially reachable from a
 * network message. That gap is the entire subject of this file.
 *
 *   node tests/authorization.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

/* Seeded, because coverage that varies run to run is not coverage. With real
 * Math.random the play-phase section reached a leaster on some runs (no picker,
 * no bury phase, half the assertions skipped) and a normal hand on others, and
 * the illegal-card check sat behind an `if` that simply did not fire when the
 * seat on turn happened to hold only legal cards. */
let seed = 20260818;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, setTimeout, Set };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, AI, Cards: C } = sandbox.SH;

let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const names = ['You', 'A', 'B', 'C', 'D', 'E'];
function fresh(n, opts) {
  const st = G.createGame({
    numPlayers: n, names: names.slice(0, n),
    allPass: (opts && opts.allPass) || 'leaster', difficulty: 'hard',
    blackQueenDoubler: !!(opts && opts.doublers),
    redQueenDoubler: !!(opts && opts.doublers),
    redealDoubler: !!(opts && opts.doublers)
  });
  G.newHand(st);
  return st;
}

/* Everything except config, with events reduced to a count and a digest.
 *
 * This was an allowlist of thirteen fields and claimed to cover "everything a
 * rejected action could plausibly corrupt". It did not: partnerRevealed,
 * isLeaster, revealInfo, tricksWon, trickLog, lastTrick, played, result,
 * history, dealer, handNumber, dealt, pickLog, doublers, redealDoubler and
 * nextHandDoubler were all invisible to it. partnerRevealed is the one that
 * matters most — a refused action that flipped it would leak the hidden
 * partnership to every client and no assertion would have noticed.
 *
 * An allowlist here is the same mistake as an allowlist in the projection, with
 * the failure pointing the other way: there, a forgotten field leaks; here, a
 * forgotten field hides a leak. So: exclusion. config is skipped because it is
 * fixed at table creation, and events because they legitimately grow — but a
 * refusal that quietly appends an event is exactly what this file exists to
 * catch, so they are counted and digested rather than ignored. */
function fingerprint(st) {
  const digest = st.events.map(e => e.kind + '|' + e.text + '|' + (e.audience === undefined ? '' : e.audience)).join('\u0001');
  const copy = {};
  for (const k of Object.keys(st)) {
    if (k === 'config' || k === 'events') continue;
    copy[k] = st[k];
  }
  copy.__events = { n: st.events.length, digest };
  return JSON.stringify(copy);
}

/* --- 1. No seat may act in another seat's turn --- */

for (const n of [3, 4, 5, 6]) {
  const st = fresh(n);
  const whoseTurn = st.turn;

  for (let seat = 0; seat < n; seat++) {
    if (seat === whoseTurn) continue;
    for (const type of ['pick', 'pass']) {
      const before = fingerprint(st);
      const r = G.applyAction(st, seat, { type });
      check(r.ok === false, `${n}p: seat ${seat} was allowed to ${type} on seat ${whoseTurn}'s turn`);
      check(fingerprint(st) === before, `${n}p: a refused ${type} from seat ${seat} still changed the game`);
    }
  }
  // ...and the seat whose turn it actually is may.
  check(G.applyAction(st, whoseTurn, { type: 'pick' }).ok === true,
    `${n}p: the seat whose turn it is could not pick`);
}

/* --- 2. Only the picker may bury, and only their own cards --- */

for (const n of [3, 4, 5, 6]) {
  const st = fresh(n);
  const picker = st.turn;
  check(G.applyAction(st, picker, { type: 'pick' }).ok, `${n}p: pick failed`);
  check(st.phase === 'bury', `${n}p: expected bury phase`);

  const d = G.DEAL[n];
  const pickerCards = C.ids(st.players[picker].hand).slice(0, d.blind);

  for (let seat = 0; seat < n; seat++) {
    if (seat === picker) continue;
    const before = fingerprint(st);

    // The original hole: a non-picker naming the picker's own cards.
    const r = G.applyAction(st, seat, { type: 'bury', cards: pickerCards });
    check(r.ok === false, `${n}p: seat ${seat} was allowed to bury the picker's cards`);

    /* And the refusal must come from the gate's own check, not from doBury
     * catching it further in. Both layers refuse, so behaviour alone cannot tell
     * which one acted — the reason can. If this ever reads "those cards could not
     * be buried", the gate has stopped checking and the player is being told
     * their cards were wrong when the truth is that it was not their turn to
     * bury at all. */
    check(/picker/.test(r.reason || ''),
      `${n}p: a non-picker bury was refused by the wrong layer — reason was "${r.reason}"`);
    check(fingerprint(st) === before, `${n}p: a refused bury from seat ${seat} changed the game`);

    // And naming its own — equally not allowed, and it must not lose the cards.
    const own = C.ids(st.players[seat].hand).slice(0, d.blind);
    const r2 = G.applyAction(st, seat, { type: 'bury', cards: own });
    check(r2.ok === false, `${n}p: seat ${seat} was allowed to bury its own cards`);
    check(fingerprint(st) === before, `${n}p: a refused bury from seat ${seat} changed the game`);
  }

  check(G.applyAction(st, picker, { type: 'bury', cards: pickerCards }).ok === true,
    `${n}p: the picker could not bury`);
}

/* --- 3. A refused bury is atomic --- */

{
  const st = fresh(5);
  const picker = st.turn;
  G.applyAction(st, picker, { type: 'pick' });
  const hand = C.ids(st.players[picker].hand);
  const before = fingerprint(st);
  const size = st.players[picker].hand.length;

  const cases = [
    { label: 'one good card and one unknown id', cards: [hand[0], 'NOT_A_CARD'] },
    { label: 'unknown id first', cards: ['NOT_A_CARD', hand[0]] },
    { label: 'the same card named twice', cards: [hand[0], hand[0]] },
    { label: 'another seat\'s card', cards: [hand[0], C.ids(st.players[(picker + 1) % 5].hand)[0]] },
    { label: 'both unknown', cards: ['NOPE', 'ALSO_NOPE'] }
  ];

  for (const c of cases) {
    const r = G.applyAction(st, picker, { type: 'bury', cards: c.cards });
    check(r.ok === false, `bury with ${c.label} was accepted`);
    check(st.players[picker].hand.length === size,
      `bury with ${c.label} changed the hand size: ${size} -> ${st.players[picker].hand.length}`);
    check(fingerprint(st) === before, `bury with ${c.label} was not atomic — the game changed`);
  }

  // Wrong count is refused too, and just as harmlessly.
  for (const cards of [[], [hand[0]], [hand[0], hand[1], hand[2]]]) {
    const r = G.applyAction(st, picker, { type: 'bury', cards });
    check(r.ok === false, `bury of ${cards.length} cards was accepted`);
    check(fingerprint(st) === before, `bury of ${cards.length} cards changed the game`);
  }

  // And the legitimate bury still works afterwards, so none of the above left
  // the state subtly poisoned.
  check(G.applyAction(st, picker, { type: 'bury', cards: [hand[0], hand[1]] }).ok === true,
    'a valid bury failed after a run of refused ones');
}

/* --- 4. Nothing malformed may throw --- */

{
  const st = fresh(5);
  const picker = st.turn;

  const badSeats = [-1, 5, 99, 1.5, NaN, Infinity, '0', null, undefined, {}, [], true];
  const badActions = [
    null, undefined, 'pick', 42, [], {}, { type: null }, { type: 'PICK' },
    { type: 'delete_everything' },
    // Prototype keys: a plain-object ACTIONS lookup makes all of these truthy.
    { type: 'constructor' }, { type: '__proto__' }, { type: 'toString' },
    { type: 'valueOf' }, { type: 'hasOwnProperty' },
    { type: 'bury' }, { type: 'bury', cards: null },
    { type: 'bury', cards: 'JD' }, { type: 'bury', cards: [null, undefined] },
    { type: 'bury', cards: [{}, {}] }, { type: 'play' }, { type: 'play', card: null },
    { type: 'play', card: {} }, { type: 'play', card: 'NOT_A_CARD' }
  ];

  const before = fingerprint(st);
  let threw = null;

  for (const seat of badSeats) {
    for (const action of badActions) {
      try {
        const r = G.applyAction(st, seat, action);
        if (!r || typeof r.ok !== 'boolean') {
          threw = threw || `applyAction(${JSON.stringify(seat)}, ${JSON.stringify(action)}) returned ${JSON.stringify(r)}`;
        } else if (r.ok !== false) {
          threw = threw || `applyAction accepted seat ${JSON.stringify(seat)} action ${JSON.stringify(action)}`;
        }
      } catch (e) {
        threw = threw || `applyAction THREW on seat ${JSON.stringify(seat)} action ${JSON.stringify(action)}: ${e.message}`;
      }
    }
  }
  check(threw === null, threw || '');
  check(fingerprint(st) === before, 'a malformed action changed the game');

  // Valid seat, malformed actions — the same guarantee.
  for (const action of badActions) {
    try {
      const r = G.applyAction(st, picker, action);
      check(r && r.ok === false, `applyAction accepted malformed ${JSON.stringify(action)} from a real seat`);
    } catch (e) {
      check(false, `applyAction THREW on ${JSON.stringify(action)} from a real seat: ${e.message}`);
    }
  }
  check(fingerprint(st) === before, 'a malformed action from a real seat changed the game');

  // Unknown keys are ignored, not rejected. A client on an older build sending a
  // field this server does not know about should still be able to play — the
  // alternative is that adding one optional field to the protocol locks out
  // everyone who has not reloaded.
  {
    const st2 = fresh(5);
    const r = G.applyAction(st2, st2.turn, { type: 'pick', extra: 'ignored', v: 7 });
    check(r.ok === true, 'an action carrying an unknown extra key was rejected');
  }

  // No state at all, which is what a message for a room that has not dealt looks like.
  for (const s of [null, undefined, {}, { players: null }]) {
    try {
      check(G.applyAction(s, 0, { type: 'pick' }).ok === false, 'applyAction accepted an action with no game');
    } catch (e) {
      check(false, `applyAction THREW with no game: ${e.message}`);
    }
  }
}

/* --- 5. Play: only the seat on turn, only a legal card, and refusals are clean --- */

{
  const st = fresh(5);
  // Drive to the play phase with the AI so we reach it the way a real hand does.
  let guard = 0;
  while (st.phase !== 'play' && guard++ < 50) AI.act(st);
  check(st.phase === 'play', 'could not reach the play phase');

  const onTurn = st.turn;
  const before = fingerprint(st);

  for (let seat = 0; seat < 5; seat++) {
    if (seat === onTurn) continue;
    const card = C.ids(st.players[seat].hand)[0];
    const r = G.applyAction(st, seat, { type: 'play', card });
    check(r.ok === false, `seat ${seat} played out of turn`);
    check(fingerprint(st) === before, `a refused play from seat ${seat} changed the game`);

    // Playing someone else's card is refused too.
    const other = C.ids(st.players[onTurn].hand)[0];
    const r2 = G.applyAction(st, seat, { type: 'play', card: other });
    check(r2.ok === false, `seat ${seat} played the card of seat ${onTurn}`);
    check(fingerprint(st) === before, `a refused play from seat ${seat} changed the game`);
  }

  // The seat on turn cannot play a card it does not hold.
  const notHeld = C.ids(st.players[(onTurn + 1) % 5].hand)[0];
  check(G.applyAction(st, onTurn, { type: 'play', card: notHeld }).ok === false,
    'a seat played a card it does not hold');
  check(fingerprint(st) === before, 'a refused play changed the game');

  // An illegal-but-held card is refused with a reason a player can act on.
  const legal = G.legalPlays(st, onTurn).map(c => c.id);
  const illegal = C.ids(st.players[onTurn].hand).filter(id => legal.indexOf(id) < 0);
  if (illegal.length) {
    const r = G.applyAction(st, onTurn, { type: 'play', card: illegal[0] });
    check(r.ok === false, 'an illegal card was accepted');
    check(typeof r.reason === 'string' && r.reason.length > 0, 'an illegal play gave no reason');
    check(fingerprint(st) === before, 'a refused illegal play changed the game');
  }

  check(G.applyAction(st, onTurn, { type: 'play', card: legal[0] }).ok === true,
    'a legal play from the seat on turn was refused');
}

/* --- 6. Refusals give nothing away --- */

/* Rewritten. The previous version had three problems, and the third is the one
 * that mattered:
 *
 *   - It probed every seat against ONE state, including the picker. When the
 *     probe seat happened to be the picker, the bury SUCCEEDED, moving the phase
 *     to 'play' — so every later probe was judged in a phase the test did not
 *     think it was in, and which probes ran at all depended on where the picker
 *     fell. It was sampling a moving target.
 *   - It built "everyone else's cards" with `if (i !== 1)`, silently exempting
 *     seat 1's whole hand from the assertion. There is nothing seat-1-relative
 *     anywhere in the block; it was a leftover.
 *   - It aimed at the wrong channel. The reasons here are static literals plus
 *     illegalReason, which reads only state.trick[0] — public — so no reason
 *     string can depend on hidden information and the assertion could not fail.
 *     The channel that CAN leak is the ok boolean used as an oracle: ask a
 *     question whose refusal differs depending on something you should not know.
 */

{
  // Every probe gets its own state, so nothing a probe does can move the target.
  const probes = [
    { type: 'pick' }, { type: 'pass' }, { type: 'nextHand' },
    { type: 'play', card: 'QC' }, { type: 'play', card: 'JD' },
    { type: 'bury', cards: ['QC', 'JD'] }
  ];

  const reasons = [];
  for (let seat = 0; seat < 5; seat++) {
    for (const a of probes) {
      const st = fresh(5);
      const picker = st.turn;
      G.applyAction(st, picker, { type: 'pick' });
      const allCards = [];
      st.players.forEach(p => allCards.push(...C.ids(p.hand)));   // no exemptions
      const r = G.applyAction(st, seat, a);
      if (!r.ok && r.reason) {
        reasons.push(r.reason);
        for (const id of allCards) {
          check(r.reason.indexOf(id) < 0, `a refusal named the card ${id}: "${r.reason}"`);
        }
        /* WORD BOUNDARIES, and they were literal backspace characters.
         *
         * A regex containing a real 0x08 matches nothing a refusal ever says,
         * so `!test(...)` was true whatever the reason was and this assertion
         * had never once been capable of failing. It read as a check on the
         * hidden partnership and was a comment with brackets round it.
         *
         * They get in through a shell heredoc: an unquoted \b becomes the
         * character rather than the escape, the file still parses, and nothing
         * looks wrong in a diff. shared/tests/no-control-characters.js now
         * refuses the whole class. */
        check(!/\b(alone|partner)\b/i.test(r.reason),
          `a refusal mentioned the hidden partnership: "${r.reason}"`);
      }
    }
  }
  check(reasons.length > 0, 'no refusals were produced to inspect');
}

/* --- 6b. The refusal itself must not be an oracle ---
 *
 * The real risk is not the wording, it is that asking a question and reading the
 * yes/no tells you something. Two states identical except for hidden information
 * — who holds the Jack of Diamonds, and so whether the picker is secretly alone
 * — must answer every probe identically, byte for byte. */

{
  function twin(swapJD) {
    const st = fresh(5);
    const picker = st.turn;
    G.applyAction(st, picker, { type: 'pick' });

    if (swapJD) {
      // Move the Jack between two seats that are neither the viewer nor the
      // picker, so only the hidden partnership changes.
      const seats = [0, 1, 2, 3, 4].filter(i => i !== picker && i !== 0);
      let from = -1, at = -1;
      for (const i of [picker, ...seats]) {
        const k = st.players[i].hand.findIndex(c => c.id === 'JD');
        if (k >= 0) { from = i; at = k; break; }
      }
      if (from >= 0) {
        const to = seats.find(i => i !== from);
        if (to !== undefined) {
          const swapAt = st.players[to].hand.findIndex(c => c.id !== 'JD');
          const tmp = st.players[from].hand[at];
          st.players[from].hand[at] = st.players[to].hand[swapAt];
          st.players[to].hand[swapAt] = tmp;
        }
      }
    }
    return st;
  }

  const a = twin(false), b = twin(true);
  const viewer = 0;
  const probes = [
    { type: 'pick' }, { type: 'pass' }, { type: 'nextHand' },
    { type: 'play', card: 'JD' }, { type: 'play', card: 'QC' },
    { type: 'bury', cards: ['JD', 'QC'] }, { type: 'bury', cards: [] }
  ];

  for (const probe of probes) {
    const ra = G.applyAction(a, viewer, probe);
    const rb = G.applyAction(b, viewer, probe);
    check(JSON.stringify(ra) === JSON.stringify(rb),
      `the refusal for ${JSON.stringify(probe)} differed with the Jack moved: ` +
      `${JSON.stringify(ra)} vs ${JSON.stringify(rb)}`);
  }
}

/* --- 7. The four actions guard themselves, without the gate in front --- */

/* This section exists because of a hole in section 2 rather than a hole in the
 * engine. Everything above goes through applyAction, which does its own picker
 * and turn checks — so when the actor check was deleted from doBury to see
 * whether this file would notice, it did not. Every assertion still passed,
 * because the gate refused the call before the missing guard could matter.
 *
 * That is a test proving the gate works and quietly claiming to prove more. The
 * guards have to hold on their own: ai.js and ui.js both call doPick/doBury/
 * doPlay directly, and a future room implementation that reaches past the gate —
 * for a replay, a migration, an admin path — would too. Belt and braces only
 * counts if the test can tell which one is holding the trousers up. */

for (const n of [3, 5]) {
  const st = fresh(n);
  const onTurn = st.turn;
  const notOnTurn = (onTurn + 1) % n;

  // doPick / doPass refuse a seat that is not on turn.
  let f = fingerprint(st);
  check(G.doPick(st, notOnTurn) === false, `${n}p: doPick accepted a seat not on turn`);
  check(fingerprint(st) === f, `${n}p: a refused doPick changed the game`);
  check(G.doPass(st, notOnTurn) === false, `${n}p: doPass accepted a seat not on turn`);
  check(fingerprint(st) === f, `${n}p: a refused doPass changed the game`);

  // doBury refuses anyone but the picker — the original hole, tested directly.
  check(G.doPick(st, onTurn) === true, `${n}p: doPick failed for the seat on turn`);
  const picker = st.picker;
  const d = G.DEAL[n];
  const pickerCards = C.ids(st.players[picker].hand).slice(0, d.blind);

  f = fingerprint(st);
  for (let seat = 0; seat < n; seat++) {
    if (seat === picker) continue;
    check(G.doBury(st, seat, pickerCards) === false,
      `${n}p: doBury accepted seat ${seat}, who is not the picker`);
    check(fingerprint(st) === f,
      `${n}p: a doBury refused for seat ${seat} still changed the game`);
  }
  /* doBury's own shape check, with the gate out of the way. 'JD'.length is 2,
   * which is exactly d.blind at every table size, so a bare string got past the
   * length check and was refused only because 'J' matched no card id — luck, not
   * a guard. applyAction screens this too, which is why it has to be tested
   * here: with the gate in front, deleting doBury's Array.isArray changes
   * nothing observable.
   *
   * The string cases are now harmless on their own — atomic validation refuses
   * them before the hand changes. The one that bites is the array-LIKE built
   * from cards the picker genuinely holds: every index lookup succeeds, so
   * without Array.isArray it is accepted as a perfectly good bury. */
  const arrayLike = { length: d.blind };
  pickerCards.forEach((id, k) => { arrayLike[k] = id; });   // real cards, wrong type
  for (const notAnArray of ['JD', 'QC', { length: d.blind }, arrayLike]) {
    const f = fingerprint(st);
    check(G.doBury(st, picker, notAnArray) === false,
      `${n}p: doBury accepted ${JSON.stringify(notAnArray)}, which is not an array`);
    check(fingerprint(st) === f, `${n}p: a doBury refused for shape still changed the game`);
  }

  check(G.doBury(st, picker, pickerCards) === true, `${n}p: doBury refused the picker`);

  // doPlay refuses a seat that is not on turn, directly.
  let guard = 0;
  while (st.phase !== 'play' && guard++ < 50) AI.act(st);
  if (st.phase === 'play') {
    const t = st.turn;
    const off = (t + 1) % n;
    f = fingerprint(st);
    check(G.doPlay(st, off, C.ids(st.players[off].hand)[0]) === false,
      `${n}p: doPlay accepted a seat not on turn`);
    check(fingerprint(st) === f, `${n}p: a refused doPlay changed the game`);
  }
}

/* --- 8. The bury keeps the caller's cards, in the caller's order --- */

/* The atomicity fix introduced a reorder — validate all indices, splice from the
 * back so earlier ones stay valid, then restore the requested order — and nothing
 * tested it. Every successful bury in this repository buries hand[0] and hand[1],
 * because doPick puts the blind at the front and every test slices from there. So
 * the reverse-sort could be dropped (wrong cards) or the order restoration
 * replaced with Object.keys (wrong order) and the whole suite stayed green. */

{
  for (const n of [3, 5]) {
    const st = fresh(n);
    const picker = st.turn;
    G.applyAction(st, picker, { type: 'pick' });

    const hand = C.ids(st.players[picker].hand);
    const d = G.DEAL[n];
    check(hand.length > 4, `${n}p: hand too short to pick non-adjacent cards`);

    // Deliberately not the front two, and named highest-index first.
    const wanted = [hand[4], hand[1]].slice(0, d.blind);
    const expectRemaining = hand.filter(id => wanted.indexOf(id) < 0);

    check(G.applyAction(st, picker, { type: 'bury', cards: wanted }).ok === true,
      `${n}p: burying non-adjacent cards failed`);

    check(JSON.stringify(C.ids(st.buried)) === JSON.stringify(wanted),
      `${n}p: buried the wrong cards or in the wrong order — asked ${JSON.stringify(wanted)}, got ${JSON.stringify(C.ids(st.buried))}`);

    const remaining = C.ids(st.players[picker].hand).slice().sort();
    check(JSON.stringify(remaining) === JSON.stringify(expectRemaining.slice().sort()),
      `${n}p: the remaining hand is not the exact complement of the bury`);
    check(st.players[picker].hand.length === hand.length - d.blind,
      `${n}p: hand size wrong after burying`);
  }
}

/* --- 9. nextHand --- */

{
  const st = fresh(5);
  const before = fingerprint(st);

  // Refused mid-hand, from every seat, without touching anything.
  for (let seat = 0; seat < 5; seat++) {
    const r = G.applyAction(st, seat, { type: 'nextHand' });
    check(r.ok === false, `seat ${seat} dealt a new hand mid-play`);
    // newHand's own guard also refuses, so behaviour cannot say which layer
    // acted. If this reads "could not deal", the gate has stopped checking.
    check(/not over/.test(r.reason || ''),
      `nextHand was refused by the wrong layer — reason was "${r.reason}"`);
    check(fingerprint(st) === before, `a refused nextHand from seat ${seat} changed the game`);
  }

  // Play a hand out, then it is allowed.
  let guard = 0;
  while (st.phase !== 'handOver' && guard++ < 500) AI.act(st);
  check(st.phase === 'handOver', 'could not reach handOver');
  const handNo = st.handNumber;
  check(G.applyAction(st, 3, { type: 'nextHand' }).ok === true, 'nextHand refused at handOver');
  check(st.handNumber === handNo + 1, 'nextHand did not deal');

  // And newHand itself refuses mid-hand, without the gate in front.
  const n2 = st.handNumber;
  check(G.newHand(st) === null, 'newHand dealt over a hand in progress');
  check(st.handNumber === n2, 'a refused newHand still bumped the hand number');
}

/* --- 10. A throw mid-apply is fatal, not a refusal --- */

/* The try/catch was added so a malformed payload could not take a room down with
 * an unhandled exception. It did that, and in doing so created something worse:
 * doPlay splices the card out of the hand, pushes it into the trick and sets
 * partnerRevealed BEFORE it reaches resolveTrick and scoring, so an exception
 * down there left the card gone, the trick full and unresolvable, and the turn
 * not advanced — while the caller was told the move was simply declined.
 *
 * A crash loses the in-memory state and the room restarts from its checkpoint.
 * A false refusal checkpoints a wedged game and tells five people nothing
 * happened. So the contract is: ok:false means unchanged; ok:false with
 * fatal:true means this state is now untrustworthy and must be discarded. */

{
  const st = fresh(5);
  let guard = 0;
  while (st.phase !== 'play' && guard++ < 50) AI.act(st);
  check(st.phase === 'play', 'could not reach the play phase');
  while (st.trick.length < 4 && guard++ < 60) AI.act(st);

  const seat = st.turn;
  const card = G.legalPlays(st, seat)[0].id;

  const realSum = C.sumPoints;
  C.sumPoints = function () { throw new Error('simulated engine bug'); };
  let r;
  try {
    r = G.applyAction(st, seat, { type: 'play', card });
  } finally {
    C.sumPoints = realSum;
  }

  check(r.ok === false, 'a throwing apply reported success');
  check(r.fatal === true,
    'a throw mid-apply was reported as an ordinary refusal — the caller cannot tell a declined move from a corrupted game');
  check(typeof r.error === 'string' && r.error.length > 0,
    'a fatal result carried no error detail for the server to log');

  // Validation refusals must NOT be fatal, or the flag means nothing.
  const st2 = fresh(5);
  const clean = G.applyAction(st2, (st2.turn + 1) % 5, { type: 'pick' });
  check(clean.ok === false, 'an out-of-turn pick was accepted');
  check(!clean.fatal, 'an ordinary refusal was marked fatal');
  const clean2 = G.applyAction(st2, 0, { type: 'nonsense' });
  check(!clean2.fatal, 'an unknown action was marked fatal');
}

/* --- report --- */

if (fails.length) {
  console.error('\nFAILED:');
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('seats checked at 3, 4, 5 and 6 players');
console.log('out-of-turn actions, non-picker buries, malformed payloads and illegal plays');
console.log('all refused, all atomic, none thrown, no reason leaked a card.');
