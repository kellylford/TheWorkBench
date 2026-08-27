/* Is the deal actually random?
 *
 * Reading the shuffle is not enough. Both games in this repo use a textbook
 * Fisher-Yates and both look right on the page, but "looks right" is how the
 * classic broken shuffle — arr.sort(() => Math.random() - 0.5) — survives review
 * everywhere it appears. It is visibly a shuffle and it is badly biased.
 *
 * So this measures the distribution instead of inspecting the code. Three
 * independent properties, each of which a biased shuffle fails differently:
 *
 *   1. Every card lands in every position about equally often (chi-square over
 *      the whole card x position matrix).
 *   2. The expected number of cards left at their starting index is 1 — for a
 *      uniform random permutation that holds for ANY deck size, which makes it a
 *      sharp and very cheap check.
 *   3. Every seat receives every card about equally often, which catches a deal
 *      that is fair in the deck but not in how it is handed out.
 *
 *   node tests/randomness.js
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
const { Game: G, Cards: C } = sandbox.SH;

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

/* Chi-square for an r x c table of counts against a uniform expectation.
 * Returned with its degrees of freedom so the caller can judge it. */
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

/* A chi-square with many degrees of freedom is close to normal with mean df and
 * standard deviation sqrt(2*df), so "within six standard deviations" is a band
 * that a fair shuffle will effectively never leave and a biased one will not
 * come near. Stated as a band rather than a p-value because the failure needs to
 * be readable by whoever it wakes up. */
function band(df) {
  const sd = Math.sqrt(2 * df);
  return { lo: df - 6 * sd, hi: df + 6 * sd, sd };
}

const SHUFFLES = 20000;

/* ---- 1 & 2: the deck itself ---- */
{
  const deck = C.ids(G.deckFor(5));          // 32 cards
  const n = deck.length;
  const index = {};
  deck.forEach((id, i) => { index[id] = i; });

  // counts[startingIndex][finalIndex]
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  let fixedPoints = 0;

  for (let s = 0; s < SHUFFLES; s++) {
    const shuffled = C.ids(C.shuffle(G.deckFor(5)));
    for (let pos = 0; pos < n; pos++) {
      counts[index[shuffled[pos]]][pos]++;
      if (index[shuffled[pos]] === pos) fixedPoints++;
    }
  }

  const expected = SHUFFLES / n;
  const x2 = chiSquare(counts, expected);
  const df = (n - 1) * (n - 1);
  const b = band(df);
  console.log('deck uniformity: chi-square ' + x2.toFixed(1) +
    ' (df ' + df + ', fair range ' + b.lo.toFixed(0) + '–' + b.hi.toFixed(0) + ')');
  check(x2 > b.lo && x2 < b.hi,
    'the shuffle is not uniform: chi-square ' + x2.toFixed(1) + ' against df ' + df +
    ', which is ' + Math.abs((x2 - df) / b.sd).toFixed(1) + ' standard deviations out');

  // Expected fixed points is exactly 1 per shuffle for a uniform permutation.
  const perShuffle = fixedPoints / SHUFFLES;
  console.log('cards left in place: ' + perShuffle.toFixed(3) + ' per shuffle (fair value 1.000)');
  check(Math.abs(perShuffle - 1) < 0.1,
    'cards are left in their original position ' + perShuffle.toFixed(3) +
    ' times per shuffle; a uniform shuffle leaves exactly 1 on average');
}

/* ---- 3: what each seat actually receives ---- */
for (const players of [3, 4, 5, 6]) {
  const deck = C.ids(G.deckFor(players));
  const n = deck.length;
  const cardIndex = {};
  deck.forEach((id, i) => { cardIndex[id] = i; });

  const DEALS = 12000;
  // counts[seat][card]
  const counts = Array.from({ length: players }, () => new Array(n).fill(0));
  const blindCounts = new Array(n).fill(0);

  const st = G.createGame({
    numPlayers: players,
    names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, players),
    allPass: 'leaster', difficulty: 'hard'
  });
  for (let d = 0; d < DEALS; d++) {
    G.newHand(st);
    st.events.length = 0;
    st.players.forEach((p, seat) => {
      p.hand.forEach(c => { counts[seat][cardIndex[c.id]]++; });
    });
    st.blind.forEach(c => { blindCounts[cardIndex[c.id]]++; });
  }

  const handSize = G.DEAL[players].hand;
  const expected = DEALS * handSize / n;
  const x2 = chiSquare(counts, expected);
  const df = (players - 1) * (n - 1);
  const b = band(df);
  console.log(players + ' players: seat/card chi-square ' + x2.toFixed(1) +
    ' (df ' + df + ', fair range ' + b.lo.toFixed(0) + '–' + b.hi.toFixed(0) + ')');
  check(x2 > b.lo && x2 < b.hi,
    players + ' players: cards are not dealt evenly across seats — chi-square ' +
    x2.toFixed(1) + ' against df ' + df);

  // No card may be systematically more or less likely to reach the blind.
  const blindExpected = DEALS * G.DEAL[players].blind / n;
  const blindX2 = chiSquare([blindCounts], blindExpected);
  const blindBand = band(n - 1);
  check(blindX2 > blindBand.lo && blindX2 < blindBand.hi,
    players + ' players: some cards reach the blind more often than others — chi-square ' +
    blindX2.toFixed(1) + ' against df ' + (n - 1));
}

/* ---- 4: the deal rotates, and does not always start with the same seat ---- */
{
  const ROUNDS = 6000;
  for (const players of [3, 5]) {
    const first = new Array(players).fill(0);
    for (let r = 0; r < ROUNDS; r++) {
      const st = G.createGame({
        numPlayers: players,
        names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, players),
        allPass: 'leaster', difficulty: 'hard'
      });
      G.newHand(st);
      st.events.length = 0;
      first[st.dealer]++;
    }
    const expected = ROUNDS / players;
    const x2 = chiSquare([first], expected);
    const b = band(players - 1);
    console.log(players + ' players: first dealer spread ' + first.join('/') +
      ' (chi-square ' + x2.toFixed(1) + ')');
    check(x2 < b.hi,
      players + ' players: the first dealer is not evenly distributed: ' + first.join('/'));
  }
}

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + uniq.length + '):');
  uniq.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nThe deal is uniform.');
