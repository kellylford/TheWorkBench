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

const sandbox = { console, Math, Date, JSON, setTimeout, Set };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, AI, Cards: C } = sandbox.SH;

let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const names = ['You', 'A', 'B', 'C', 'D', 'E'];
function fresh(n) {
  const st = G.createGame({
    numPlayers: n, names: names.slice(0, n),
    allPass: 'leaster', difficulty: 'hard',
    blackQueenDoubler: false, redQueenDoubler: false, redealDoubler: false
  });
  G.newHand(st);
  return st;
}

/* A cheap structural fingerprint. Deep equality on the whole state would drag in
 * the event log, which legitimately grows; this covers everything a rejected
 * action could plausibly corrupt. */
function fingerprint(st) {
  return JSON.stringify({
    phase: st.phase, turn: st.turn, picker: st.picker, partner: st.partner,
    alone: st.alone, leader: st.leader, passCount: st.passCount,
    hands: st.players.map(p => C.ids(p.hand)),
    blind: C.ids(st.blind), buried: C.ids(st.buried), pickedUp: st.pickedUp.slice(),
    trick: st.trick.map(t => ({ player: t.player, card: t.card.id })),
    points: st.players.map(p => p.points), score: st.players.map(p => p.score)
  });
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
    { type: 'delete_everything' }, { type: 'bury' }, { type: 'bury', cards: null },
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

/* --- 6. A refusal reason never names another seat's cards --- */

{
  const st = fresh(5);
  const picker = st.turn;
  G.applyAction(st, picker, { type: 'pick' });

  const everyoneElsesCards = [];
  st.players.forEach((p, i) => { if (i !== 1) everyoneElsesCards.push(...C.ids(p.hand)); });

  const reasons = [];
  for (let seat = 0; seat < 5; seat++) {
    for (const a of [{ type: 'pick' }, { type: 'pass' }, { type: 'play', card: 'QC' },
                     { type: 'bury', cards: C.ids(st.players[picker].hand).slice(0, 2) }]) {
      const r = G.applyAction(st, seat, a);
      if (!r.ok && r.reason) reasons.push(r.reason);
    }
  }
  check(reasons.length > 0, 'no refusals were produced to inspect');
  for (const reason of reasons) {
    for (const id of everyoneElsesCards) {
      check(reason.indexOf(id) < 0, `a refusal reason leaked the card id ${id}: "${reason}"`);
    }
    check(!/\b(alone|partner)\b/i.test(reason), `a refusal reason mentioned the hidden partnership: "${reason}"`);
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

/* --- report --- */

if (fails.length) {
  console.error('\nFAILED:');
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('seats checked at 3, 4, 5 and 6 players');
console.log('out-of-turn actions, non-picker buries, malformed payloads and illegal plays');
console.log('all refused, all atomic, none thrown, no reason leaked a card.');
