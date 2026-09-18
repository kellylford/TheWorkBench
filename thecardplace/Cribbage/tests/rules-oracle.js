/* Cribbage rules oracle.
 *
 * The same approach used on the Sheephead game in this repo, for the same
 * reason: a game can be entirely self-consistent and still play the wrong game.
 * Nothing here asks the engine what the rules are. The rules below are written
 * out from `rules.html` — the page the player is shown and is entitled to rely
 * on — and the engine is measured against them.
 *
 * The one discipline that makes this worth anything: this file may not call
 * scoreHand, scorePlay, findBestRun or isRun to decide what it EXPECTS. Those
 * are the things on trial. The moment it borrows them it stops being evidence.
 *
 *   node tests/rules-oracle.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

/* game.js is a browser script: the engine classes first, then a GameUI that
 * touches the DOM on construction. Take the engine and leave the rest, rather
 * than standing up a whole document to test arithmetic. */
const src = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const cut = src.indexOf('class GameUI');
if (cut < 0) {
  console.error('Could not find `class GameUI` — game.js has been restructured, fix this slice.');
  process.exit(2);
}
const sandbox = { console, Math, Date, JSON, setTimeout, module: {}, exports: {} };
vm.createContext(sandbox);
vm.runInContext(src.slice(0, cut) +
  '\nthis.__engine = { Card, Deck, Player, CribbageGame };', sandbox, { filename: 'game.js' });
const { Card, CribbageGame } = sandbox.__engine;

const fails = [];
let assertions = 0;
const claim = (cond, msg) => { assertions++; if (!cond) fails.push(msg); };

/* ===================================================================
 * THE RULES, WRITTEN OUT INDEPENDENTLY
 *
 * From rules.html:
 *   "Each card is worth its face value, with face cards (J, Q, K) worth 10 and
 *    Aces worth 1."
 *   "Fifteen: 2 points ... Pair: 2 points ... Run: 1 point per card ...
 *    Flush: 4 points (all four cards in hand same suit), 5 with the cut card.
 *    His Nobs: 1 point for Jack matching the cut card's suit."
 *   "Runs: 3+ consecutive cards ... each distinct combination counts."
 * =================================================================== */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♥', '♦', '♣', '♠'];

const oValue = r => Math.min(RANKS.indexOf(r) + 1, 10);
const oOrder = r => RANKS.indexOf(r);            // A=0 .. K=12, no wrap-around

const card = str => {
  // "5♥", "10♠", "J♣"
  const suit = str.slice(-1);
  return new Card(str.slice(0, -1), suit);
};
const hand = s => s.split(' ').map(card);

/* Every subset summing to 15 scores 2. */
function oFifteens(cards) {
  let n = 0;
  for (let mask = 1; mask < (1 << cards.length); mask++) {
    let sum = 0, size = 0;
    for (let j = 0; j < cards.length; j++) {
      if (mask & (1 << j)) { sum += oValue(cards[j].rank); size++; }
    }
    if (size >= 2 && sum === 15) n += 2;
  }
  return n;
}

/* Every pair of equal rank scores 2 — which makes three of a kind 6 and four
 * of a kind 12 without needing to special-case them. */
function oPairs(cards) {
  let n = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].rank === cards[j].rank) n += 2;
    }
  }
  return n;
}

/* Runs. The part everyone gets wrong: a run scores once for EVERY distinct
 * combination of cards that forms it, so 4-5-6-6 is two runs of three, not one.
 * Only maximal runs count — the 3-card runs inside a 4-card run do not score. */
function oRuns(cards) {
  const byLen = {};
  for (let mask = 1; mask < (1 << cards.length); mask++) {
    const subset = [];
    for (let j = 0; j < cards.length; j++) if (mask & (1 << j)) subset.push(cards[j]);
    if (subset.length < 3) continue;
    const v = subset.map(c => oOrder(c.rank)).sort((a, b) => a - b);
    let run = true;
    for (let k = 1; k < v.length; k++) if (v[k] !== v[k - 1] + 1) { run = false; break; }
    if (run) (byLen[subset.length] = byLen[subset.length] || []).push(mask);
  }
  const lengths = Object.keys(byLen).map(Number).sort((a, b) => b - a);
  if (!lengths.length) return 0;
  const longest = lengths[0];
  return byLen[longest].length * longest;
}

/* "Flush: 4 points (all four cards in hand same suit), 5 with the cut card."
 * In the crib, only a five card flush counts. */
function oFlush(handCards, cutCard, isCrib) {
  const same = handCards.every(c => c.suit === handCards[0].suit);
  if (!same) return 0;
  const withCut = cutCard && cutCard.suit === handCards[0].suit;
  if (isCrib) return withCut ? 5 : 0;
  return withCut ? 5 : 4;
}

function oNobs(handCards, cutCard) {
  if (!cutCard) return 0;
  return handCards.some(c => c.rank === 'J' && c.suit === cutCard.suit) ? 1 : 0;
}

function oScoreHand(handCards, cutCard, isCrib) {
  const all = cutCard ? handCards.concat([cutCard]) : handCards.slice();
  return oFifteens(all) + oPairs(all) + oRuns(all) +
    oFlush(handCards, cutCard, isCrib) + oNobs(handCards, cutCard);
}

const game = () => new CribbageGame();

/* ===================================================================
 * 1. Card values
 * =================================================================== */
for (const r of RANKS) {
  for (const s of SUITS) {
    claim(new Card(r, s).value === oValue(r),
      r + s + ' is worth ' + new Card(r, s).value + ', the rules say ' + oValue(r));
  }
}
// The trap: a king and a queen are both worth ten but are NOT the same rank,
// so they never pair and never form a run together.
claim(new Card('K', '♥').value === 10 && new Card('Q', '♥').value === 10,
  'face cards are not worth ten');

/* ===================================================================
 * 2. Hands whose score is common knowledge
 * =================================================================== */
{
  const KNOWN = [
    { h: 'J♣ 5♠ 5♥ 5♦', cut: '5♣', crib: false, want: 29, why: 'the perfect hand' },
    { h: '5♠ 5♥ 5♦ 5♣', cut: 'J♠', crib: false, want: 28, why: 'four fives, jack cut, no nobs for the hand' },
    { h: '4♠ 5♥ 6♦ 6♣', cut: '2♠', crib: false, want: 12, why: 'double run of three, two fifteens, a pair' },
    { h: '4♠ 5♥ 6♦ 7♣', cut: '8♠', crib: false, want: 9, why: 'a run of five and two fifteens' },
    { h: '3♠ 4♥ 5♦ 6♣', cut: 'K♠', crib: false, want: 8, why: 'run of four, two fifteens' },
    { h: 'A♠ 2♥ 3♦ 4♣', cut: 'K♠', crib: false, want: 8, why: 'run of four, plus 2+3+K and A+4+K' },
    { h: '2♠ 3♥ 4♦ 5♣', cut: '6♠', crib: false, want: 9, why: 'run of five, plus 2+3+4+6 and 4+5+6' },
    { h: '7♠ 8♥ 9♦ 9♣', cut: '6♠', crib: false, want: 16, why: 'double run of four and a pair' },
    { h: '5♠ 5♥ 5♦ 6♣', cut: '4♠', crib: false, want: 23, why: 'triple run of three, four fifteens, three pairs' },
    { h: '2♥ 4♥ 6♥ 8♥', cut: '10♥', crib: false, want: 5, why: 'five card flush, and every card is even so no fifteen is possible' },
    { h: '2♥ 4♥ 6♥ 8♥', cut: '10♠', crib: false, want: 4, why: 'four card flush only' },
    { h: '2♥ 4♥ 6♥ 8♥', cut: '10♠', crib: true, want: 0, why: 'a four card flush does not count in the crib' },
    { h: '2♥ 4♥ 6♥ 8♥', cut: '10♥', crib: true, want: 5, why: 'a five card flush does count in the crib' },
    { h: 'A♠ 2♥ 6♦ J♣', cut: '10♣', crib: false, want: 1, why: 'nothing but his nobs' },
    { h: 'A♠ 2♥ 6♦ 10♣', cut: 'K♥', crib: false, want: 0, why: 'a hand worth precisely nothing' },
    { h: 'K♠ Q♥ J♦ 10♣', cut: '9♠', crib: false, want: 5, why: 'a run of five; four ten-value cards cannot make fifteen' },
    { h: 'K♠ K♥ Q♦ Q♣', cut: 'J♠', crib: false, want: 16, why: 'double-double run of three, two pairs' }
  ];
  for (const t of KNOWN) {
    const h = hand(t.h), c = card(t.cut);
    // The oracle must agree with the published value first, or the oracle is wrong.
    const mine = oScoreHand(h, c, t.crib);
    claim(mine === t.want,
      'ORACLE IS WRONG: ' + t.h + ' with ' + t.cut + ' should be ' + t.want +
      ' (' + t.why + ') but this test computes ' + mine);
    const got = game().scoreHand(h, c, t.crib);
    claim(got === t.want,
      t.h + ' + ' + t.cut + (t.crib ? ' (crib)' : '') + ' scored ' + got +
      ', should be ' + t.want + ' — ' + t.why);
  }
}

/* ===================================================================
 * 3. Every hand the engine can be given, checked against the rules
 *
 * Random four card hands plus a cut, scored independently. This is the sweep
 * that finds a scoring rule that is wrong in general rather than in one case.
 * =================================================================== */
{
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(new Card(r, s));

  let seed = 20260811;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  let checked = 0;
  const bad = [];
  const worstBy = {};
  for (let i = 0; i < 30000; i++) {
    const pool = deck.slice();
    const five = [];
    for (let k = 0; k < 5; k++) five.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const h = five.slice(0, 4), cut = five[4];
    const isCrib = rnd() < 0.25;
    const want = oScoreHand(h, cut, isCrib);
    const got = game().scoreHand(h, cut, isCrib);
    checked++;
    if (got !== want) {
      const key = (got < want ? 'under' : 'over') + ' by ' + Math.abs(got - want);
      worstBy[key] = (worstBy[key] || 0) + 1;
      if (bad.length < 6) {
        bad.push(h.map(c => c.rank + c.suit).join(' ') + ' + ' + cut.rank + cut.suit +
          (isCrib ? ' (crib)' : '') + ': engine ' + got + ', rules ' + want);
      }
    }
  }
  assertions += checked;
  const total = Object.values(worstBy).reduce((a, b) => a + b, 0);
  if (total) {
    fails.push('scoreHand disagrees with the rules on ' + total + ' of ' + checked +
      ' hands (' + Math.round(1000 * total / checked) / 10 + '%)\n      ' +
      Object.entries(worstBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join(', ') +
      '\n      ' + bad.join('\n      '));
  }
}

/* ===================================================================
 * 4. Pegging
 *
 * Drive real plays through the engine and check what it awards for each one.
 * =================================================================== */
{
  /* Feed the pile directly and ask what each card is worth. Driving whole turns
   * through playCard instead would fold in "go" points — one seat holding every
   * card is out of cards after each play — and an early version of this test did
   * exactly that, then reported a fifteen as being worth three. Score the play,
   * and nothing but the play. */
  function peg(sequence) {
    const g = game();
    g.playedPile = [];
    g.currentCount = 0;
    const awarded = [];
    for (const str of sequence) {
      const c = card(str);
      g.playedPile.push({ card: c, player: g.player });
      g.currentCount += oValue(c.rank);
      awarded.push(g.scorePlay(c, g.player));
    }
    return awarded;
  }

  /* The same thing, read straight off the rules. Never calls the engine. */
  function oPeg(sequence) {
    const pile = [];
    let count = 0;
    const out = [];
    for (const str of sequence) {
      const c = card(str);
      pile.push(c);
      count += oValue(c.rank);
      let pts = 0;
      if (count === 15) pts += 2;
      if (count === 31) pts += 2;
      let same = 1;
      for (let k = pile.length - 2; k >= 0 && pile[k].rank === c.rank; k--) same++;
      if (same === 2) pts += 2; else if (same === 3) pts += 6; else if (same === 4) pts += 12;
      for (let len = pile.length; len >= 3; len--) {
        const v = pile.slice(-len).map(x => oOrder(x.rank)).sort((a, b) => a - b);
        let run = true;
        for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1] + 1) { run = false; break; }
        if (run) { pts += len; break; }
      }
      out.push(pts);
    }
    return out;
  }

  const PEG = [
    { seq: ['5♠', '10♥'], want: [0, 2], why: 'fifteen two' },
    { seq: ['5♠', '5♥'], want: [0, 2], why: 'a pair' },
    { seq: ['5♠', '5♥', '5♦'], want: [0, 2, 8],
      why: 'three of a kind for six, and the third five also brings the count to fifteen' },
    { seq: ['5♠', '5♥', '5♦', '5♣'], want: [0, 2, 8, 12], why: 'then four of a kind for twelve' },
    { seq: ['3♠', '4♥', '5♦'], want: [0, 0, 3], why: 'a run of three' },
    { seq: ['3♠', '4♥', '5♦', '6♣'], want: [0, 0, 3, 4], why: 'the run extends to four' },
    { seq: ['3♠', '4♥', '5♦', '6♣', '7♥'], want: [0, 0, 3, 4, 5],
      why: 'a run of five during the play is worth five' },
    { seq: ['A♠', '2♥', '3♦', '4♣', '5♥', '6♦'], want: [0, 0, 3, 4, 7, 6],
      why: 'the fifth card is a run of five AND fifteen; the sixth is a run of six' },
    { seq: ['4♠', '3♥', '5♦'], want: [0, 0, 3], why: 'a run need not arrive in order' },
    { seq: ['K♠', 'Q♥', 'J♦'], want: [0, 0, 3], why: 'court cards make a run by rank, not by value' },
    { seq: ['K♠', 'Q♥'], want: [0, 0], why: 'a king and a queen are both ten but are not a pair' },
    { seq: ['6♠', '9♥'], want: [0, 2], why: 'fifteen from six and nine' },
    { seq: ['10♠', '5♥', '10♦', '6♣'], want: [0, 2, 0, 2], why: 'the last card brings it to exactly 31' },
    { seq: ['10♠', '10♥', '10♦', 'A♣'], want: [0, 2, 6, 2], why: 'three tens then an ace for 31' }
  ];
  for (const t of PEG) {
    const mine = oPeg(t.seq);
    claim(mine.join(',') === t.want.join(','),
      'ORACLE IS WRONG: ' + t.seq.join(' ') + ' should be [' + t.want + '] (' + t.why +
      ') but this test computes [' + mine + ']');
    const got = peg(t.seq);
    claim(got.join(',') === t.want.join(','),
      'playing ' + t.seq.join(' ') + ' scored [' + got + '], should be [' + t.want +
      '] — ' + t.why);
  }

  // A wide random sweep of legal pegging sequences.
  {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
    let seed = 4242;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let checked = 0;
    const bad = [];
    for (let i = 0; i < 20000; i++) {
      const pool = deck.slice();
      const seq = [];
      let count = 0;
      while (seq.length < 8) {
        const idx = Math.floor(rnd() * pool.length);
        const c = pool[idx];
        if (count + oValue(c.slice(0, -1)) > 31) break;
        pool.splice(idx, 1);
        seq.push(c);
        count += oValue(c.slice(0, -1));
      }
      if (seq.length < 3) continue;
      checked++;
      const want = oPeg(seq).join(','), got = peg(seq).join(',');
      if (want !== got && bad.length < 6) {
        bad.push(seq.join(' ') + ': engine [' + got + '], rules [' + want + ']');
      }
      if (want !== got) assertions++;
    }
    assertions += checked;
    if (bad.length) {
      fails.push('scorePlay disagrees with the rules:\n      ' + bad.join('\n      '));
    }
  }
}

/* ===================================================================
 * 5. The last card of the play phase
 *
 * "The last player to play a card scores 1 point (or 2 if the count is 31)."
 * =================================================================== */
{
  // Eight cards played alternately, ending short of 31 so the point at stake is
  // for the last card rather than for reaching 31. No magic numbers: whatever
  // the pegging comes to is computed independently, and the last-card point is
  // whatever the engine awarded beyond it.
  const pIds = ['A♠', '2♠', '3♠', '4♠'];
  const cIds = ['A♥', '2♥', '3♥', '4♥'];
  const order = [pIds[0], cIds[0], pIds[1], cIds[1], pIds[2], cIds[2], pIds[3], cIds[3]];

  const g = game();
  g.state = 'PLAY';
  g.currentCount = 0;
  g.playedPile = [];
  const p = pIds.map(card), c = cIds.map(card);
  g.player.hand = p.slice(); g.player.playedCards = [];
  g.computer.hand = c.slice(); g.computer.playedCards = [];
  g.dealer = g.computer;

  const before = g.player.score + g.computer.score;
  for (let i = 0; i < 4; i++) {
    g.state = 'PLAY'; g.currentTurn = g.player; g.playCard(g.player, p[i]);
    g.state = 'PLAY'; g.currentTurn = g.computer; g.playCard(g.computer, c[i]);
  }
  const gained = (g.player.score + g.computer.score) - before;
  const pegging = (function () {
    // Independent: reuse nothing from the engine.
    const pile = [];
    let count = 0, total = 0;
    for (const str of order) {
      const cc = card(str);
      pile.push(cc);
      count += oValue(cc.rank);
      if (count === 15) total += 2;
      if (count === 31) total += 2;
      let same = 1;
      for (let k = pile.length - 2; k >= 0 && pile[k].rank === cc.rank; k--) same++;
      if (same === 2) total += 2; else if (same === 3) total += 6; else if (same === 4) total += 12;
      for (let len = pile.length; len >= 3; len--) {
        const v = pile.slice(-len).map(x => oOrder(x.rank)).sort((a, b) => a - b);
        let run = true;
        for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1] + 1) { run = false; break; }
        if (run) { total += len; break; }
      }
    }
    return total;
  })();

  claim(g.playedPile.length === 8, 'the play phase did not run to eight cards');
  claim(g.currentCount !== 31, 'this fixture accidentally reached 31, rewrite it');
  claim(gained === pegging + 1,
    'the last card of the play phase scored no point. The eight cards awarded ' + gained +
    ' and the pegging alone is worth ' + pegging + ', so the extra ' + (gained - pegging) +
    ' where the rules give the last player 1. playCard() checks checkPlayComplete() before ' +
    'switchTurn(), so on the final card it returns early and never reaches the code that ' +
    'awards it.');
}

/* ===================================================================
 * 6. Structure: the deal, the crib, the target
 * =================================================================== */
{
  const g = game();
  g.startNewGame();
  g.startRound();
  claim(g.player.hand.length === 6, 'the player was dealt ' + g.player.hand.length + ' cards, not 6');
  claim(g.computer.hand.length === 6, 'the computer was dealt ' + g.computer.hand.length + ' cards, not 6');
  claim(g.crib.length === 0, 'the crib is not empty before discarding');

  // A full deck, no duplicates.
  const d = new sandbox.__engine.Deck();
  claim(d.cards.length === 52, 'the deck is ' + d.cards.length + ' cards, not 52');
  const ids = d.cards.map(c => c.rank + c.suit);
  claim(new Set(ids).size === 52, 'the deck contains duplicate cards');

  claim(!!String(game().checkForWinner) , 'no winner check');
  const w = game();
  w.player.score = 120;
  claim(w.checkForWinner() === false, 'the game ended at 120 — the target is 121');
  w.player.score = 121;
  claim(w.checkForWinner() === true, 'the game did not end at 121');
}

/* =================================================================== */
if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('FAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
  uniq.slice(0, 20).forEach(f => console.log('  - ' + f));
  console.log('\n' + assertions.toLocaleString() + ' assertions run.');
  process.exit(1);
}
console.log(assertions.toLocaleString() +
  ' assertions: the engine plays the game the rules describe.');
