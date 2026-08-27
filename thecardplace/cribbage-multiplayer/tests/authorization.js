/* Can seat A act as seat B?
 *
 * Different from seat ownership, which is "can two clients claim the same
 * chair" and lives in the room. ACTION AUTHORIZATION is "having legitimately got
 * a chair, can I move for the other player" — and it lives in applyAction,
 * because applyAction is the only door into the engine.
 *
 * TWO PLACES CRIBBAGE MAKES THIS EASY TO GET WRONG:
 *
 *   THE DISCARD IS SIMULTANEOUS. Both seats act in the same phase and neither is
 *   "on turn" in the ordinary sense, so a gate written around `turn` would be
 *   meaningless here. What must hold is that a seat can throw its own two cards
 *   and cannot throw the other player's, cannot throw twice, and cannot throw
 *   cards it was not dealt.
 *
 *   THE COUNT BELONGS TO WHOEVER IS COUNTING. Each player counts their own hand
 *   and the dealer counts the crib, so `next` from the wrong seat must be
 *   refused — otherwise one player can run the whole count and the other never
 *   hears their own hand read out, which is most of the game.
 *
 * Also here: hostile payloads. An unhandled throw inside a Durable Object kills
 * the room for everybody at the table.
 *
 *   node tests/authorization.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 60606;
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
const check = (c, m) => { checks++; if (!c) fails.push(m); };

function newGame() {
  return G.createGame({ names: ['North', 'South'], targetScore: 121, difficulty: 'hard' });
}

/* Everything about the state except the event log, which some refusal paths
 * legitimately append to. */
function snapshot(st) {
  const copy = {};
  for (const k of Object.keys(st)) {
    if (k === 'events' || k === 'nextEventId') continue;
    copy[k] = st[k];
  }
  return JSON.stringify(copy);
}

function advanceTo(phase, extra) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== phase && !st.gameOver && guard++ < 400) {
      if (st.phase === 'roundOver') { G.applyAction(st, 0, { type: 'nextHand' }); continue; }
      AI.act(st);
    }
    if (st.phase === phase && (!extra || extra(st))) return st;
  }
  throw new Error('could not reach phase ' + phase);
}

/* ============ 1. THE DISCARD ============ */
for (let trial = 0; trial < 40; trial++) {
  const st = advanceTo('discard');
  for (const seat of [0, 1]) {
    const other = 1 - seat;
    const theirs = st.players[other].hand.map(c => c.id).slice(0, 2);
    const before = snapshot(st);
    const r = G.applyAction(st, seat, { type: 'discard', cards: theirs });
    check(r.ok === false,
      `seat ${seat + 1} threw cards out of seat ${other + 1}'s hand`);
    check(snapshot(st) === before, 'a refused discard changed the state');
  }

  /* Each seat may throw its own, once. */
  const mine = st.players[0].hand.map(c => c.id).slice(0, 2);
  check(G.applyAction(st, 0, { type: 'discard', cards: mine }).ok === true,
    'a seat could not throw its own two cards');
  const again = G.applyAction(st, 0, { type: 'discard', cards: mine });
  check(again.ok === false, 'a seat threw to the crib twice');
  check(/already thrown/.test(again.reason || ''),
    'throwing twice was refused without saying why: ' + again.reason);

  /* Exactly two, and two different ones. */
  const st2 = advanceTo('discard');
  const h = st2.players[0].hand.map(c => c.id);
  for (const bad of [[h[0]], [h[0], h[1], h[2]], [], [h[0], h[0]]]) {
    const before2 = snapshot(st2);
    const r2 = G.applyAction(st2, 0, { type: 'discard', cards: bad });
    check(r2.ok === false, 'a throw of ' + bad.length + ' cards was accepted: ' + JSON.stringify(bad));
    check(snapshot(st2) === before2, 'a refused throw changed the state');
  }
}

/* ============ 2. THE PLAY ============ */
for (let trial = 0; trial < 40; trial++) {
  const st = advanceTo('play');
  const me = st.turn, them = 1 - me;

  const before = snapshot(st);
  const legal = G.legalPlays(st, me);
  if (legal.length) {
    const r = G.applyAction(st, them, { type: 'play', card: legal[0].id });
    check(r.ok === false, 'the seat not on turn played a card');
    check(snapshot(st) === before, 'a refused play changed the state');
  }

  /* Somebody else's card, from the seat that IS on turn. The seat check passes;
   * the card check has to catch it. */
  const theirs = st.players[them].hand[0];
  if (theirs) {
    const r2 = G.applyAction(st, me, { type: 'play', card: theirs.id });
    check(r2.ok === false, 'a seat played a card out of the other hand');
    check(snapshot(st) === before, 'playing another seat\'s card changed the state');
  }

  /* Go is refused from somebody who can play, and from the seat not on turn. */
  if (legal.length) {
    const r3 = G.applyAction(st, me, { type: 'go' });
    check(r3.ok === false, 'go was allowed while a playable card was held');
    check(/must play it/.test(r3.reason || ''), 'the go refusal does not say why: ' + r3.reason);
  }
  const r4 = G.applyAction(st, them, { type: 'go' });
  check(r4.ok === false, 'the seat not on turn said go');
  check(snapshot(st) === before, 'a refused go changed the state');
}

/* ============ 3. THE COUNT ============ */
{
  let tested = 0;
  for (let trial = 0; trial < 400 && tested < 25; trial++) {
    const st = advanceTo('count');
    tested++;
    const counting = st.turn, other = 1 - counting;
    const before = snapshot(st);
    const r = G.applyAction(st, other, { type: 'next' });
    check(r.ok === false,
      'the wrong player counted — one player could run the whole count and the ' +
      'other would never hear their own hand read out');
    check(/not your count/.test(r.reason || ''), 'the count refusal does not say why: ' + r.reason);
    check(snapshot(st) === before, 'a refused count changed the state');
    check(G.applyAction(st, counting, { type: 'next' }).ok === true,
      'the player whose count it is could not count');

    /* And the crib goes to the dealer, not to whoever asks. */
    if (st.phase === 'count' && st.countStage === 2) {
      const rr = G.applyAction(st, 1 - st.dealer, { type: 'next' });
      check(rr.ok === false, 'the non-dealer counted the crib');
    }
  }
  check(tested >= 15, 'the count was only reached ' + tested + ' times');
}

/* ============ 4. PHASE GATES ============ */
const wrongMoment = [
  ['cutForDeal', { type: 'play', card: 'AS' }],
  ['cutForDeal', { type: 'discard', cards: ['AS', '2S'] }],
  ['cutForDeal', { type: 'next' }],
  ['cutForDeal', { type: 'nextHand' }],
  ['discard', { type: 'play', card: 'AS' }],
  ['discard', { type: 'go' }],
  ['discard', { type: 'next' }],
  ['discard', { type: 'cut' }],
  ['play', { type: 'discard', cards: ['AS', '2S'] }],
  ['play', { type: 'next' }],
  ['play', { type: 'nextHand' }],
  ['play', { type: 'cut' }],
  ['count', { type: 'play', card: 'AS' }],
  ['count', { type: 'go' }],
  ['count', { type: 'nextHand' }],
  ['roundOver', { type: 'play', card: 'AS' }],
  ['roundOver', { type: 'next' }],
  ['roundOver', { type: 'discard', cards: ['AS', '2S'] }],
  ['roundOver', { type: 'start' }]
];

for (const [phase, action] of wrongMoment) {
  let st;
  try { st = advanceTo(phase); } catch (e) { continue; }
  for (const seat of [0, 1]) {
    const before = snapshot(st);
    const r = G.applyAction(st, seat, action);
    check(r.ok === false, `${action.type} was accepted during ${phase} from seat ${seat + 1}`);
    check(snapshot(st) === before, `a refused ${action.type} in ${phase} changed the state`);
  }
}

/* nextHand from roundOver is the one thing that must work, from either seat. */
{
  const st = advanceTo('roundOver');
  check(G.applyAction(st, 1, { type: 'nextHand' }).ok === true,
    'a seated player could not deal the next hand: ');
}

/* And after a game is won. This is the case that was actually broken: the engine
 * accepted `nextHand` at gameOver and then refused it one level down, so the
 * button on screen did nothing and said nothing. */
{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  while (!st.gameOver && guard++ < 6000) {
    if (st.phase === 'roundOver') { G.applyAction(st, 0, { type: 'nextHand' }); continue; }
    AI.act(st);
  }
  check(st.gameOver, 'no game was won to test dealing afterwards');
  const r = G.applyAction(st, 0, { type: 'nextHand' });
  check(r.ok === true, 'a new game could not be dealt after one was won: ' + r.reason);
  check(st.players[0].score === 0 && st.players[1].score === 0,
    'a new game did not reset the scores');
  check(st.phase === 'discard', 'a new game did not deal');
}

/* ============ 5. HOSTILE PAYLOADS ============
 *
 * None of these may throw: an unhandled exception inside a Durable Object kills
 * the room for everybody sitting at it. */
const nasty = [
  [0, null], [0, undefined], [0, 'play'], [0, 42], [0, []],
  [0, { type: 'play' }], [0, { type: 'play', card: null }], [0, { type: 'play', card: 99 }],
  [0, { type: 'play', card: 'ZZ' }], [0, { type: 'play', card: '__proto__' }],
  [0, { type: 'constructor' }], [0, { type: '__proto__' }], [0, { type: 'toString' }],
  [0, { type: 'hasOwnProperty' }], [0, { type: 'valueOf' }],
  [0, { type: 'discard', cards: null }], [0, { type: 'discard', cards: 'AS' }],
  [0, { type: 'discard', cards: [{}, {}] }], [0, { type: 'discard', cards: ['__proto__', 'AS'] }],
  [99, { type: 'play', card: 'AS' }], [-1, { type: 'next' }], [1.5, { type: 'go' }],
  ['0', { type: 'next' }], [null, { type: 'cut' }], [NaN, { type: 'nextHand' }]
];

for (const phase of ['cutForDeal', 'discard', 'play', 'count', 'roundOver']) {
  let st;
  try { st = advanceTo(phase); } catch (e) { continue; }
  for (const [seat, action] of nasty) {
    const before = snapshot(st);
    let r;
    try {
      r = G.applyAction(st, seat, action);
    } catch (e) {
      fails.push(`applyAction THREW at ${phase} with seat=${String(seat)} ` +
        `action=${JSON.stringify(action)}: ${e.message}`);
      continue;
    }
    checks++;
    check(r && r.ok === false,
      `a malformed action was accepted at ${phase}: ${JSON.stringify(action)}`);
    check(!r.fatal, `a malformed action came back as fatal at ${phase}: ${r.error}`);
    check(snapshot(st) === before,
      `a malformed action changed the state at ${phase}: ${JSON.stringify(action)}`);
  }
}

console.log('authorization: ' + checks.toLocaleString() + ' assertions');
if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  process.exit(1);
}
console.log('authorization: OK');
