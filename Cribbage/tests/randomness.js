/* Is the deal actually random?
 *
 * The same treatment given to the Sheephead deck in this repo, and for the same
 * reason: reading a shuffle is not enough. The classic broken shuffle,
 * arr.sort(() => Math.random() - 0.5), is visibly a shuffle and badly biased,
 * and it survives review everywhere it appears. So measure the distribution
 * rather than inspect the code.
 *
 * Three independent properties, each of which a biased shuffle fails differently:
 *
 *   1. Every card lands in every position about equally often.
 *   2. The expected number of cards left at their starting index is exactly 1
 *      for a uniform permutation of ANY size — sharp, and nearly free.
 *   3. Both hands, the crib and the cut card draw evenly from the deck.
 *
 *   node tests/randomness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const cutAt = src.indexOf('class GameUI');
if (cutAt < 0) {
  console.error('Could not find `class GameUI` — game.js has been restructured, fix this slice.');
  process.exit(2);
}
const sandbox = { console, Math, Date, JSON, setTimeout };
vm.createContext(sandbox);
vm.runInContext(src.slice(0, cutAt) +
  '\nthis.__engine = { Card, Deck, Player, CribbageGame };', sandbox, { filename: 'game.js' });
const { Deck, CribbageGame } = sandbox.__engine;

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

function chiSquare(matrix, expected) {
  let x2 = 0;
  for (const row of matrix) {
    for (const observed of row) {
      const d = observed - expected;
      x2 += (d * d) / expected;
    }
  }
  return x2;
}

/* Many degrees of freedom makes chi-square near-normal with mean df and sd
 * sqrt(2*df). Six standard deviations is a band a fair shuffle will effectively
 * never leave, and a biased one will not come near. */
function band(df) {
  const sd = Math.sqrt(2 * df);
  return { lo: df - 6 * sd, hi: df + 6 * sd, sd };
}

/* The order the Deck constructor builds in, before it shuffles. Written out
 * here rather than read back from the engine, so a change to the build order
 * cannot quietly redefine what "unshuffled" means. */
const SUITS = ['♥', '♦', '♣', '♠'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BUILD_ORDER = [];
for (const s of SUITS) for (const r of RANKS) BUILD_ORDER.push(r + s);

const startIndex = {};
BUILD_ORDER.forEach((id, i) => { startIndex[id] = i; });

/* ---- 1 & 2: the deck ---- */
{
  const n = 52;
  const SHUFFLES = 20000;
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  let fixedPoints = 0;
  let sane = true;

  for (let s = 0; s < SHUFFLES; s++) {
    const d = new Deck();
    if (d.cards.length !== n) { sane = false; break; }
    for (let pos = 0; pos < n; pos++) {
      const id = d.cards[pos].rank + d.cards[pos].suit;
      const from = startIndex[id];
      if (from === undefined) { sane = false; break; }
      counts[from][pos]++;
      if (from === pos) fixedPoints++;
    }
  }
  check(sane, 'the deck is not the 52 cards this test expects — build order changed?');

  const expected = SHUFFLES / n;
  const x2 = chiSquare(counts, expected);
  const df = (n - 1) * (n - 1);
  const b = band(df);
  console.log('deck uniformity: chi-square ' + x2.toFixed(1) +
    ' (df ' + df + ', fair range ' + b.lo.toFixed(0) + '–' + b.hi.toFixed(0) + ')');
  check(x2 > b.lo && x2 < b.hi,
    'the shuffle is not uniform: chi-square ' + x2.toFixed(1) + ' against df ' + df +
    ', which is ' + Math.abs((x2 - df) / b.sd).toFixed(1) + ' standard deviations out');

  const perShuffle = fixedPoints / SHUFFLES;
  console.log('cards left in place: ' + perShuffle.toFixed(3) + ' per shuffle (fair value 1.000)');
  check(Math.abs(perShuffle - 1) < 0.1,
    'cards are left in their original position ' + perShuffle.toFixed(3) +
    ' times per shuffle; a uniform shuffle leaves exactly 1 on average');
}

/* ---- 3: what the deal actually hands out ---- */
{
  const n = 52;
  const DEALS = 20000;
  // 0 player hand, 1 computer hand, 2 crib, 3 cut card
  const counts = Array.from({ length: 3 }, () => new Array(n).fill(0));
  const cutCounts = new Array(n).fill(0);

  for (let d = 0; d < DEALS; d++) {
    const g = new CribbageGame();
    g.dealer = d % 2 === 0 ? g.computer : g.player;
    g.startRound();
    g.player.hand.forEach(c => counts[0][startIndex[c.rank + c.suit]]++);
    g.computer.hand.forEach(c => counts[1][startIndex[c.rank + c.suit]]++);
    // Discard so the crib and the cut card are filled the way a real round does it.
    g.discardToCrib([0, 1]);
    g.crib.forEach(c => counts[2][startIndex[c.rank + c.suit]]++);
    if (g.cutCard) cutCounts[startIndex[g.cutCard.rank + g.cutCard.suit]]++;
  }

  // Six dealt to each hand. Only what the DEAL hands out is asserted here.
  [['player hand', 0, 6], ['computer hand', 1, 6]].forEach(([label, row, size]) => {
    const expected = DEALS * size / n;
    const x2 = chiSquare([counts[row]], expected);
    const b = band(n - 1);
    console.log((label + ':').padEnd(16) + 'chi-square ' + x2.toFixed(1) +
      ' (df ' + (n - 1) + ', fair range ' + b.lo.toFixed(0) + '–' + b.hi.toFixed(0) + ')');
    check(x2 > b.lo && x2 < b.hi,
      'the ' + label + ' does not draw evenly from the deck: chi-square ' + x2.toFixed(1));
  });

  /* The crib is deliberately NOT asserted to be uniform, and an earlier version
   * of this test failing on it was the test being wrong rather than the game.
   * The crib is what both players CHOSE to throw away: the computer discards
   * strategically and the fixture here always throws its first two cards, so a
   * five reaches the crib far less often than a king. Non-uniformity there is
   * the strategy working. Reported for interest, never failed on. */
  {
    const expected = DEALS * 4 / n;
    const x2 = chiSquare([counts[2]], expected);
    console.log('crib:           chi-square ' + x2.toFixed(1) +
      ' (df ' + (n - 1) + ') — expected to be uneven: these are discards, not deals');
  }

  const cutExpected = DEALS / n;
  const cutX2 = chiSquare([cutCounts], cutExpected);
  const cutBand = band(n - 1);
  console.log('cut card:       chi-square ' + cutX2.toFixed(1) +
    ' (df ' + (n - 1) + ', fair range ' + cutBand.lo.toFixed(0) + '–' + cutBand.hi.toFixed(0) + ')');
  check(cutX2 > cutBand.lo && cutX2 < cutBand.hi,
    'the cut card is not drawn evenly: chi-square ' + cutX2.toFixed(1));

  // A jack cut pays the dealer 2 for his heels, so its rate is worth stating
  // plainly: four jacks in 52 cards is 1 in 13.
  const jacks = ['J♥', 'J♦', 'J♣', 'J♠'].reduce((t, id) => t + cutCounts[startIndex[id]], 0);
  const rate = jacks / DEALS;
  console.log('jack cut rate:  ' + (rate * 100).toFixed(2) + '% (fair value ' + (100 / 13).toFixed(2) + '%)');
  check(Math.abs(rate - 1 / 13) < 0.012,
    'his heels comes up ' + (rate * 100).toFixed(2) + '% of the time, not the expected ' +
    (100 / 13).toFixed(2) + '%');
}

/* ---- 4: cutting for the deal is fair, and ties are as rare as they should be ----
 *
 * A tie leaves the state on CUT_FOR_DEAL so the players cut again, which is
 * correct and is why this loops rather than expecting one call to settle it.
 * The tie RATE is worth asserting on its own: it must be 3/51, the chance the
 * second card matches the first's rank. It was more than twice that while the
 * cut compared counting value, which made a ten, jack, queen and king all equal. */
{
  const ROUNDS = 20000;
  let player = 0, computer = 0, ties = 0, cuts = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const g = new CribbageGame();
    let guard = 0;
    while (!g.dealer && ++guard < 50) {
      g.state = 'CUT_FOR_DEAL';
      const before = g.dealer;
      g.cutForDeal();
      cuts++;
      if (!g.dealer && before === g.dealer) ties++;
    }
    if (g.dealer === g.player) player++;
    else if (g.dealer === g.computer) computer++;
  }
  const decided = player + computer;
  console.log('cut for deal:   player ' + player + ', computer ' + computer);
  check(decided === ROUNDS, 'cutting for the deal left ' + (ROUNDS - decided) + ' games without a dealer');

  const tieRate = ties / cuts;
  console.log('tie rate:       ' + (tieRate * 100).toFixed(2) + '% (fair value ' +
    (300 / 51).toFixed(2) + '% — the chance of matching the first card\'s rank)');
  check(Math.abs(tieRate - 3 / 51) < 0.015,
    'cutting for the deal ties ' + (tieRate * 100).toFixed(2) + '% of the time, not the ' +
    (300 / 51).toFixed(2) + '% two random ranks should match — is the cut comparing counting ' +
    'value rather than rank, so that a ten, jack, queen and king are all equal?');

  const x2 = chiSquare([[player, computer]], decided / 2);
  check(x2 < band(1).hi,
    'cutting for the deal favours one seat: ' + player + ' to ' + computer);
}

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + uniq.length + '):');
  uniq.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nThe deal is uniform.');
