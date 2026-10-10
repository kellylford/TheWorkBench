/* Does the computer cheat?
 *
 * THIS FILE IS THE HEADLINE CLAIM OF THE FORK. The stable game in `Cribbage/`
 * reads the human's hand while deciding what to lay:
 *
 *     const opponentHand = this.player.hand.filter(...)
 *     if (opponentHand.some(c => newCount + c.value === 31)) score -= 15;
 *     if (opponentHand.some(c => newCount + c.value === 15)) score -= 8;
 *     if (opponentHand.some(c => c.rank === card.rank))      score -= 5;
 *
 * In a single-player game that is a quality problem — the opponent is uncannily
 * good at not setting you up. At a table where a bot can fill a seat opposite a
 * stranger it is cheating, and invisible cheating: every card it lays is legal
 * and it simply wins more than it should.
 *
 * js/view.js decides what a HUMAN seat may see, and constrains the computer not
 * at all — the room runs it on the full authoritative state because it needs to.
 * So the honesty is a convention inside js/ai.js, and a convention with no test
 * is a comment.
 *
 *   node tests/hidden-information.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 5150555;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout, Object };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Cards: C, Game: G, AI } = sandbox.SH;

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

function newGame(opts) {
  return G.createGame(Object.assign({
    names: ['North', 'South'], targetScore: 121, difficulty: 'hard'
  }, opts || {}));
}

/* ============ 1. THE TRAP ============
 *
 * While the computer decides for seat p, everything it may not see sits behind a
 * getter that records the access:
 *
 *   the other seat's hand, kept cards and discard
 *   the crib — hidden from BOTH players until it is counted, which is unique to
 *              cribbage among the games here
 *   the undealt remainder, which would give away the opponent's hand exactly by
 *              elimination
 *
 * A getter that records and returns beats one that throws: a throw is caught by
 * the gate's fatal handler and reported as an engine fault, which is a confusing
 * way to learn about a privacy bug.
 */
function withTrap(st, forSeat, fn) {
  const touched = [];
  const restore = [];

  function guard(obj, key, label) {
    const real = obj[key];
    Object.defineProperty(obj, key, {
      configurable: true, enumerable: true,
      get() { touched.push(label); return real; },
      set() { /* nothing writes these during a decision */ }
    });
    restore.push(() => { delete obj[key]; obj[key] = real; });
  }

  const opp = G.other(forSeat);
  guard(st.players[opp], 'hand', 'the other seat’s hand');
  guard(st.players[opp], 'kept', 'the other seat’s kept cards');
  guard(st, 'crib', 'the crib');
  guard(st, 'deck', 'the undealt pack');
  /* `dealt` and `history` were not guarded by the first version of this trap,
   * and `dealt` is the one a careless edit would reach for: it holds BOTH seats'
   * six cards, live, from the moment of the deal. The computer is clean today —
   * but a test that would not have noticed is not what is keeping it clean. */
  guard(st, 'dealt', 'the dealt snapshot, which holds both hands');
  guard(st, 'history', 'the record of previous hands');

  /* The opponent's discard, but not our own — we are entitled to remember what
   * we threw. `discarded` is one array, so the guard goes on the index. */
  const realDiscarded = st.discarded;
  const proxy = realDiscarded.slice();
  Object.defineProperty(proxy, String(opp), {
    configurable: true, enumerable: true,
    get() { touched.push('the other seat’s discard'); return realDiscarded[opp]; }
  });
  st.discarded = proxy;
  restore.push(() => { st.discarded = realDiscarded; });

  let out;
  try { out = fn(); } finally { restore.forEach(r => r()); }
  return { touched, out };
}

let decisions = 0;
const byPhase = {};

for (let g = 0; g < 200; g++) {
  const st = newGame({ difficulty: ['easy', 'normal', 'hard'][g % 3] });
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  while (!st.gameOver && guard++ < 3000) {
    if (st.phase === 'roundOver') { G.applyAction(st, 0, { type: 'nextHand' }); continue; }
    const p = G.seatToAct(st);
    if (p < 0) break;
    byPhase[st.phase] = (byPhase[st.phase] || 0) + 1;

    const { touched } = withTrap(st, p, () => AI.decide(st, p));
    decisions++;
    if (touched.length) {
      fails.push(`at ${st.phase}, the computer in seat ${p + 1} read ` +
        [...new Set(touched)].join(' and '));
    }
    AI.act(st);
    st.events.length = 0;
  }
}

check(decisions > 8000, 'only ' + decisions + ' decisions were watched');
for (const phase of ['discard', 'play']) {
  check((byPhase[phase] || 0) > 500,
    'only ' + (byPhase[phase] || 0) + ' decisions were watched at ' + phase);
}

/* The trap has to be capable of firing, or every result above is meaningless. */
{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  G.applyAction(st, 0, { type: 'cut' });
  for (const [what, read] of [
    ['the opponent’s hand', () => st.players[1].hand.length],
    ['the undealt pack', () => st.deck.length],
    ['the crib', () => st.crib.length],
    ['the dealt snapshot', () => st.dealt && st.dealt.hands.length],
    ['the history', () => st.history.length]
  ]) {
    const probe = withTrap(st, 0, read);
    check(probe.touched.length === 1, 'the trap does not fire on ' + what);
  }
}

/* And the honest version really is being used: the computer works from what it
 * has NOT seen, and that set must shrink as cards appear. */
{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  G.applyAction(st, 0, { type: 'cut' });
  const atDeal = AI.unseenFor(st, 0).length;
  check(atDeal === 46, 'at the deal a seat has seen its own six; unseen was ' + atDeal);
  let guard = 0;
  while (st.phase !== 'play' && guard++ < 50) AI.act(st);
  const inPlay = AI.unseenFor(st, 0).length;
  check(inPlay < atDeal,
    'the unseen set did not shrink once the starter and a discard were known');
  /* Its own discard is accounted for; the opponent's is not. */
  const mine = st.discarded[0] || [];
  const theirs = st.discarded[1] || [];
  const unseenIds = AI.unseenFor(st, 0).map(c => c.id);
  mine.forEach(id => check(unseenIds.indexOf(id) < 0,
    'a seat counts its own discard as still unseen'));
  theirs.forEach(id => check(unseenIds.indexOf(id) >= 0,
    'a seat has somehow accounted for the other player’s hidden discard'));
  check(unseenIds.indexOf(st.starter.id) < 0, 'the starter is counted as unseen');
}

/* ============ 2. TWO WORLDS, ONE DIFFERENCE ============
 *
 * Identical games except for what the opponent threw to the crib. Every decision
 * the computer makes, and every word the table hears, must be the same in both.
 * The seeded generator is reset between the two runs and the difficulty pinned
 * to hard, which is the one setting with no deliberate random misplay in it. */
{
  let tested = 0, diverged = 0;
  for (let trial = 0; trial < 400 && tested < 40; trial++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    G.applyAction(st, 0, { type: 'cut' });
    if (st.phase !== 'discard') continue;

    /* Seat 0 throws first, then seat 1 — twice, differently. */
    const s0 = AI.chooseDiscard(st, 0);
    G.applyAction(st, 0, { type: 'discard', cards: s0 });
    const theirHand = st.players[1].hand.map(c => c.id);
    if (theirHand.length < 4) continue;
    tested++;

    const a = JSON.parse(JSON.stringify(st));
    const b = JSON.parse(JSON.stringify(st));
    G.applyAction(a, 1, { type: 'discard', cards: [theirHand[0], theirHand[1]] });
    G.applyAction(b, 1, { type: 'discard', cards: [theirHand[2], theirHand[3]] });

    /* The starter is dealt off the remaining pack, which differs between the two
     * worlds because different cards left it. Force them to agree, or the
     * comparison is about the starter rather than about the discard. */
    b.starter = a.starter;
    b.deck = a.deck.slice();

    /* ONE decision, and only the first.
     *
     * The first draft advanced both worlds and compared several moves. That is
     * not a counterfactual, it is two different games: seat 2 is holding
     * different cards in the two worlds, so as soon as they lay one the pile
     * diverges, the count diverges, and seat 1 is legitimately deciding about
     * different positions. It reported nineteen "leaks", every one of them the
     * test's own doing.
     *
     * At the first play nothing that differs has reached the table yet: same
     * hand, same starter, empty pile, count of nothing. Anything but an
     * identical decision here is seat 1 reading something it may not see. */
    let guard2 = 0;
    while (a.phase !== 'play' && guard2++ < 20 && G.seatToAct(a) !== 0) {
      const p2 = G.seatToAct(a);
      if (p2 < 0) break;
      const m = AI.decide(a, p2);
      G.applyAction(a, p2, m);
      G.applyAction(b, p2, m);
    }
    if (a.phase !== 'play' || G.seatToAct(a) !== 0) continue;

    const savedSeed = seed;
    const da = JSON.stringify(AI.decide(a, 0));
    seed = savedSeed;
    const db = JSON.stringify(AI.decide(b, 0));
    seed = savedSeed;
    checks++;
    if (da !== db) {
      diverged++;
      fails.push('seat 1 opened differently depending on what seat 2 threw to the crib: ' +
        da + ' vs ' + db);
    }
  }
  check(tested >= 20, 'the discard counterfactual was only run ' + tested + ' times');
  check(diverged === 0, diverged + ' decisions depended on the hidden discard');
}

/* ============ 3. WHAT THE TABLE HEARS ============
 *
 * The public record must be identical too. This is the failure that cannot be
 * repaired downstream, because you cannot withhold half a sentence. */
{
  let tested = 0;
  for (let trial = 0; trial < 400 && tested < 40; trial++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    G.applyAction(st, 0, { type: 'cut' });
    if (st.phase !== 'discard') continue;
    const theirHand = st.players[1].hand.map(c => c.id);
    if (theirHand.length < 4) continue;
    tested++;

    const a = JSON.parse(JSON.stringify(st));
    const b = JSON.parse(JSON.stringify(st));
    a.events.length = 0; b.events.length = 0;
    G.applyAction(a, 1, { type: 'discard', cards: [theirHand[0], theirHand[1]] });
    G.applyAction(b, 1, { type: 'discard', cards: [theirHand[2], theirHand[3]] });

    const pubA = a.events.filter(e => e.audience === undefined).map(e => e.text);
    const pubB = b.events.filter(e => e.audience === undefined).map(e => e.text);
    check(JSON.stringify(pubA) === JSON.stringify(pubB),
      'what the table is told about a discard depends on which cards it was:\n    ' +
      pubA.join(' | ') + '\n    ' + pubB.join(' | '));
    check(a.events.filter(e => e.audience !== undefined).length ===
      b.events.filter(e => e.audience !== undefined).length,
      'a different number of private events was emitted for different discards');
  }
  check(tested >= 20, 'the announcement counterfactual was only run ' + tested + ' times');
}

/* ============ 4. AND NOBODY SEES THE CRIB EARLY ============
 *
 * Cribbage hides something from BOTH players, which nothing else in this
 * repository does. Two worlds with different cribs must be indistinguishable to
 * everybody — including the dealer, whose crib it is. */
{
  let tested = 0;
  for (let trial = 0; trial < 300 && tested < 25; trial++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    G.applyAction(st, 0, { type: 'cut' });
    let guard = 0;
    while (st.phase !== 'play' && guard++ < 50) AI.act(st);
    if (st.phase !== 'play') continue;
    tested++;

    const a = JSON.parse(JSON.stringify(st));
    const b = JSON.parse(JSON.stringify(st));
    /* Swap the crib for four cards nobody is holding. Neither player has seen
     * either version, so neither may behave differently. */
    const held = new Set();
    st.players.forEach(p => p.hand.concat(p.kept).forEach(c => held.add(c.id)));
    st.pile.forEach(e => held.add(e.card.id));
    held.add(st.starter.id);
    b.crib = C.newDeck().filter(c => !held.has(c.id)).slice(0, 4)
      .map(c => ({ id: c.id, r: c.r, s: c.s }));

    for (const seat of [0, 1]) {
      if (G.seatToAct(a) !== seat) continue;
      const savedSeed = seed;
      const da = JSON.stringify(AI.decide(a, seat));
      seed = savedSeed;
      const db = JSON.stringify(AI.decide(b, seat));
      seed = savedSeed;
      check(da === db,
        'a player behaved differently depending on what was in the face-down crib');
    }
  }
  check(tested >= 15, 'the crib counterfactual was only run ' + tested + ' times');
}

console.log('hidden information: ' + checks.toLocaleString() + ' assertions, ' +
  decisions.toLocaleString() + ' decisions watched');
console.log('  by phase: ' + Object.entries(byPhase).map(([k, v]) => k + ' ' + v).join(', '));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
  process.exit(1);
}
console.log('hidden information: OK');
