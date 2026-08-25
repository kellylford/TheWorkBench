/* Is this a game, or is it four bots agreeing with each other?
 *
 * The rules oracle proves the engine plays spades correctly. Correct and dull
 * are entirely compatible, and in this game they are only one bad constant
 * apart — the bidding is the whole tension, and the way to lose it is not a
 * crash but a drift.
 *
 * Two failure modes, both measured here, and both were actually produced while
 * tuning ai.js rather than imagined afterwards:
 *
 *   TOO TIMID. An early count came to eleven and a bit across a table where
 *   thirteen tricks exist. Every partnership made its contract, six per cent of
 *   hands were set, and the surplus tricks went into the bag bin — so the game
 *   was decided by sandbagging penalties rather than by bidding, and no hand
 *   ever had anything at stake.
 *
 *   TOO GREEDY. Correcting the count the other way took the table to thirteen
 *   and a bit. Thirteen bids against thirteen tricks means one side is set
 *   almost every hand by arithmetic rather than by play, a third of contracts
 *   went down, and games ran half again as long.
 *
 * The window between those is where spades lives, and the numbers below are the
 * measured middle of it. They are RANGES, wide enough not to fail on a seed
 * change and narrow enough to catch either drift. A change to ai.js that moves
 * one of them is not necessarily wrong — but it has to be looked at, which is
 * the entire job of this file.
 *
 *   node tests/balance.js
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
const AI = sandbox.SH.AI;

const fails = [];
const report = [];

/* Two seeds, and both are asserted. One seed is an anecdote: a range that holds
 * for 20260825 and not for 991 is a range tuned to a shuffle. */
const SEEDS = [20260825, 991];

function run(seedStart, games) {
  let seed = seedStart;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const s = {
    games: 0, hands: 0, tableBid: 0, set: 0, made: 0, bagPens: 0,
    nils: 0, nilsMade: 0, wins: [0, 0], maxBid: 0, minBid: 99,
    bidCounts: {}, blowouts: 0, longest: 0
  };

  for (let g = 0; g < games; g++) {
    const st = G.createGame({ names: ['N', 'E', 'S', 'W'] });
    G.applyAction(st, 0, { type: 'start' }, rng);
    let guard = 0;
    while (st.phase !== 'gameOver' && guard++ < 40000) {
      if (st.phase === 'handOver') { G.applyAction(st, 0, { type: 'nextHand' }, rng); continue; }
      if (G.seatToAct(st) < 0) break;
      AI.act(st);
    }
    if (st.phase !== 'gameOver') { fails.push('a game never finished (seed ' + seedStart + ')'); return s; }

    s.games++;
    s.hands += st.dealNumber;
    s.wins[st.winner]++;
    s.longest = Math.max(s.longest, st.dealNumber);
    /* A blowout: one side never troubled the other. Some is fine; mostly is a
     * sign the bots are not really competing. */
    if (Math.abs(st.scores[0] - st.scores[1]) > 400) s.blowouts++;

    let prevBags = [0, 0];
    st.history.forEach(h => {
      s.tableBid += h.bids.reduce((a, b) => a + b, 0);
      h.bids.forEach(b => {
        s.bidCounts[b] = (s.bidCounts[b] || 0) + 1;
        s.maxBid = Math.max(s.maxBid, b);
        s.minBid = Math.min(s.minBid, b);
        if (b === 0) s.nils++;
      });
      h.bids.forEach((b, i) => { if (b === 0 && h.tricks[i] === 0) s.nilsMade++; });
      for (let t = 0; t < 2; t++) {
        const bid = h.bids[t] + h.bids[t + 2];
        const took = h.tricks[t] + h.tricks[t + 2];
        if (took >= bid) s.made++; else s.set++;
        if (h.bags[t] < prevBags[t]) s.bagPens++;
      }
      prevBags = h.bags;
    });
  }
  return s;
}

function band(name, value, lo, hi, why) {
  const ok = value >= lo && value <= hi;
  report.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name.padEnd(28) +
    String(Math.round(value * 100) / 100).padStart(8) +
    '   want ' + lo + '–' + hi);
  if (!ok) fails.push(name + ' is ' + (Math.round(value * 100) / 100) +
    ', outside ' + lo + '–' + hi + '. ' + why);
}

SEEDS.forEach(seedStart => {
  const s = run(seedStart, 120);
  if (!s.games) return;
  report.push('seed ' + seedStart + ' — ' + s.games + ' games, ' + s.hands + ' hands');

  /* THE TABLE BID. The single number that decides whether this is a game.
   * Under eleven and nobody is ever set; over thirteen and everybody always is.
   * Real tables come out a little under the thirteen available. */
  band('table bid (of 13)', s.tableBid / s.hands, 11.0, 12.8,
    'Under 11 means the bots are leaving tricks on the table and winning on bag ' +
    'penalties; over 12.8 means they are bidding more than exists and being set ' +
    'by arithmetic. Look at handStrength in ai.js.');

  /* HOW OFTEN A CONTRACT GOES DOWN. Below ten per cent there is nothing at
   * stake in a hand; above thirty the bidding is not a skill, it is a tax. */
  band('contracts set (%)', 100 * s.set / (s.set + s.made), 10, 30,
    'This is the tension in the game. Both directions of drift have been ' +
    'produced by a one-line change to the count in ai.js.');

  /* HANDS PER GAME to 500. Too few and the game is over before it starts; too
   * many and it outstays its welcome. */
  band('hands per game', s.hands / s.games, 7, 16,
    'A game to 500 that takes four hands is scoring too fast; one that takes ' +
    'twenty-five is scoring too slowly, usually because everybody is being set.');

  /* BAG PENALTIES. They have to happen — the rule is a third of what makes
   * spades spades — but they must not be the main event. */
  band('bag penalties per game', s.bagPens / s.games, 0.15, 2.0,
    'Zero means the bag rule is decoration; more than two a game means the bots ' +
    'are underbidding and the game is decided by sandbagging.');

  /* NILS. Rare enough to be an event, common enough to be part of the game. */
  band('hands with a nil (%)', 100 * s.nils / s.hands, 2, 25,
    'Nil is worth a hundred either way. Never bidding it wastes a rule; bidding ' +
    'it constantly means nilWorthy in ai.js is not strict enough.');

  /* And when they do bid one, they should mostly bring it in — the bots are
   * documented as bidding nil only on a hand that can genuinely duck. A low
   * rate here means nilWorthy is letting hopeful nils through. */
  if (s.nils) {
    band('nils made (%)', 100 * s.nilsMade / s.nils, 70, 100,
      'nilWorthy is deliberately strict. A rate below 70 means it is letting ' +
      'through hands that cannot actually duck thirteen tricks.');
  }

  /* NEITHER SIDE HAS AN EDGE. The bots are symmetric, so a persistent lean to
   * one partnership means something is asymmetric that should not be —
   * a seat-order assumption, or the dealer advantage not rotating. */
  band('seats 1+3 win rate (%)', 100 * s.wins[1] / s.games, 33, 67,
    'The two sides run identical code. A lean means something depends on seat ' +
    'order that should not — check that the deal rotates.');

  /* THE BIDS ARE NOT ALL THE SAME NUMBER. A bot that bids three every hand
   * would satisfy the table-bid band above and be no fun at all. */
  const spread = Object.keys(s.bidCounts).length;
  band('distinct bids used', spread, 5, 14,
    'If the bots only ever bid two or three, the count in ai.js is not reading ' +
    'the hand — it is returning a constant with noise on it.');

  band('blowouts (%)', 100 * s.blowouts / s.games, 0, 45,
    'A game where one side is never in it. Some are expected; mostly is not.');
});

console.log(report.join('\n'));

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.forEach(f => console.error('  - ' + f));
  console.error('\nThese are ranges, not fixed numbers, and being outside one is not ' +
    'automatically a bug — it means the bidding has moved and somebody has to look ' +
    'at whether the game is still worth playing.');
  process.exit(1);
}
console.log('\nThe bidding is a decision, the contracts are at risk, and neither side has an edge.');
