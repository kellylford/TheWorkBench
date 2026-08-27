/* The only test that knows what cribbage IS.
 *
 * Everything else in this directory checks that the game is consistent with
 * itself, which is much weaker than it sounds. Cribbage scoring is a pile of
 * special cases and every one of them can be wrong in a way that is perfectly
 * self-consistent: under-count a double run and the total still adds up, the
 * audit still balances, the pegs still move.
 *
 * So the rules are re-implemented here from the How to Play dialog in
 * index.html — AND DELIBERATELY BY DIFFERENT ALGORITHMS. That second part is
 * what makes this worth writing rather than a copy of the engine with the
 * variable names changed:
 *
 *   fifteens   the engine enumerates subsets with a bitmask. This recurses.
 *   runs       the engine enumerates subsets and counts maximal ones. This
 *              builds a rank histogram, walks it for consecutive stretches, and
 *              multiplies the multiplicities — the standard alternative method,
 *              which is how a person actually counts a double run.
 *   pairs      the engine groups by rank and looks up 2/6/12. This uses the
 *              combination formula.
 *
 * Two implementations that agree on 100,000 hands are unlikely to be wrong in
 * the same direction. Two copies of one implementation agree on everything.
 *
 * This file may not call G.scoreHand, G.pointsForPlay or G.isRun to decide what
 * it expects. Those are the things on trial.
 *
 *   node tests/rules-oracle.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 8675309;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Cards: C, Game: G, AI } = sandbox.SH;

const fails = [];
let checks = 0;
function check(cond, msg) { checks++; if (!cond) fails.push(msg); }

/* ================= THE RULES, WRITTEN OUT ================= */

const SUITS = ['C', 'S', 'H', 'D'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

/* "ace is one, and the ten, jack, queen and king are all ten" */
const VALUE = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 10, Q: 10, K: 10 };
/* "ace is one and the king is thirteen, so a ten really is lower than a jack" */
const ORDER = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13 };

const DECK_IDS = [];
for (const s of SUITS) for (const r of RANKS) DECK_IDS.push(r + s);

/* "2 for every combination adding to 15" — counted by recursion, not by a
 * bitmask. */
function oracleFifteens(cards) {
  let found = 0;
  (function walk(i, sum, used) {
    if (i === cards.length) {
      if (used >= 2 && sum === 15) found++;
      return;
    }
    walk(i + 1, sum, used);                                  // leave it out
    walk(i + 1, sum + VALUE[cards[i][0]], used + 1);         // take it
  })(0, 0, 0);
  return found * 2;
}

/* "2 each. Three of a kind is three pairs, so 6; four is 12." — by the
 * combination formula rather than a lookup table. */
function oraclePairs(cards) {
  const byRank = {};
  for (const id of cards) byRank[id[0]] = (byRank[id[0]] || 0) + 1;
  let pts = 0;
  for (const r of Object.keys(byRank)) {
    const n = byRank[r];
    pts += (n * (n - 1) / 2) * 2;
  }
  return pts;
}

/* "one per card, and scored once for every distinct set that makes it" —
 * by histogram and multiplicity, which is how a person counts a double run.
 *
 * Walk the thirteen ranks. Any maximal stretch of consecutive ranks that are all
 * present and is three or more long is a run; it scores its length once for
 * every way of choosing one card from each rank in it, which is the product of
 * the multiplicities. */
function oracleRuns(cards) {
  const count = {};
  for (const id of cards) {
    const o = ORDER[id[0]];
    count[o] = (count[o] || 0) + 1;
  }
  let pts = 0;
  let o = 1;
  while (o <= 13) {
    if (!count[o]) { o++; continue; }
    let end = o;
    let mult = 1;
    while (count[end]) { mult *= count[end]; end++; }
    const len = end - o;
    if (len >= 3) pts += len * mult;
    o = end;
  }
  return pts;
}

/* "4 for all four cards in your hand matching, 5 if the starter matches too. In
 * the crib it must be all five or it scores nothing." */
function oracleFlush(hand4, starter, isCrib) {
  const suit = hand4[0][1];
  if (!hand4.every(id => id[1] === suit)) return 0;
  const withStarter = starter && starter[1] === suit;
  if (isCrib) return withStarter ? 5 : 0;
  return withStarter ? 5 : 4;
}

/* "the jack of the starter's suit, in your hand" */
function oracleNob(hand4, starter) {
  if (!starter) return 0;
  return hand4.some(id => id[0] === 'J' && id[1] === starter[1]) ? 1 : 0;
}

function oracleScore(hand4, starter, isCrib) {
  const all = starter ? hand4.concat([starter]) : hand4.slice();
  return oracleFifteens(all) + oraclePairs(all) + oracleRuns(all) +
    oracleFlush(hand4, starter, isCrib) + oracleNob(hand4, starter);
}

/* ================= 1. THE DECK AND THE TWO NUMBERS ================= */
{
  const deck = C.newDeck();
  check(deck.length === 52, 'the deck has ' + deck.length + ' cards, not 52');
  check(JSON.stringify(deck.map(c => c.id).sort()) === JSON.stringify(DECK_IDS.slice().sort()),
    'the deck is not the 52 cards the rules describe');
  for (const id of DECK_IDS) {
    const c = C.get(id);
    check(C.value(c) === VALUE[id[0]],
      `${id} counts ${C.value(c)}, the rules say ${VALUE[id[0]]}`);
    check(C.order(c) === ORDER[id[0]],
      `${id} sits at ${C.order(c)} in a run, the rules say ${ORDER[id[0]]}`);
  }
  /* The confusion the stable game had at the cut: a ten is LOWER than a jack. */
  check(C.order(C.get('TC')) < C.order(C.get('JC')),
    'a ten must be lower than a jack when cutting for deal');
  check(C.value(C.get('TC')) === C.value(C.get('JC')),
    'a ten and a jack must count the same during the play');
}

/* ================= 2. KNOWN HANDS ================= */
const FIXTURES = [
  [['5C', '5S', '5H', 'JD'], '5D', false, 29, 'the perfect hand'],
  [['5C', '5S', '5H', '5D'], 'JC', false, 28, 'four fives and a jack cut'],
  [['4C', '5S', '6H', '6D'], 'KC', false, 14, 'a double run of three with a fifteen'],
  [['4C', '5S', '6H', '7D'], '8C', false, 9, 'a run of five and two fifteens'],
  [['AC', '2S', '3H', 'KD'], '5C', false, 7, 'a run of three, and two fifteens with it'],
  [['AC', '3S', '7D', 'JH'], 'KS', false, 0, 'a hand worth absolutely nothing'],
  [['4C', '6C', '8C', 'KC'], '2C', false, 5, 'a five-card flush'],
  [['4C', '6C', '8C', 'KC'], '2H', false, 4, 'a four-card flush in the hand'],
  [['4C', '6C', '8C', 'KC'], '2H', true, 0, 'a four-card flush in the CRIB scores nothing'],
  [['4C', '6C', '8C', 'KC'], '2C', true, 5, 'a five-card flush in the crib does score'],
  [['JC', '2S', '4H', '9D'], 'KC', false, 3, 'a fifteen and one for his nob'],
  [['JC', '2S', '4H', '9D'], 'KH', false, 2, 'the same hand, but the jack is the wrong suit for a nob'],
  [['7C', '8S', '7H', '8D'], '9C', false, 24, 'the double-double run'],
  [['3C', '4S', '5H', '6D'], '3D', false, 14, 'a double run of four with fifteens']
];

for (const [ids, starterId, isCrib, want, label] of FIXTURES) {
  if (want === null) continue;
  const cards = ids.map(C.get);
  const starter = C.get(starterId);
  const got = G.scoreHand(cards, starter, isCrib);
  const oracle = oracleScore(ids, starterId, isCrib);
  check(oracle === want,
    `THE ORACLE ITSELF is wrong about ${label}: it says ${oracle}, the rules say ${want}`);
  check(got.total === want,
    `${label} (${ids.join(' ')} + ${starterId}${isCrib ? ', crib' : ''}) scored ` +
    `${got.total}, should be ${want} — ${G.describeScore(got)}`);
  /* The parts must add up to the total, or the breakdown read out to a player is
   * not the score they were given. */
  const sum = got.parts.reduce((a, p) => a + p.points, 0);
  check(sum === got.total,
    `${label}: the breakdown adds to ${sum} but the total is ${got.total}`);
}

/* ================= 3. EVERY HAND, AGAINST THE OTHER ALGORITHM ================= */
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

let handsChecked = 0;
const reached = { flush4: 0, flush5: 0, nob: 0, doubleRun: 0, tripleRun: 0, big: 0, zero: 0 };

for (let n = 0; n < 40000; n++) {
  const picked = shuffled(DECK_IDS).slice(0, 5);
  const hand = picked.slice(0, 4);
  const starter = picked[4];
  const isCrib = n % 3 === 0;

  const want = oracleScore(hand, starter, isCrib);
  const got = G.scoreHand(hand.map(C.get), C.get(starter), isCrib);
  handsChecked++;
  check(want === got.total,
    `${hand.join(' ')} + ${starter}${isCrib ? ' (crib)' : ''}: engine ${got.total}, ` +
    `rules ${want} — engine said ${G.describeScore(got)}`);

  const sum = got.parts.reduce((a, p) => a + p.points, 0);
  check(sum === got.total, 'the breakdown does not add to the total for ' + hand.join(' '));

  if (oracleFlush(hand, starter, false) === 4) reached.flush4++;
  if (oracleFlush(hand, starter, false) === 5) reached.flush5++;
  if (oracleNob(hand, starter)) reached.nob++;
  const runPts = oracleRuns(hand.concat([starter]));
  if (runPts === 6 || runPts === 8) reached.doubleRun++;
  if (runPts >= 9) reached.tripleRun++;
  if (want >= 20) reached.big++;
  if (want === 0) reached.zero++;
}

/* Deliberately weighted decks, because a uniform sample almost never produces
 * the hands where the scoring is hard. A triple run comes up about once in two
 * thousand random hands and is exactly where an implementation goes wrong. */
const NASTY_RANKS = ['4', '5', '5', '5', '6', '6', '7', '7', '8', 'J', 'T', '5'];
for (let n = 0; n < 20000; n++) {
  const pool = [];
  for (const r of NASTY_RANKS) {
    for (const s of SUITS) pool.push(r + s);
  }
  const picked = [];
  const seen = new Set();
  const bag = shuffled(pool);
  for (const id of bag) {
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push(id);
    if (picked.length === 5) break;
  }
  const hand = picked.slice(0, 4);
  const starter = picked[4];
  const isCrib = n % 4 === 0;
  const want = oracleScore(hand, starter, isCrib);
  const got = G.scoreHand(hand.map(C.get), C.get(starter), isCrib);
  handsChecked++;
  check(want === got.total,
    `weighted ${hand.join(' ')} + ${starter}: engine ${got.total}, rules ${want}`);
  const runPts = oracleRuns(hand.concat([starter]));
  if (runPts === 6 || runPts === 8) reached.doubleRun++;
  if (runPts >= 9) reached.tripleRun++;
  if (want >= 20) reached.big++;
}

for (const [name, min] of [['flush4', 20], ['flush5', 2], ['nob', 800],
  ['doubleRun', 400], ['tripleRun', 40], ['big', 100], ['zero', 200]]) {
  check(reached[name] >= min,
    `only ${reached[name]} hands reached the "${name}" case (wanted at least ${min}); ` +
    'that branch is effectively untested');
}

/* ================= 4. THE PLAY ================= */

/* "Fifteen 2, thirty-one 2, a pair 2, three of a kind 6, four 12, a run of three
 * or more one per card, and they need not arrive in order." Re-implemented, and
 * deliberately not by walking backwards the way the engine does. */
function oraclePlayPoints(seqIds, count) {
  let pts = 0;
  if (count === 15) pts += 2;
  if (count === 31) pts += 2;

  const last = seqIds[seqIds.length - 1];
  let same = 0;
  for (let i = seqIds.length - 1; i >= 0; i--) {
    if (seqIds[i][0] === last[0]) same++; else break;
  }
  if (same >= 2) pts += (same * (same - 1) / 2) * 2;

  for (let len = seqIds.length; len >= 3; len--) {
    const tail = seqIds.slice(-len).map(id => ORDER[id[0]]).sort((a, b) => a - b);
    let run = true;
    for (let i = 1; i < tail.length; i++) if (tail[i] !== tail[i - 1] + 1) { run = false; break; }
    if (run) { pts += len; break; }
  }
  return pts;
}

let playChecks = 0;
const playReached = { fifteen: 0, thirtyone: 0, pair: 0, three: 0, four: 0, run: 0 };

for (let n = 0; n < 30000; n++) {
  /* Build a legal-looking sequence directly, so the interesting cases turn up
   * far more often than they would in real play. */
  const bag = shuffled(DECK_IDS);
  const seq = [];
  let count = 0;
  for (const id of bag) {
    if (count + VALUE[id[0]] > 31) continue;
    seq.push(id);
    count += VALUE[id[0]];
    if (seq.length >= 2 + Math.floor(rnd() * 5)) break;
  }
  if (seq.length < 2) continue;

  const candidate = seq[seq.length - 1];
  const before = seq.slice(0, -1);
  const beforeCount = count - VALUE[candidate[0]];

  /* A state the engine will accept: the sequence already down, and the candidate
   * still in hand. Built through createGame rather than invented, so the shape
   * is whatever the engine really uses. */
  const st = G.createGame({ names: ['a', 'b'], targetScore: 121, difficulty: 'hard' });
  st.phase = 'play';
  st.count = beforeCount;
  st.runStart = 0;
  st.pile = before.map((id, i) => ({ player: i % 2, card: C.get(id) }));

  const want = oraclePlayPoints(seq, count);
  const got = G.pointsForPlay(st, C.get(candidate));
  playChecks++;
  check(want === got.total,
    `play ${before.join(' ')} then ${candidate} at ${beforeCount}: engine ${got.total}, ` +
    `rules ${want}`);
  check(got.count === count, 'pointsForPlay reported the wrong resulting count');
  const partSum = got.parts.length;
  check(got.total === 0 || partSum > 0, 'points were scored with nothing to say about them');

  if (count === 15) playReached.fifteen++;
  if (count === 31) playReached.thirtyone++;
  let same = 0;
  for (let i = seq.length - 1; i >= 0; i--) { if (seq[i][0] === candidate[0]) same++; else break; }
  if (same === 2) playReached.pair++;
  if (same === 3) playReached.three++;
  if (same === 4) playReached.four++;
  if (want > 0 && same < 2 && count !== 15 && count !== 31) playReached.run++;
}

for (const [name, min] of [['fifteen', 200], ['thirtyone', 100], ['pair', 200], ['run', 50]]) {
  check(playReached[name] >= min,
    `only ${playReached[name]} plays reached the "${name}" case (wanted ${min})`);
}

/* ================= 5. THE COUNT RESET ================= */
/* The bug the fork was made to fix. A card laid after the count has gone back to
 * nothing must not pair with, or run onto, anything from before the reset. */
{
  const st = G.createGame({ names: ['a', 'b'], targetScore: 121, difficulty: 'hard' });
  st.phase = 'play';
  /* Five, five, then a reset, then a third five. Without a reset that is three
   * of a kind for six; with one it is nothing at all. */
  /* Kings rather than fives, so the count cannot reach fifteen or thirty-one and
   * confuse the two points a pair is worth with the two a fifteen is. The first
   * draft used fives at a count of ten, which makes fifteen on the third card
   * and scores eight — a test that was wrong in exactly the way it was written
   * to catch. */
  st.pile = [
    { player: 0, card: C.get('KC') },
    { player: 1, card: C.get('KS') }
  ];
  st.runStart = 0;
  st.count = 20;
  check(G.pointsForPlay(st, C.get('KH')).total === 6,
    'three kings in one sequence must be three of a kind for six');

  st.runStart = 2;      // the count has reset; the kings are behind us
  st.count = 0;
  check(G.pointsForPlay(st, C.get('KH')).total === 0,
    'a king laid after a count reset must NOT pair with kings from before it — ' +
    'this is the bug the fork exists to fix');

  /* Four of a kind, which a random sequence almost never produces: four aces is
   * a count of four, and twelve points. */
  st.pile = [
    { player: 0, card: C.get('AC') },
    { player: 1, card: C.get('AS') },
    { player: 0, card: C.get('AH') }
  ];
  st.runStart = 0;
  st.count = 3;
  check(G.pointsForPlay(st, C.get('AD')).total === 12,
    'four of a kind during the play is twelve');

  /* A pair split by an intervening card is not a pair. */
  st.pile = [
    { player: 0, card: C.get('KC') },
    { player: 1, card: C.get('2S') }
  ];
  st.runStart = 0;
  st.count = 12;
  check(G.pointsForPlay(st, C.get('KH')).total === 0,
    'a king, then a two, then a king is not a pair');

  /* Same for runs. */
  st.pile = [
    { player: 0, card: C.get('3C') },
    { player: 1, card: C.get('4S') }
  ];
  st.runStart = 0;
  st.count = 7;
  check(G.pointsForPlay(st, C.get('5H')).total === 3, 'three, four, five is a run of three');
  st.runStart = 2;
  st.count = 0;
  check(G.pointsForPlay(st, C.get('5H')).total === 0,
    'a run must not be built across a count reset');
}

/* ================= 6. WHOLE HANDS, RE-SCORED ================= */
const seenCases = { heels: 0, go: 0, lastCard: 0, thirtyOne: 0 };
for (let g = 0; g < 400; g++) {
  const st = G.createGame({
    names: ['N', 'S'], targetScore: 121,
    difficulty: ['easy', 'normal', 'hard'][g % 3]
  });
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  while (!st.gameOver && guard++ < 4000) {
    if (st.phase === 'roundOver') { G.applyAction(st, 0, { type: 'nextHand' }); continue; }
    AI.act(st);
  }
  check(st.gameOver, 'a game never finished');

  for (const h of st.history) {
    if (!h.starter) continue;
    /* Every recorded count re-derived by the ORACLE, not by the engine. */
    for (const c of h.counts) {
      const cards = c.kind === 'crib' ? h.crib : h.kept[c.who];
      if (!cards || cards.length !== 4) continue;
      const want = oracleScore(cards, h.starter, c.kind === 'crib');
      check(want === c.total,
        `hand ${h.handNumber}: the ${c.kind} scored ${c.total}, the rules give ${want} ` +
        `(${cards.join(' ')} + ${h.starter})`);
    }
    /* The count never went past thirty-one, checked against the rules' own
     * values rather than the engine's. */
    let running = 0;
    for (const e of h.pile) {
      const v = VALUE[e.card[0]];
      if (running + v > 31) running = 0;
      running += v;
      check(running <= 31, `hand ${h.handNumber}: the count reached ${running}`);
      if (running === 31) seenCases.thirtyOne++;
    }
    if (h.starter[0] === 'J') seenCases.heels++;
  }
  for (const e of st.events) {
    if (/for the go/.test(e.text)) seenCases.go++;
    if (/for the last card/.test(e.text)) seenCases.lastCard++;
  }
}

for (const [name, min] of [['heels', 5], ['go', 50], ['lastCard', 50], ['thirtyOne', 20]]) {
  check(seenCases[name] >= min,
    `only ${seenCases[name]} hands reached the "${name}" case (wanted ${min})`);
}

/* ================= 7. THE LEDGER =================
 *
 * THE GAP THIS SECTION EXISTS TO CLOSE. Everything above validates
 * `pointsForPlay` IN ISOLATION and re-scores the hand and crib counts. Nothing
 * checked that the points a player actually ENDED UP WITH are the points the
 * rules say they earned — so the whole of the pegging was covered only as a
 * pure function, never as it is used.
 *
 * An independent review demonstrated the hole with six mutations that passed
 * every suite in this directory:
 *
 *   resetCount never advancing runStart      (the bug this fork exists to fix)
 *   doPlay scoring AFTER the card joins the pile, so every card pegs a phantom
 *     pair — a 121 game finishes in six hands and the audit reports nothing
 *   his heels paid to the non-dealer
 *   the go point paid to the wrong player
 *   the wrong player leading after a mutual go
 *   the wrong player leading after thirty-one
 *
 * Section 5 tests the reset by SETTING runStart BY HAND, which proves
 * pointsForPlay honours the field and never that resetCount sets it. That is the
 * difference between testing a function and testing a game.
 *
 * So: replay every completed hand from the permanent record, derive every single
 * point from the rules — his heels, every card of the pegging, the go, the last
 * card, both hands and the crib — and assert the total for each player equals
 * what their score actually moved by. The replay also re-derives WHOSE TURN it
 * was at every step from the cards each player still held, which is what catches
 * the two leader mutations: a pile is perfectly self-consistent with the wrong
 * player leading, and only the rules say otherwise.
 */
function replayHand(h) {
  const got = [0, 0];
  const notes = [];

  /* His heels: a jack turned pays the DEALER two, at the cut. */
  if (h.starter && h.starter[0] === 'J') got[h.dealer] += 2;

  /* The pegging, replayed from the cards each player kept. */
  const remaining = [new Set(h.kept[0]), new Set(h.kept[1])];
  let turn = 1 - h.dealer;              // the non-dealer leads
  let count = 0;
  let seq = [];

  for (let i = 0; i < h.pile.length; i++) {
    const e = h.pile[i];
    if (e.player !== turn) {
      notes.push(`card ${i + 1} was laid by seat ${e.player + 1}, the rules say seat ${turn + 1}`);
      return { got, notes };
    }
    if (!remaining[e.player].has(e.card)) {
      notes.push(`card ${i + 1} (${e.card}) was not in seat ${e.player + 1}'s hand`);
      return { got, notes };
    }
    const v = VALUE[e.card[0]];
    if (count + v > 31) {
      notes.push(`card ${i + 1} (${e.card}) took the count to ${count + v}`);
      return { got, notes };
    }

    count += v;
    seq.push(e.card);
    got[e.player] += oraclePlayPoints(seq, count);
    remaining[e.player].delete(e.card);

    if (!remaining[0].size && !remaining[1].size) {
      /* One for the last card — unless it made thirty-one, which has already
       * been paid two and does not also collect this. */
      if (count !== 31) got[e.player] += 1;
      break;
    }

    const opp = 1 - e.player;
    const canPlay = seat => [...remaining[seat]].some(id => count + VALUE[id[0]] <= 31);

    /* Who leads the next sequence after a reset.
     *
     * Whoever did NOT lay the last card — unless they have run out, in which
     * case they say go to a count of nothing and the other player leads on. The
     * first draft handed the lead to an empty-handed player and then reported
     * every eighth card as laid by the wrong seat, which is the replay being
     * wrong rather than the engine. A go from somebody holding no cards scores
     * nobody anything: the count is zero, so the other player can always play. */
    const leadAfterReset = () => (remaining[opp].size ? opp : e.player);

    if (count === 31) { count = 0; seq = []; turn = leadAfterReset(); continue; }
    if (canPlay(opp)) { turn = opp; continue; }
    if (canPlay(e.player)) { turn = e.player; continue; }   // opponent says go, we carry on

    /* Neither can play: one for the go to whoever laid last, and the other
     * player leads the next sequence. */
    got[e.player] += 1;
    count = 0; seq = []; turn = leadAfterReset();
  }

  /* The counts: non-dealer's hand, dealer's hand, the crib. */
  for (const c of h.counts) {
    const cards = c.kind === 'crib' ? h.crib : h.kept[c.who];
    if (!cards || cards.length !== 4) continue;
    got[c.who] += oracleScore(cards, h.starter, c.kind === 'crib');
  }
  return { got, notes };
}

{
  let ledgered = 0;
  for (let g = 0; g < 120; g++) {
    const st = G.createGame({
      names: ['N', 'S'], targetScore: 121,
      difficulty: ['easy', 'normal', 'hard'][g % 3]
    });
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (!st.gameOver && guard++ < 6000) {
      if (st.phase === 'roundOver') { G.applyAction(st, 0, { type: 'nextHand' }); continue; }
      AI.act(st);
    }

    let prev = [0, 0];
    for (const h of st.history) {
      /* Only hands that ran to the end. A hand somebody won part way through
       * stops scoring at that moment, and deriving where it stopped would be
       * re-implementing the win check rather than the scoring. */
      const complete = h.counts.length === 3 && !(h.result && h.result.gameOver);
      if (!complete) { prev = h.scores.slice(); continue; }

      const { got, notes } = replayHand(h);
      ledgered++;
      if (notes.length) {
        fails.push(`hand ${h.handNumber}: ${notes.join('; ')}`);
        prev = h.scores.slice();
        continue;
      }
      const moved = [h.scores[0] - prev[0], h.scores[1] - prev[1]];
      check(got[0] === moved[0] && got[1] === moved[1],
        `hand ${h.handNumber}: the rules give ${got.join('/')} but the scores moved ` +
        `${moved.join('/')} (starter ${h.starter}, ` +
        `kept ${h.kept.map(k => k.join(' ')).join(' | ')}, ` +
        `pile ${h.pile.map(e => e.player + ':' + e.card).join(' ')})`);
      prev = h.scores.slice();
    }
  }
  check(ledgered > 600, 'only ' + ledgered + ' hands were put through the ledger');
  console.log('  ledger: ' + ledgered.toLocaleString() +
    ' complete hands re-derived point by point');
}

console.log('rules oracle: ' + checks.toLocaleString() + ' assertions');
console.log('  ' + handsChecked.toLocaleString() + ' hands and ' +
  playChecks.toLocaleString() + ' plays scored twice, by different algorithms');
console.log('  hands reached: ' + Object.entries(reached).map(([k, v]) => k + ' ' + v).join(', '));
console.log('  play reached:  ' + Object.entries(playReached).map(([k, v]) => k + ' ' + v).join(', '));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  if (fails.length > 25) console.error('  ... and ' + (fails.length - 25) + ' more');
  process.exit(1);
}
console.log('rules oracle: OK');
