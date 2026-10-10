/* The scoring, checked against worked examples rather than against play.
 *
 * tests/rules-oracle.js re-derives the score of every hand it plays, which
 * proves the engine agrees with a second implementation. It does not prove
 * either of them is RIGHT — two implementations written by the same person on
 * the same afternoon share the same misunderstandings, and the scoring is where
 * spades has the most of them available.
 *
 * So this file is a table of hands with the answer written out by hand, in the
 * words of the rules, with the arithmetic shown. If the engine and the oracle
 * are both wrong about what a broken nil does to the partner's contract, this is
 * the file that says so.
 *
 * The rules being asserted, stated once:
 *
 *   1. A partnership's contract is the SUM of the two bids. Nil counts as zero
 *      towards it.
 *   2. Making it is worth ten a trick. Missing it by any amount loses ten a
 *      trick for the WHOLE bid.
 *   3. Each trick over the contract is worth one point and one bag. Ten bags
 *      costs a hundred, and the count continues from the remainder.
 *   4. Nil is settled separately, a hundred either way. A FAILED nil's tricks
 *      still count towards the partnership's total — which falls out of the sum
 *      in rule 1 rather than needing a special case, because a successful nil
 *      took none and contributes nothing either way.
 *
 *   node tests/scoring.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Math, JSON, Date };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const G = sandbox.SH.Game;

const fails = [];
let checks = 0;
function check(cond, msg) { checks++; if (!cond) fails.push(msg); }

const STD = { bagLimit: 10, bagPenalty: 100, nilValue: 100 };

/* Each case: what was bid, what was taken, the bags carried in, and what each
 * partnership should score — with the arithmetic spelled out in `why` so that a
 * failure names the rule rather than the number.
 *
 * Seats are 0..3; teams are 0 (seats 0 and 2) and 1 (seats 1 and 3). */
const CASES = [
  {
    name: 'the ordinary made contract',
    bids: [3, 4, 2, 4], tricks: [3, 4, 2, 4], bagsIn: [0, 0],
    delta: [50, 80], bags: [0, 0],
    why: 'team 0 bid 5 took 5 = +50; team 1 bid 8 took 8 = +80'
  },
  {
    name: 'overtricks are worth one point and one bag each',
    bids: [3, 3, 2, 3], tricks: [4, 3, 3, 3], bagsIn: [0, 0],
    delta: [52, 60], bags: [2, 0],
    why: 'team 0 bid 5 took 7 = 50 + 2 overtricks; two bags banked'
  },
  {
    name: 'missing by one loses the whole bid, not the difference',
    bids: [4, 3, 3, 3], tricks: [3, 4, 3, 3], bagsIn: [0, 0],
    delta: [-70, 61], bags: [0, 1],
    why: 'team 0 bid 7 took 6 — minus ten a trick for all seven, not for the one; ' +
      'team 1 bid 6 took 7 = 60 + 1 overtrick, and banks the bag that came with it'
  },
  {
    name: 'a set hand banks no bags, because there was no contract to be over',
    bids: [6, 2, 5, 0], tricks: [2, 5, 3, 3], bagsIn: [4, 0],
    delta: [-110, -74], bags: [4, 6],
    why: 'team 0 bid 11 took 5 = -110 and its bags are untouched — that is the ' +
      'rule this case is named for; team 1 bid 2 took 8 = 20 + 6 overtricks = 26, ' +
      'then the nil at seat 3 went down on 3 = -100, so -74, and it banks all six bags'
  },
  {
    name: 'the tenth bag costs a hundred and the count carries the remainder',
    bids: [3, 4, 3, 3], tricks: [5, 4, 4, 0], bagsIn: [7, 0],
    delta: [-37, -70], bags: [0, 0],
    why: 'team 0 bid 6 took 9 = 60 + 3 overtricks = 63, but 7 + 3 fills the bin: ' +
      '63 - 100 = -37, and 10 - 10 leaves 0. Team 1 bid 7 and took 4, so it is set'
  },
  {
    name: 'a hand can fill the bin and leave bags over',
    bids: [2, 5, 2, 4], tricks: [5, 5, 3, 0], bagsIn: [8, 0],
    delta: [-56, -90], bags: [2, 0],
    why: 'team 0 bid 4 took 8 = 40 + 4 = 44; 8 + 4 = 12 bags fills one bin, ' +
      '44 - 100 = -56, and 12 - 10 leaves 2'
  },
  {
    name: 'a nil that comes in is a hundred, on top of the partner\'s contract',
    bids: [0, 4, 4, 4], tricks: [0, 4, 5, 4], bagsIn: [0, 0],
    delta: [141, 80], bags: [1, 0],
    why: 'team 0 contract is 0 + 4 = 4, took 5 = 40 + 1 over = 41, plus 100 for the nil'
  },
  {
    name: 'a nil that goes down is minus a hundred, and its tricks still count',
    bids: [0, 4, 4, 4], tricks: [2, 4, 3, 4], bagsIn: [0, 0],
    delta: [-59, 80], bags: [1, 0],
    why: 'team 0 contract 4, took 2 + 3 = 5 — the broken nil\'s two tricks count, ' +
      'so the contract is MADE: 40 + 1 over = 41, then -100 for the nil = -59'
  },
  {
    name: 'a broken nil can carry the contract home on its own tricks',
    bids: [0, 5, 3, 5], tricks: [3, 5, 0, 5], bagsIn: [0, 0],
    delta: [-70, 100], bags: [0, 0],
    why: 'team 0 contract 3, took 3 + 0 = 3 — made exactly, +30, then -100 = -70'
  },
  {
    name: 'both partners nil, both in',
    bids: [0, 7, 0, 6], tricks: [0, 7, 0, 6], bagsIn: [0, 0],
    delta: [200, 130], bags: [0, 0],
    why: 'a contract of zero is made by definition — 10 x 0 = 0 — and the two ' +
      'nils are worth a hundred each'
  },
  {
    name: 'both partners nil, one down',
    bids: [0, 6, 0, 5], tricks: [0, 6, 2, 5], bagsIn: [0, 0],
    delta: [2, 110], bags: [2, 0],
    why: 'contract 0, took 2, so it is made with two overtricks = +2; ' +
      'one nil in (+100) and one down (-100) cancel'
  },
  {
    name: 'thirteen tricks, one partnership, everything',
    bids: [6, 0, 7, 0], tricks: [6, 0, 7, 0], bagsIn: [0, 0],
    delta: [130, 200], bags: [0, 0],
    why: 'team 0 bid 13 took 13 = +130; team 1 both nil and both in = +200'
  },
  {
    name: 'a zero-bag-penalty table counts bags and does not punish them',
    bids: [2, 3, 2, 3], tricks: [5, 3, 2, 3], bagsIn: [9, 0],
    rules: { bagLimit: 10, bagPenalty: 0, nilValue: 100 },
    delta: [43, 60], bags: [2, 0],
    why: 'bid 4 took 7 = 40 + 3 = 43; 9 + 3 = 12 crosses the limit but costs ' +
      'nothing, and the remainder is still 2'
  },
  {
    name: 'a five-bag table fills its bin twice as often',
    bids: [2, 3, 2, 3], tricks: [4, 3, 3, 3], bagsIn: [3, 0],
    rules: { bagLimit: 5, bagPenalty: 50, nilValue: 100 },
    delta: [-7, 60], bags: [1, 0],
    why: 'bid 4 took 7 = 40 + 3 = 43; 3 + 3 = 6 fills a bin of five, so ' +
      '43 - 50 = -7, and 6 - 5 leaves one bag behind rather than none'
  }
];

CASES.forEach(function (c) {
  const rules = c.rules || STD;
  const r = G.scoreHand(c.bids, c.tricks, c.bagsIn, rules);

  /* The tricks must add to thirteen, or the case itself is wrong and the engine
   * is being asked an impossible question. A test fixture that cannot happen is
   * worse than no fixture. */
  const total = c.tricks.reduce((a, b) => a + b, 0);
  check(total === G.HAND,
    c.name + ': the case deals ' + total + ' tricks, not ' + G.HAND);

  check(JSON.stringify(r.delta) === JSON.stringify(c.delta),
    c.name + ': scored ' + JSON.stringify(r.delta) + ', expected ' +
    JSON.stringify(c.delta) + ' — ' + c.why);
  check(JSON.stringify(r.bags) === JSON.stringify(c.bags),
    c.name + ': bags came to ' + JSON.stringify(r.bags) + ', expected ' +
    JSON.stringify(c.bags) + ' — ' + c.why);
});

/* scoreHand must not touch what it was handed. It is called with the live bag
 * counts, and a version that mutated them would double-count on any caller that
 * scored twice — which the interface does, because it explains a score by asking
 * again rather than by keeping the answer. */
(function () {
  const bagsIn = [7, 3];
  const before = JSON.stringify(bagsIn);
  const bids = [3, 3, 3, 3];
  const bidsBefore = JSON.stringify(bids);
  G.scoreHand(bids, [4, 3, 3, 3], bagsIn, STD);
  check(JSON.stringify(bagsIn) === before, 'scoreHand modified the bag counts it was given');
  check(JSON.stringify(bids) === bidsBefore, 'scoreHand modified the bids it was given');
  const twice = G.scoreHand(bids, [4, 3, 3, 3], bagsIn, STD);
  const thrice = G.scoreHand(bids, [4, 3, 3, 3], bagsIn, STD);
  check(JSON.stringify(twice) === JSON.stringify(thrice),
    'scoreHand gave two different answers to the same question');
})();

/* Every possible split of thirteen tricks against every plausible contract, to
 * catch a boundary the worked examples above happen to miss. Nothing here knows
 * the right answer — it asserts the PROPERTIES that must hold whatever the
 * numbers are, which is the kind of check that survives a rules change. */
(function () {
  let cases = 0;
  for (let b0 = 0; b0 <= 7; b0++) {
    for (let b1 = 0; b1 <= 7; b1++) {
      for (let t0 = 0; t0 <= 13; t0++) {
        const bids = [b0, b1, 0, 0];
        const tricks = [t0, 13 - t0, 0, 0];
        const r = G.scoreHand(bids, tricks, [0, 0], STD);
        cases++;

        for (let team = 0; team < 2; team++) {
          const contract = bids[team] + bids[team + 2];
          const took = tricks[team] + tricks[team + 2];
          const nils = [team, team + 2].filter(s => bids[s] === 0).length;
          const nilsMade = [team, team + 2].filter(s => bids[s] === 0 && tricks[s] === 0).length;

          /* Peel the two separately-settled parts off the total — the nils and
           * the bag penalty — and what is left must be exactly the contract.
           *
           * The bag penalty has to be peeled and not assumed away: thirteen
           * overtricks in one hand fills the bin, and an earlier version of this
           * sweep that ignored that reported the engine as wrong for every
           * combination where it fired. The sweep was wrong, which is a useful
           * thing to have found out from a sweep. */
          const nilPart = nilsMade * STD.nilValue - (nils - nilsMade) * STD.nilValue;
          const over = took >= contract ? took - contract : 0;
          const penalty = Math.floor(over / STD.bagLimit) * STD.bagPenalty;
          const rest = r.delta[team] - nilPart + penalty;

          if (took >= contract) {
            check(rest === 10 * contract + over,
              'made contract mis-scored: bid ' + contract + ' took ' + took +
              ' gave ' + rest);
            check(r.bags[team] === over % STD.bagLimit,
              'bags should be the overtricks less any emptied bin: bid ' + contract +
              ' took ' + took + ' left ' + r.bags[team]);
          } else {
            check(rest === -10 * contract,
              'set contract mis-scored: bid ' + contract + ' took ' + took +
              ' gave ' + rest);
            check(r.bags[team] === 0, 'a set hand banked bags');
          }
        }
      }
    }
  }
  console.log(cases.toLocaleString() + ' bid/trick combinations swept');
})();

console.log(checks.toLocaleString() + ' assertions across ' + CASES.length + ' worked examples');

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.slice(0, 20).forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('The scoring matches the rules as written out by hand.');
