/* Does the computer cheat?
 *
 * js/view.js decides what a HUMAN seat may see. Nothing there constrains the
 * computer players at all: the room runs them on the full authoritative state,
 * because they need it — the dealer's own discard is part of what that seat
 * legitimately knows, and feeding a bot a projection would hand it placeholder
 * cards with no fields and make it play nonsense.
 *
 * So the AI's honesty is enforced by convention inside js/ai.js, and a
 * convention with no test is a comment. This file is the test.
 *
 * IT MATTERS MORE ONLINE THAN OFF. In a single-player game a cheating AI is a
 * quality complaint. At a table where three of the four seats are computers and
 * one is a person, it is three players colluding against them — and it would be
 * completely invisible, because the cheating bot plays legal cards and simply
 * wins more than it should.
 *
 *   node tests/hidden-information.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 31337;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout, Object };
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

/* ============ 1. THE TRAP ============
 *
 * While the computer decides its move for seat p, every OTHER seat's hand is
 * behind a getter that records the access. The bot is entitled to its own hand
 * and to nothing else, so any entry in `touched` is a bot reading cards it
 * cannot see.
 *
 * A getter that records and returns is better than one that throws: a throw
 * would be caught by the gate's fatal handler and reported as an engine fault,
 * which is a confusing way to learn about a privacy bug. This way the run
 * completes and the failure names the seat.
 */
function withTrap(st, forSeat, fn) {
  const touched = [];
  const restore = [];
  for (let q = 0; q < 4; q++) {
    if (q === forSeat) continue;
    const player = st.players[q];
    const real = player.hand;
    const seat = q;
    Object.defineProperty(player, 'hand', {
      configurable: true,
      enumerable: true,
      get() { touched.push(seat); return real; },
      set(v) { /* nothing writes another seat's hand during a decision */ }
    });
    restore.push(() => {
      delete player.hand;
      player.hand = real;
    });
  }
  let out;
  try { out = fn(); } finally { restore.forEach(r => r()); }
  return { touched, out };
}

let decisions = 0;
let alonesSeen = 0;
let discardsSeen = 0;

for (let g = 0; g < 250; g++) {
  const st = newGame({
    stickTheDealer: g % 2 === 0,
    difficulty: ['easy', 'normal', 'hard'][g % 3]
  });
  G.applyAction(st, 0, { type: 'start' });

  let guard = 0;
  while (st.phase !== 'handOver' && guard++ < 400) {
    const p = G.seatToAct(st);
    if (p < 0) break;
    if (st.phase === 'discard') discardsSeen++;

    const { touched } = withTrap(st, p, () => AI.decide(st, p));
    decisions++;
    if (touched.length) {
      fails.push(`the computer at seat ${p + 1} read seat ${[...new Set(touched)]
        .map(x => x + 1).join(', ')}'s cards while deciding at ${st.phase}`);
    }

    AI.act(st);
    st.events.length = 0;
  }
  if (st.alone) alonesSeen++;
}

check(decisions > 5000, 'only ' + decisions + ' decisions were watched');
check(discardsSeen > 150, 'the discard decision was only reached ' + discardsSeen + ' times');
check(alonesSeen > 5, 'only ' + alonesSeen + ' hands had somebody going alone');

/* The trap has to be capable of firing, or the run above proves nothing. */
{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  const { touched } = withTrap(st, 0, () => st.players[1].hand.length);
  check(touched.length === 1, 'the trap does not fire when another hand IS read — ' +
    'every result above is meaningless');
}

/* ============ 2. THE DISCARD IS INVISIBLE TO EVERYBODY ELSE ============
 *
 * Two worlds identical but for which card the dealer put back. Every other
 * seat's decisions must be the same in both — not similar, identical. Randomness
 * is what makes this delicate, so the seeded generator is reset between the two
 * runs and the difficulty is pinned to hard, which is the one setting with no
 * deliberate random misplay in it. */
{
  let tested = 0, diverged = 0;
  for (let trial = 0; trial < 600 && tested < 60; trial++) {
    const st = newGame({ difficulty: 'hard' });
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== 'discard' && st.phase !== 'handOver' && guard++ < 200) AI.act(st);
    if (st.phase !== 'discard') continue;

    const hand = st.players[st.dealer].hand.map(c => c.id);
    if (hand.length < 2) continue;
    tested++;

    const a = JSON.parse(JSON.stringify(st));
    const b = JSON.parse(JSON.stringify(st));
    G.applyAction(a, a.dealer, { type: 'discard', card: hand[0] });
    G.applyAction(b, b.dealer, { type: 'discard', card: hand[1] });

    for (let seat = 0; seat < 4; seat++) {
      if (seat === a.dealer) continue;
      if (seat === a.sittingOut) continue;
      if (G.seatToAct(a) !== seat) continue;
      const savedSeed = seed;
      const da = JSON.stringify(AI.decide(a, seat));
      seed = savedSeed;
      const db = JSON.stringify(AI.decide(b, seat));
      seed = savedSeed;
      if (da !== db) {
        diverged++;
        fails.push(`seat ${seat + 1} played differently depending on which card the ` +
          `dealer put back (${hand[0]} vs ${hand[1]}): ${da} vs ${db}`);
      }
      checks++;
    }
  }
  check(tested >= 30, 'the discard counterfactual was only run ' + tested + ' times');
  check(diverged === 0, diverged + ' decisions depended on the hidden discard');
}

/* ============ 3. THE PUBLIC RECORD SAYS NOTHING PRIVATE ============
 *
 * Everything a bystander hears must be the same in both worlds. This is the
 * check that catches a private fact leaking through a public sentence — the
 * failure that cannot be repaired downstream, because you cannot withhold half
 * a sentence. */
{
  let tested = 0;
  for (let trial = 0; trial < 600 && tested < 40; trial++) {
    const st = newGame({ difficulty: 'hard' });
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== 'discard' && st.phase !== 'handOver' && guard++ < 200) AI.act(st);
    if (st.phase !== 'discard') continue;
    const hand = st.players[st.dealer].hand.map(c => c.id);
    if (hand.length < 2) continue;
    tested++;

    const a = JSON.parse(JSON.stringify(st));
    const b = JSON.parse(JSON.stringify(st));
    a.events.length = 0; b.events.length = 0;
    G.applyAction(a, a.dealer, { type: 'discard', card: hand[0] });
    G.applyAction(b, b.dealer, { type: 'discard', card: hand[1] });

    const pubA = a.events.filter(e => e.audience === undefined).map(e => e.text);
    const pubB = b.events.filter(e => e.audience === undefined).map(e => e.text);
    check(JSON.stringify(pubA) === JSON.stringify(pubB),
      'the public announcement of a discard depends on which card it was:\n    ' +
      pubA.join(' | ') + '\n    ' + pubB.join(' | '));

    /* And the number of private events is the same too. A single extra targeted
     * event in one world would be a gap in the id sequence for everybody else,
     * which is itself a signal. */
    check(a.events.filter(e => e.audience !== undefined).length ===
      b.events.filter(e => e.audience !== undefined).length,
      'a different number of private events was emitted for different discards');
  }
  check(tested >= 20, 'the announcement counterfactual was only run ' + tested + ' times');
}

/* ============ 4. AND THE DEALER DOES KNOW THEIR OWN ============
 *
 * The mirror image, and worth asserting: a privacy rule that also hides
 * information from the person entitled to it is a bug, not a stricter version of
 * the same rule. The dealer's own discard is part of what that seat can count. */
{
  let tested = 0;
  for (let trial = 0; trial < 400 && tested < 20; trial++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== 'discard' && st.phase !== 'handOver' && guard++ < 200) AI.act(st);
    if (st.phase !== 'discard') continue;
    const put = st.players[st.dealer].hand[0].id;
    G.applyAction(st, st.dealer, { type: 'discard', card: put });
    tested++;
    const unseen = AI.unseenFor(st, st.dealer).map(c => c.id);
    check(unseen.indexOf(put) < 0,
      'the dealer counts their own discard as a card that might still be out there');
    /* And another seat, which watched a card go face down without seeing it,
     * still counts it as unaccounted for. Getting this backwards would be the
     * same cheat as reading the hand, arriving through the counting aid. */
    const other = (st.dealer + 1) % 4;
    if (other !== st.sittingOut) {
      check(AI.unseenFor(st, other).map(c => c.id).indexOf(put) >= 0,
        'another seat has somehow accounted for the hidden discard');
    }
  }
  check(tested >= 10, 'the dealer-knows-their-own case was only run ' + tested + ' times');
}

console.log('hidden information: ' + checks.toLocaleString() + ' assertions, ' +
  decisions.toLocaleString() + ' decisions watched, ' + alonesSeen + ' alone hands');

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
  process.exit(1);
}
console.log('hidden information: OK');
