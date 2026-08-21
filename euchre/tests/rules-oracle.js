/* The only test that knows what euchre IS.
 *
 * Everything else in this directory checks that the game is consistent with
 * itself. That is a weaker property than it sounds. Swap two entries in a rank
 * table and the same cards still exist, so five tricks are still taken, the
 * score is still awarded to one side, the audit still balances, and the AI's
 * move is still validated against the very function that produced it. Every
 * self-consistency check passes while the wrong player wins every trick.
 *
 * So the rules here are written out BY HAND from the How to play Euchre dialog
 * in index.html, as literal data, and the engine is measured against them:
 *
 *   - the trump order for each of the four suits, as seven literal card ids
 *   - the non-trump order for each suit, with the left bower removed
 *   - the follow-suit rule, re-implemented from the sentence in the rules
 *   - the trick winner, re-implemented from "highest trump, else highest of the
 *     suit led"
 *   - the scoring table, as five literal rows
 *
 * THIS FILE MAY NOT CALL C.isTrump, C.power, C.beats, C.effSuit, C.sortHand,
 * G.legalPlays, G.trickWinnerIndex OR THE ENGINE'S SCORING. Those are the things
 * on trial. It builds its own answers and compares.
 *
 *   node tests/rules-oracle.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 424242;
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

let fails = [];
let checks = 0;
function check(cond, msg) { checks++; if (!cond) fails.push(msg); }

/* ================= THE RULES, WRITTEN OUT ================= */

const SUITS = ['C', 'S', 'H', 'D'];
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9'];

/* "the jack of the other suit of the same colour" */
const SAME_COLOUR = { C: 'S', S: 'C', H: 'D', D: 'H' };

/* "with spades trump the order is: jack of spades, jack of clubs, ace, king,
 *  queen, ten, nine of spades — then everything else" */
const TRUMP_ORDER = {};
for (const t of SUITS) {
  TRUMP_ORDER[t] = ['J' + t, 'J' + SAME_COLOUR[t], 'A' + t, 'K' + t, 'Q' + t, 'T' + t, '9' + t];
}

/* "Clubs are down to six cards, because their jack has left." */
function plainOrder(suit, trump) {
  const all = ['A' + suit, 'K' + suit, 'Q' + suit, 'J' + suit, 'T' + suit, '9' + suit];
  if (suit === SAME_COLOUR[trump]) return all.filter(id => id !== 'J' + suit);
  return all;
}

/* The whole 24-card deck, built from the rules text rather than from cards.js. */
const DECK_IDS = [];
for (const s of SUITS) for (const r of RANKS) DECK_IDS.push(r + s);

/* What suit a card counts as. The left bower answers "trump". */
function oracleSuit(id, trump) {
  if (!trump) return id[1];
  if (TRUMP_ORDER[trump].indexOf(id) >= 0) return 'trump';
  return id[1];
}

/* Where a card sits in its own order. Lower is stronger. */
function oracleRank(id, trump) {
  const t = TRUMP_ORDER[trump].indexOf(id);
  if (t >= 0) return t;
  return plainOrder(id[1], trump).indexOf(id);
}

/* "Highest trump takes the trick; with no trump in it, the highest card of the
 *  suit led." Expressed as: does a beat b, where b is currently winning? */
function oracleBeats(a, b, trump) {
  const sa = oracleSuit(a, trump), sb = oracleSuit(b, trump);
  if (sa === 'trump' && sb !== 'trump') return true;
  if (sa !== 'trump' && sb === 'trump') return false;
  if (sa !== sb) return false;
  return oracleRank(a, trump) < oracleRank(b, trump);
}

/* "You must follow the suit that was led if you can — remembering that the left
 *  bower counts as trump. If you cannot follow, you may play anything." */
function oracleLegal(hand, ledId, trump) {
  if (!ledId) return hand.slice();
  const led = oracleSuit(ledId, trump);
  const can = hand.filter(id => oracleSuit(id, trump) === led);
  return can.length ? can : hand.slice();
}

function oracleTrickWinner(plays, trump) {
  let best = 0;
  for (let i = 1; i < plays.length; i++) {
    if (oracleBeats(plays[i].card, plays[best].card, trump)) best = i;
  }
  return best;
}

/* The scoring table, five literal rows. */
function oracleScore(made, alone) {
  if (made >= 3) {
    if (made === 5) return alone ? 4 : 2;
    return 1;
  }
  return -2;                 // negative means it goes to the other side
}

/* ================= 1. THE DECK ================= */

{
  const deck = C.newDeck();
  check(deck.length === 24, 'the deck has ' + deck.length + ' cards, not 24');
  const ids = deck.map(c => c.id).sort();
  check(JSON.stringify(ids) === JSON.stringify(DECK_IDS.slice().sort()),
    'the deck is not the 24 cards the rules describe');
  check(new Set(ids).size === 24, 'the deck contains a duplicate');
}

/* ================= 2. EVERY ORDERED PAIR, UNDER EVERY TRUMP =================
 *
 * 24 x 24 x 4 = 2,304 comparisons. This is the check that a rank table swap
 * cannot survive. */

for (const trump of SUITS) {
  for (const a of DECK_IDS) {
    for (const b of DECK_IDS) {
      if (a === b) continue;
      const want = oracleBeats(a, b, trump);
      const got = C.beats(C.get(a), C.get(b), trump);
      check(want === got,
        `beats(${a}, ${b}) with ${trump} trump: engine says ${got}, the rules say ${want}`);
    }
  }
}

/* And the suit each card follows, which is the left bower rule on its own. */
for (const trump of SUITS) {
  for (const id of DECK_IDS) {
    const want = oracleSuit(id, trump);
    const got = C.effSuit(C.get(id), trump);
    const wantEngine = want === 'trump' ? trump : want;
    check(wantEngine === got,
      `effSuit(${id}) with ${trump} trump: engine says ${got}, the rules say ${wantEngine}`);
    check(C.isTrump(C.get(id), trump) === (want === 'trump'),
      `isTrump(${id}) with ${trump} trump disagrees with the rules`);
  }
}

/* The left bower, specifically and by name, because it is the rule everybody
 * gets wrong and the one worth naming in a failure message. */
for (const trump of SUITS) {
  const left = 'J' + SAME_COLOUR[trump];
  const right = 'J' + trump;
  check(C.effSuit(C.get(left), trump) === trump,
    `${left} must count as ${trump} when ${trump} is trump`);
  check(C.beats(C.get(right), C.get(left), trump),
    `the right bower ${right} must beat the left bower ${left}`);
  check(C.beats(C.get(left), C.get('A' + trump), trump),
    `the left bower ${left} must beat the ace of trump`);
  check(!C.beats(C.get('A' + SAME_COLOUR[trump]), C.get(left), trump),
    `the ace of ${SAME_COLOUR[trump]} must not beat the left bower when ${trump} is trump`);
}

/* ================= 3. TRICKS, SCORED INDEPENDENTLY ================= */

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

for (let n = 0; n < 20000; n++) {
  const trump = SUITS[Math.floor(rnd() * 4)];
  const size = 3 + Math.floor(rnd() * 2);          // three cards when somebody is alone
  const picked = shuffled(DECK_IDS).slice(0, size);
  const plays = picked.map((id, i) => ({ player: i, card: id }));
  const want = oracleTrickWinner(plays, trump);
  const got = G.trickWinnerIndex(plays.map(p => ({ player: p.player, card: C.get(p.card) })), trump);
  check(want === got,
    `trick winner with ${trump} trump for ${picked.join(' ')}: engine ${got}, rules ${want}`);
}

/* ================= 4. FOLLOWING SUIT ================= */

for (let n = 0; n < 4000; n++) {
  const trump = SUITS[Math.floor(rnd() * 4)];
  const pool = shuffled(DECK_IDS);
  const led = pool[0];
  const hand = pool.slice(1, 6);

  const st = G.createGame({
    numPlayers: 4, names: ['a', 'b', 'c', 'd'],
    pointsToWin: 10, stickTheDealer: false, allowAlone: true, difficulty: 'hard'
  });
  st.phase = 'play';
  st.trump = trump;
  st.turn = 1;
  st.players[1].hand = hand.map(id => C.get(id));
  st.trick = [{ player: 0, card: C.get(led) }];

  const want = oracleLegal(hand, led, trump).slice().sort();
  const got = G.legalPlays(st, 1).map(c => c.id).sort();
  check(JSON.stringify(want) === JSON.stringify(got),
    `legal plays on a ${led} lead with ${trump} trump holding ${hand.join(' ')}: ` +
    `engine [${got}] rules [${want}]`);
}

/* ================= 5. WHOLE HANDS, RE-SCORED FROM THE RULES =================
 *
 * Every finished hand is re-derived: the tricks are re-won from the recorded
 * plays using the oracle's own comparison, the makers' count is re-added, and
 * the score is looked up in the literal table. Nothing here reads the engine's
 * verdict except to disagree with it. */

const reached = {
  one: 0, march: 0, aloneMarch: 0, aloneOne: 0, euchred: 0, thrown: 0,
  leftBowerPlayed: 0, leftBowerWon: 0
};

for (let g = 0; g < 1200; g++) {
  const st = G.createGame({
    numPlayers: 4,
    names: ['N', 'E', 'S', 'W'],
    pointsToWin: 10,
    stickTheDealer: g % 3 === 0,
    allowAlone: true,
    difficulty: ['easy', 'normal', 'hard'][g % 3]
  });
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  while (st.phase !== 'handOver' && guard++ < 400) AI.act(st);
  check(st.phase === 'handOver', 'a hand never finished');
  if (st.phase !== 'handOver') break;

  const h = st.history[st.history.length - 1];

  if (h.result.thrownIn) {
    reached.thrown++;
    check(h.tricks.length === 0, 'a thrown-in hand recorded tricks');
    check(h.result.deltas[0] === 0 && h.result.deltas[1] === 0, 'a thrown-in hand scored');
    continue;
  }

  /* Re-win every trick from the cards. */
  const counted = [0, 0, 0, 0];
  let leader = h.tricks.length ? h.tricks[0].plays[0].player : -1;
  for (const t of h.tricks) {
    const wi = oracleTrickWinner(t.plays, h.trump);
    const winner = t.plays[wi].player;
    check(winner === t.winner,
      `hand ${h.handNumber} trick ${t.number}: engine gave it to seat ${t.winner + 1}, ` +
      `the rules give it to seat ${winner + 1} (${t.plays.map(p => p.card).join(' ')}, ` +
      `${h.trump} trump)`);
    counted[winner]++;

    /* The lead must be the previous winner, and everybody must have followed. */
    check(t.plays[0].player === leader,
      `hand ${h.handNumber} trick ${t.number} was led by seat ${t.plays[0].player + 1}, ` +
      `expected seat ${leader + 1}`);
    leader = winner;

    for (const pl of t.plays) {
      if (oracleSuit(pl.card, h.trump) === oracleSuit(t.plays[0].card, h.trump)) continue;
      /* Not following. Legal only if that seat held nothing of the led suit at
       * that moment — reconstructed from the deal and what they had already
       * played. */
      const dealt = h.dealt[pl.player].slice();
      if (pl.player === h.dealer && h.upcard && !h.turnedDown) dealt.push(h.upcard);
      const alreadyPlayed = [];
      for (const earlier of h.tricks) {
        if (earlier.number >= t.number) break;
        for (const p2 of earlier.plays) if (p2.player === pl.player) alreadyPlayed.push(p2.card);
      }
      const held = dealt.filter(id =>
        id !== h.discard && alreadyPlayed.indexOf(id) < 0);
      const led = oracleSuit(t.plays[0].card, h.trump);
      const couldFollow = held.some(id => oracleSuit(id, h.trump) === led);
      check(!couldFollow,
        `hand ${h.handNumber} trick ${t.number}: seat ${pl.player + 1} played ${pl.card} ` +
        `off a ${led} lead while holding ${held.filter(id => oracleSuit(id, h.trump) === led).join(' ')}`);
    }

    if (t.plays.some(p => p.card === 'J' + SAME_COLOUR[h.trump])) {
      reached.leftBowerPlayed++;
      if (t.plays[wi].card === 'J' + SAME_COLOUR[h.trump]) reached.leftBowerWon++;
    }
  }

  const total = counted.reduce((a, b) => a + b, 0);
  check(total === 5, `hand ${h.handNumber} accounted for ${total} tricks, not 5`);

  const makerTeam = h.maker % 2;
  const made = counted[makerTeam] + counted[makerTeam + 2];
  const oracleValue = oracleScore(made, h.alone);
  const want = [0, 0];
  if (oracleValue > 0) want[makerTeam] = oracleValue;
  else want[1 - makerTeam] = -oracleValue;

  check(want[0] === h.result.deltas[0] && want[1] === h.result.deltas[1],
    `hand ${h.handNumber}: makers took ${made}${h.alone ? ' alone' : ''}, ` +
    `the table says ${want.join('/')} but the engine scored ${h.result.deltas.join('/')}`);

  if (oracleValue === -2) reached.euchred++;
  else if (made === 5) { if (h.alone) reached.aloneMarch++; else reached.march++; }
  else if (h.alone) reached.aloneOne++;
  else reached.one++;

  /* A seat playing alone must never appear in a trick, and its partner must be
   * the one sitting out. */
  if (h.alone) {
    check(h.sittingOut === (h.maker + 2) % 4,
      `hand ${h.handNumber}: ${h.maker} went alone but seat ${h.sittingOut} sat out`);
    for (const t of h.tricks) {
      check(t.plays.length === 3, `hand ${h.handNumber}: an alone hand had ${t.plays.length} cards in a trick`);
    }
  }
}

/* A scoring branch that never came up has not been tested, however green the run
 * looks. Alone-and-euchred is folded into `euchred` because it scores the same
 * two points and the table has no separate row for it. */
for (const [name, min] of [['one', 50], ['march', 20], ['euchred', 20],
  ['aloneMarch', 3], ['thrown', 5], ['leftBowerWon', 20]]) {
  check(reached[name] >= min,
    `only ${reached[name]} hands reached the "${name}" case (wanted at least ${min}); ` +
    `that branch is effectively untested`);
}

console.log('rules oracle: ' + checks.toLocaleString() + ' assertions');
console.log('  cases reached: ' + Object.entries(reached)
  .map(([k, v]) => k + ' ' + v).join(', '));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of fails.slice(0, 25)) console.error('  - ' + f);
  if (fails.length > 25) console.error('  ... and ' + (fails.length - 25) + ' more');
  process.exit(1);
}
console.log('rules oracle: OK');
