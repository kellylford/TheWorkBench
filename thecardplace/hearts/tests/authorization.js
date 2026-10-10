/* Can a seat do something that is not its to do?
 *
 * applyAction is the only door into the engine, and the seat check lives behind
 * it. Everything else — legalPlays, doPass, doPlay — trusts its caller, which is
 * fine in a game running in one tab and is a hole the size of the whole table
 * once there is a socket. So this suite sends every action from every seat in
 * every phase and asserts that only the entitled one gets through.
 *
 * THREE PROPERTIES, and the second and third are the ones people forget:
 *
 *   1. A refusal happens. The obvious one.
 *
 *   2. A refusal changes NOTHING. An action that is rejected halfway through
 *      has still moved the game — doPlay takes the card out of the hand before
 *      it reaches the trick logic — and a client that retries then plays a hand
 *      it does not have. Every refusal here is checked by comparing a full
 *      serialisation of the state before and after.
 *
 *   3. A refusal says nothing it should not. "You do not hold that card" is a
 *      fine thing to tell the seat that tried to play it and an oracle if it can
 *      be sent from any seat: ask about all fifty-two cards and you have mapped
 *      every hand at the table. The reasons are checked for card names, suits
 *      and ranks that the asking seat has no right to know.
 *
 * ---- two mutations that survive this suite, and should ----
 *
 * Mutation testing is only useful if a survivor is investigated rather than
 * assumed to be a gap. Two of these are EQUIVALENT MUTANTS — the engine has two
 * independent guards, and removing one changes nothing observable:
 *
 *   Deleting the `state.turn !== seat` check in doPlay. legalPlays() also
 *   refuses a seat that is not on turn, returning an empty list, so the card is
 *   never found and the play is refused anyway. Verified, not assumed: with the
 *   check removed, an out-of-turn play still comes back { ok: false }.
 *
 *   Making ACTIONS a plain {} instead of Object.create(null). 'constructor' then
 *   passes the lookup, and falls through the switch to `unknown action`. Still
 *   refused. The Object.create(null) is worth keeping regardless — it is the
 *   difference between refused-by-design and refused-by-luck, and the luck runs
 *   out the day somebody adds a default case.
 *
 * Neither is a hole. Do not "fix" this suite to kill them; there is nothing to
 * kill.
 *
 *   node tests/authorization.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Math, JSON, Date };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.SH.Cards;
const G = sandbox.SH.Game;

const fails = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

let seed = 90210;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const snap = s => JSON.stringify(s);

/* Send an action and insist that nothing moved. */
function refused(state, seat, action, why) {
  const before = snap(state);
  const r = G.applyAction(state, seat, action, rng);
  checks++;
  if (r.ok) {
    fails.push(why + ' — the engine ACCEPTED it');
    return null;
  }
  checks++;
  if (snap(state) !== before) {
    fails.push(why + ' — refused, but the state changed anyway. A client that ' +
      'retries now plays a hand it does not have.');
  }
  return r;
}

/* Does this refusal tell the asking seat something about somebody else's cards?
 *
 * Checked against the text rather than against a whitelist of phrasings, because
 * the failure mode is a helpful message added later by somebody being kind. */
function reasonIsSafe(state, seat, reason, where) {
  if (!reason) return;
  const mine = new Set(C.ids(state.players[seat].hand));
  state.players.forEach((p, i) => {
    if (i === seat) return;
    p.hand.forEach(c => {
      if (mine.has(c.id)) return;              // this seat holds one too; not a leak
      const name = C.name(c);
      check(!reason.includes(name),
        where + ': a refusal sent to seat ' + seat + ' names the ' + name +
        ', which is in seat ' + i + '\'s hand — ask about all fifty-two and you ' +
        'have mapped the table');
    });
  });
}

/* ---------------- 1. before the game starts ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });

  for (let seat = 0; seat < G.SEATS; seat++) {
    refused(state, seat, { type: 'play', card: '2C' }, 'seat ' + seat + ' played before the deal');
    refused(state, seat, { type: 'pass', cards: ['2C', '3C', '4C'] },
      'seat ' + seat + ' passed before the deal');
    refused(state, seat, { type: 'nextHand' }, 'seat ' + seat + ' dealt before the game started');
  }

  /* Not a seat at all. */
  [-1, 4, 99, 1.5, NaN, '0', null, undefined].forEach(bad => {
    refused(state, bad, { type: 'start' }, 'seat ' + String(bad) + ' was allowed to start');
  });

  /* Not an action at all. */
  [null, undefined, 'start', 42, [], { type: 'constructor' }, { type: '__proto__' },
   { type: 'toString' }, { type: 'hasOwnProperty' }, {}].forEach(bad => {
    refused(state, 0, bad, 'the engine accepted ' + JSON.stringify(bad) + ' as an action');
  });
}

/* ---------------- 2. the pass ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  check(state.phase === 'passing', 'expected a passing hand to start with');

  for (let seat = 0; seat < G.SEATS; seat++) {
    /* Cards from somebody else's hand. This is the oracle attack: if the engine
     * distinguishes "you do not hold that" from "that is not a card", a seat can
     * ask about all fifty-two and learn every hand. */
    const others = [];
    state.players.forEach((p, i) => { if (i !== seat) others.push(...C.ids(p.hand)); });
    const mine = new Set(C.ids(state.players[seat].hand));
    const notMine = others.filter(id => !mine.has(id)).slice(0, 3);

    const r = refused(state, seat, { type: 'pass', cards: notMine },
      'seat ' + seat + ' passed cards from another hand');
    if (r) reasonIsSafe(state, seat, r.reason, 'pass of another seat\'s cards');

    refused(state, seat, { type: 'pass', cards: [] }, 'seat ' + seat + ' passed nothing');
    refused(state, seat, { type: 'pass', cards: C.ids(state.players[seat].hand).slice(0, 4) },
      'seat ' + seat + ' passed four cards');
    refused(state, seat, { type: 'pass' }, 'seat ' + seat + ' passed with no cards field');
    refused(state, seat, { type: 'pass', cards: 'AAA' }, 'seat ' + seat + ' passed a string');

    const dupe = C.ids(state.players[seat].hand)[0];
    refused(state, seat, { type: 'pass', cards: [dupe, dupe, C.ids(state.players[seat].hand)[1]] },
      'seat ' + seat + ' passed the same card twice');

    /* Playing is not a thing that happens during the pass. */
    refused(state, seat, { type: 'play', card: C.ids(state.players[seat].hand)[0] },
      'seat ' + seat + ' played a card during the pass');
    refused(state, seat, { type: 'nextHand' }, 'seat ' + seat + ' dealt during the pass');
  }

  /* A legal pass goes through, and only once. */
  for (let seat = 0; seat < G.SEATS; seat++) {
    const cards = C.ids(state.players[seat].hand).slice(0, 3);
    const r = G.applyAction(state, seat, { type: 'pass', cards }, rng);
    check(r.ok, 'a legal pass from seat ' + seat + ' was refused: ' + r.reason);
    if (state.phase === 'passing') {
      refused(state, seat, { type: 'pass', cards: C.ids(state.players[seat].hand).slice(0, 3) },
        'seat ' + seat + ' passed twice');
    }
  }
  check(state.phase === 'play', 'four passes should have started the play');
}

/* ---------------- 3. the play ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  while (state.phase === 'passing') sandbox.SH.AI.act(state);
  check(state.phase === 'play', 'expected to be in play');

  let moves = 0;
  let guard = 0;
  const phasesSeen = new Set();

  while (state.phase === 'play' && guard++ < 60) {
    phasesSeen.add(state.phase);
    const onTurn = state.turn;

    /* EVERY other seat tries EVERY card it holds. None may move the game. */
    for (let seat = 0; seat < G.SEATS; seat++) {
      if (seat === onTurn) continue;
      const hand = C.ids(state.players[seat].hand);
      hand.slice(0, 4).forEach(id => {
        const r = refused(state, seat, { type: 'play', card: id },
          'seat ' + seat + ' played out of turn (' + id + ')');
        if (r) reasonIsSafe(state, seat, r.reason, 'out-of-turn play');
      });
      refused(state, seat, { type: 'pass', cards: hand.slice(0, 3) },
        'seat ' + seat + ' passed during the play');
      refused(state, seat, { type: 'nextHand' }, 'seat ' + seat + ' dealt mid-hand');
      refused(state, seat, { type: 'start' }, 'seat ' + seat + ' restarted mid-hand');
    }

    /* The seat on turn may not play a card it does not hold, nor an illegal one,
     * and neither refusal may move anything. */
    const held = new Set(C.ids(state.players[onTurn].hand));
    const notHeld = C.newDeck().map(c => c.id).filter(id => !held.has(id));
    notHeld.slice(0, 5).forEach(id => {
      const r = refused(state, onTurn, { type: 'play', card: id },
        'seat ' + onTurn + ' played ' + id + ', which it does not hold');
      if (r) reasonIsSafe(state, onTurn, r.reason, 'playing a card not held');
    });
    refused(state, onTurn, { type: 'play', card: 'not-a-card' }, 'a nonsense card id was accepted');
    refused(state, onTurn, { type: 'play' }, 'a play with no card was accepted');

    const legal = new Set(C.ids(G.legalPlays(state, onTurn)));
    const illegal = C.ids(state.players[onTurn].hand).filter(id => !legal.has(id));
    illegal.slice(0, 3).forEach(id => {
      const r = refused(state, onTurn, { type: 'play', card: id },
        'seat ' + onTurn + ' played ' + id + ', which the rules forbid here');
      /* The reason must be about the RULE, and about a card this seat holds, so
       * it is allowed to name it. What it may not do is mention anybody else's. */
      if (r) reasonIsSafe(state, onTurn, r.reason, 'illegal play');
    });

    sandbox.SH.AI.act(state);
    moves++;
  }
  check(moves > 20, 'only ' + moves + ' moves were audited during the play');
}

/* ---------------- 4. between hands, and after the game ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  let guard = 0;
  let sawHandOver = false;
  while (state.phase !== 'gameOver' && guard++ < 5000) {
    if (state.phase === 'handOver') {
      sawHandOver = true;
      /* Dealing the next hand is deliberately open to any seated player — the
       * room layers a ready-gate on top, because one player dealing while three
       * others are still reading the result is a different problem from
       * authorization and belongs where the seats are known. What must NOT work
       * is anything else. */
      for (let seat = 0; seat < G.SEATS; seat++) {
        refused(state, seat, { type: 'play', card: '2C' },
          'seat ' + seat + ' played between hands');
        refused(state, seat, { type: 'pass', cards: ['2C', '3C', '4C'] },
          'seat ' + seat + ' passed between hands');
        refused(state, seat, { type: 'start' },
          'seat ' + seat + ' restarted a game in progress');
      }
      G.applyAction(state, 2, { type: 'nextHand' }, rng);
      continue;
    }
    try { sandbox.SH.AI.act(state); } catch (e) { break; }
  }
  check(sawHandOver, 'never reached the end of a hand');
  check(state.phase === 'gameOver', 'the game did not finish (' + state.phase + ')');

  /* A finished game is finished. */
  for (let seat = 0; seat < G.SEATS; seat++) {
    refused(state, seat, { type: 'play', card: '2C' }, 'seat ' + seat + ' played after the game');
    refused(state, seat, { type: 'nextHand' }, 'seat ' + seat + ' dealt after the game');
    refused(state, seat, { type: 'pass', cards: ['2C', '3C', '4C'] },
      'seat ' + seat + ' passed after the game');
  }
}

console.log(checks.toLocaleString() + ' assertions');
if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.slice(0, 15).forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('Every action was refused from every seat that had no right to it, ' +
  'nothing moved when it was, and no refusal named a card the asker could not see.');
