/* Can seat A act as seat B?
 *
 * This is the axis that matters most once there is a socket, and it is a
 * different question from seat ownership. Seat ownership is "can two clients
 * claim the same chair" and lives in the room. ACTION AUTHORIZATION is "having
 * legitimately got a chair, can I play out of somebody else's hand" — and it
 * lives in applyAction, because applyAction is the only door into the engine.
 *
 * The failure this guards against is not hypothetical. An engine function that
 * checks the phase and not the actor is the natural thing to write when there is
 * only ever one human at the table, and it is invisible until the day there are
 * four. The euchre discard is exactly that shape: it belongs to the dealer, who
 * is usually not the seat on turn, so "is it your turn" is the wrong check and
 * writing it would look right.
 *
 * Also here: hostile payloads. An unhandled throw inside a Durable Object kills
 * the room for everybody at the table, so a malformed action has to come back as
 * a refusal rather than as an exception.
 *
 *   node tests/authorization.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 5150;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, AI } = sandbox.SH;

const fails = [];
let checks = 0;
function check(cond, msg) { checks++; if (!cond) fails.push(msg); }

function newGame(opts) {
  return G.createGame(Object.assign({
    numPlayers: 4, names: ['N', 'E', 'S', 'W'],
    pointsToWin: 10, stickTheDealer: false, allowAlone: true, difficulty: 'hard'
  }, opts || {}));
}

/* Everything about the state except the event log, which legitimately grows on
 * some refusal paths in other engines and would make a false positive here. */
function snapshot(st) {
  const copy = {};
  for (const k of Object.keys(st)) {
    if (k === 'events' || k === 'nextEventId') continue;
    copy[k] = st[k];
  }
  return JSON.stringify(copy);
}

/* Run a fresh game to the phase we want to attack. */
function advanceTo(phase, opts) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const st = newGame(opts);
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== phase && st.phase !== 'handOver' && guard++ < 200) AI.act(st);
    if (st.phase === phase) return st;
  }
  throw new Error('could not reach phase ' + phase);
}

/* ============ 1. THE WRONG SEAT ============ */

const attacks = [
  { phase: 'bid1', entitled: st => st.turn, action: () => ({ type: 'order', alone: false }) },
  { phase: 'bid1', entitled: st => st.turn, action: () => ({ type: 'pass' }) },
  { phase: 'bid2', entitled: st => st.turn, action: st => ({ type: 'call', suit: firstAllowed(st) }) },
  { phase: 'bid2', entitled: st => st.turn, action: () => ({ type: 'pass' }) },
  {
    phase: 'discard',
    /* THE ONE THAT WOULD HAVE BEEN GOT WRONG. The discard belongs to the DEALER,
     * and the dealer is very often not the seat that was on turn when the upcard
     * was ordered up. A gate that checked `turn` here would let the seat that
     * ordered it up throw a card out of the dealer's hand. */
    entitled: st => st.dealer,
    action: st => ({ type: 'discard', card: st.players[st.dealer].hand[0].id })
  },
  {
    phase: 'play', entitled: st => st.turn,
    action: st => ({ type: 'play', card: G.legalPlays(st, st.turn)[0].id })
  }
];

for (const atk of attacks) {
  for (let trial = 0; trial < 40; trial++) {
    const st = advanceTo(atk.phase);
    const good = atk.entitled(st);
    const action = atk.action(st);

    for (let seat = 0; seat < 4; seat++) {
      if (seat === good) continue;
      const before = snapshot(st);
      const r = G.applyAction(st, seat, action);
      check(r.ok === false,
        `seat ${seat + 1} was allowed to ${action.type} in ${atk.phase} when seat ${good + 1} was entitled`);
      check(!r.fatal, `an ordinary refusal came back as fatal: ${atk.phase}/${action.type}`);
      check(snapshot(st) === before,
        `a refused ${action.type} from seat ${seat + 1} in ${atk.phase} changed the state`);
    }

    /* And the entitled seat still works afterwards, so the guard is refusing the
     * right thing rather than everything. */
    const r = G.applyAction(st, good, action);
    check(r.ok === true, `the entitled seat ${good + 1} could not ${action.type} in ${atk.phase}: ` + r.reason);
  }
}

function firstAllowed(st) {
  return ['C', 'S', 'H', 'D'].filter(s => s !== st.deniedSuit)[0];
}

/* ============ 2. PLAYING SOMEBODY ELSE'S CARD ============
 *
 * A seat on turn asking to play a card that is in another player's hand. The
 * seat check passes; the card check has to catch it. */

for (let trial = 0; trial < 60; trial++) {
  const st = advanceTo('play');
  const me = st.turn;
  const other = (me + 1) % 4;
  if (!st.players[other].hand.length) continue;
  const theirs = st.players[other].hand[0].id;
  const before = snapshot(st);
  const r = G.applyAction(st, me, { type: 'play', card: theirs });
  check(r.ok === false, `seat ${me + 1} played ${theirs} out of seat ${other + 1}'s hand`);
  check(snapshot(st) === before, 'playing another seat\'s card changed the state');
}

/* The dealer discarding a card that is not in their hand. */
for (let trial = 0; trial < 40; trial++) {
  const st = advanceTo('discard');
  const other = (st.dealer + 1) % 4;
  const theirs = st.players[other].hand[0].id;
  const before = snapshot(st);
  const r = G.applyAction(st, st.dealer, { type: 'discard', card: theirs });
  check(r.ok === false, 'the dealer discarded a card from another seat\'s hand');
  check(snapshot(st) === before, 'a refused discard changed the state');
}

/* ============ 3. RULES THE GATE OWNS ============ */

for (let trial = 0; trial < 40; trial++) {
  const st = advanceTo('bid2');
  const before = snapshot(st);
  const r = G.applyAction(st, st.turn, { type: 'call', suit: st.deniedSuit });
  check(r.ok === false, 'the turned-down suit was allowed to be named');
  check(/turned down/.test(r.reason || ''),
    'refusing the turned-down suit did not say why: ' + r.reason);
  check(snapshot(st) === before, 'naming the denied suit changed the state');
}

/* Stick the dealer: the dealer may not pass, and is told why. */
{
  let tested = 0;
  for (let trial = 0; trial < 400 && tested < 20; trial++) {
    const st = advanceTo('bid2', { stickTheDealer: true });
    while (st.phase === 'bid2' && st.turn !== st.dealer) {
      const r = G.applyAction(st, st.turn, { type: 'pass' });
      if (!r.ok) break;
    }
    if (st.phase !== 'bid2' || st.turn !== st.dealer) continue;
    tested++;
    const before = snapshot(st);
    const r = G.applyAction(st, st.dealer, { type: 'pass' });
    check(r.ok === false, 'the dealer passed with stick the dealer on');
    check(/must name/.test(r.reason || ''), 'the forced dealer was not told why: ' + r.reason);
    check(snapshot(st) === before, 'a refused pass changed the state');
    const ok = G.applyAction(st, st.dealer, { type: 'call', suit: firstAllowed(st) });
    check(ok.ok === true, 'the forced dealer could not name a suit either: ' + ok.reason);
  }
  check(tested >= 10, 'stick the dealer was only reached ' + tested + ' times');
}

/* A seat sitting out may not play, even on its nominal turn. */
{
  let tested = 0;
  for (let trial = 0; trial < 800 && tested < 20; trial++) {
    const st = advanceTo('play', { allowAlone: true });
    if (st.sittingOut < 0) continue;
    tested++;
    const out = st.sittingOut;
    const before = snapshot(st);
    const card = st.players[out].hand[0];
    const r = G.applyAction(st, out, { type: 'play', card: card.id });
    check(r.ok === false, 'a seat sitting out was allowed to play');
    check(/sitting out/.test(r.reason || ''), 'the sitting-out seat was not told why: ' + r.reason);
    check(snapshot(st) === before, 'a refused play from a sitting-out seat changed the state');
    check(G.legalPlays(st, out).length === 0, 'a sitting-out seat has legal plays');
  }
  check(tested >= 5, 'only ' + tested + ' hands had somebody playing alone');
}

/* ============ 4. HOSTILE PAYLOADS ============
 *
 * None of these may throw. An unhandled exception inside a Durable Object kills
 * the room for everybody sitting at it, so a malformed frame has to come back as
 * a refusal. */

const nasty = [
  [0, null], [0, undefined], [0, 'play'], [0, 42], [0, []],
  [0, { type: 'play' }], [0, { type: 'play', card: null }], [0, { type: 'play', card: 99 }],
  [0, { type: 'play', card: 'ZZ' }], [0, { type: 'play', card: '__proto__' }],
  [0, { type: 'constructor' }], [0, { type: '__proto__' }], [0, { type: 'toString' }],
  [0, { type: 'hasOwnProperty' }], [0, { type: 'valueOf' }],
  [0, { type: 'call', suit: 'X' }], [0, { type: 'call', suit: null }],
  [0, { type: 'call', suit: '__proto__' }],
  [0, { type: 'discard', card: {} }],
  [99, { type: 'play', card: 'AS' }], [-1, { type: 'pass' }], [1.5, { type: 'pass' }],
  ['0', { type: 'pass' }], [null, { type: 'pass' }], [NaN, { type: 'pass' }]
];

for (const phase of ['bid1', 'bid2', 'discard', 'play', 'handOver']) {
  let st;
  try { st = advanceTo(phase); } catch (e) { continue; }
  for (const [seat, action] of nasty) {
    const before = snapshot(st);
    let r;
    try {
      r = G.applyAction(st, seat, action);
    } catch (e) {
      fails.push(`applyAction THREW on ${phase} with seat=${String(seat)} action=${JSON.stringify(action)}: ${e.message}`);
      continue;
    }
    checks++;
    check(r && r.ok === false,
      `a malformed action was accepted in ${phase}: seat=${String(seat)} ${JSON.stringify(action)}`);
    check(!r.fatal,
      `a malformed action came back as fatal in ${phase}: ${JSON.stringify(action)} — ${r.error}`);
    check(snapshot(st) === before,
      `a malformed action changed the state in ${phase}: ${JSON.stringify(action)}`);
  }
}

/* ============ 4b. A TRUTHY `alone` IS COERCED, NOT STORED ============
 *
 * {alone: 'yes'} is not a hostile payload — it is a legitimate truthy value, and
 * the engine is entitled to accept it. What it may not do is keep it. `alone`
 * ends up in the projection and on the wire, and a client that receives the
 * string "yes" where it expected a boolean will do something surprising with it
 * exactly once, in front of four people.
 */
{
  let tested = 0;
  for (let trial = 0; trial < 200 && tested < 10; trial++) {
    const st = advanceTo('bid1');
    const r = G.applyAction(st, st.turn, { type: 'order', alone: 'yes' });
    if (!r.ok) continue;
    tested++;
    check(typeof st.alone === 'boolean',
      'a truthy non-boolean `alone` was stored as ' + JSON.stringify(st.alone));
    check(st.alone === true, 'a truthy `alone` did not send the partner out');
    check(st.sittingOut === G.partnerOf(st.maker), 'going alone did not seat anybody out');
  }
  check(tested >= 5, 'the alone-coercion case was only reached ' + tested + ' times');
}

/* ============ 5. PHASE GATES ============
 *
 * The right seat, the wrong moment. */

const wrongMoment = [
  ['bid1', { type: 'call', suit: 'H' }],
  ['bid1', { type: 'discard', card: null }],
  ['bid1', { type: 'nextHand' }],
  ['bid1', { type: 'start' }],
  ['bid2', { type: 'order' }],
  ['play', { type: 'order' }],
  ['play', { type: 'pass' }],
  ['play', { type: 'nextHand' }],
  ['handOver', { type: 'play', card: 'AS' }],
  ['handOver', { type: 'order' }],
  ['handOver', { type: 'start' }]
];

for (const [phase, action] of wrongMoment) {
  let st;
  try { st = advanceTo(phase); } catch (e) { continue; }
  for (let seat = 0; seat < 4; seat++) {
    const before = snapshot(st);
    const r = G.applyAction(st, seat, action);
    check(r.ok === false, `${action.type} was accepted during ${phase} from seat ${seat + 1}`);
    check(snapshot(st) === before, `a refused ${action.type} in ${phase} changed the state`);
  }
}

/* nextHand from handOver is the one thing that must work, from any seated
 * player — the room layers its own policy on top, but the engine's answer is
 * yes. */
{
  const st = advanceTo('handOver');
  const r = G.applyAction(st, 2, { type: 'nextHand' });
  check(r.ok === true, 'a seated player could not deal the next hand: ' + r.reason);
}

console.log('authorization: ' + checks.toLocaleString() + ' assertions');
if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  process.exit(1);
}
console.log('authorization: OK');
