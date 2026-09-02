/* Rules oracle.
 *
 * Every other test in this directory checks that the game is CONSISTENT WITH
 * ITSELF: that points total 120, that scoring is zero-sum, that the AI only
 * plays cards legalPlays() handed it. Those are conservation laws, and they all
 * hold perfectly well while the game plays the wrong game.
 *
 * Demonstrated, not assumed: swapping two entries in TRUMP_ORDER so the eight of
 * diamonds beats the nine sailed through every one of them. Twenty-five thousand
 * simulated hands, the wrong player winning tricks throughout, and nothing
 * noticed — because the same cards still exist, so the points still add to 120;
 * the transfer is still zero-sum; and the legality check validates the AI's move
 * against the very function that produced it.
 *
 * So this file does not ask the engine what the rules are. The rules below are
 * written out from the game's own How to Play dialog — the text a player is
 * shown and is entitled to rely on — and the engine is measured against them.
 * NOTHING here may call C.isTrump, C.power, C.beats, C.effSuit, C.points or
 * G.legalPlays to work out what it expects. Those are the things on trial. The
 * moment this file starts borrowing them, it stops being evidence.
 *
 *   node tests/rules-oracle.js
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
const { Game: G, AI, Cards: C } = sandbox.SH;

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
let assertions = 0;
const claim = (cond, msg) => { assertions++; check(cond, msg); };

/* ===================================================================
 * THE RULES, WRITTEN OUT INDEPENDENTLY
 *
 * Quoting How to Play:
 *   "Thirty-two cards: seven, eight, nine, ten, jack, queen, king and ace in
 *    each suit. At four players the seven and eight of diamonds come out."
 *   "Trump is a single fourteen card suit made of all four queens, then all four
 *    jacks, then the whole diamond suit."
 *   "Fail suits are clubs, spades and hearts, ranked ace, ten, king, nine,
 *    eight, seven."
 *   "Card values: ace 11, ten 10, king 4, queen 3, jack 2, and nine, eight and
 *    seven nothing."
 * =================================================================== */

const ORACLE_SUITS = ['C', 'S', 'H', 'D'];
const ORACLE_RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

const ORACLE_DECK = [];
for (const s of ORACLE_SUITS) for (const r of ORACLE_RANKS) ORACLE_DECK.push(r + s);

const ORACLE_POINTS = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };

/* Highest first. Typed out by hand from the sentence in How to Play; not
 * generated, because a generator would encode the same assumption twice. */
const ORACLE_TRUMP = [
  'QC', 'QS', 'QH', 'QD',
  'JC', 'JS', 'JH', 'JD',
  'AD', 'TD', 'KD', '9D', '8D', '7D'
];
const ORACLE_FAIL_RANKS = ['A', 'T', 'K', '9', '8', '7'];   // highest first

const oIsTrump = id => ORACLE_TRUMP.indexOf(id) >= 0;
const oPoints = id => ORACLE_POINTS[id[0]];
const oSuitLed = id => (oIsTrump(id) ? 'TRUMP' : id[1]);

/* Ranks within whichever suit the card belongs to. Lower index is stronger. */
function oRank(id) {
  return oIsTrump(id) ? ORACLE_TRUMP.indexOf(id) : ORACLE_FAIL_RANKS.indexOf(id[0]);
}

/* "Highest trump takes the trick; if no trump is played, the highest card of the
 * led suit takes it." Written as a direct reading of that sentence. */
function oTrickWinner(ids) {
  const led = oSuitLed(ids[0]);
  const trumps = ids.filter(oIsTrump);
  const pool = trumps.length
    ? trumps
    : ids.filter(id => oSuitLed(id) === led);
  let best = pool[0];
  for (const id of pool) if (oRank(id) < oRank(best)) best = id;
  return ids.indexOf(best);
}

/* "You must follow the suit that was led if you can... if a queen, jack or
 * diamond is led, every queen, jack and diamond in your hand must follow it."  */
function oLegal(handIds, ledId) {
  if (!ledId) return handIds.slice();
  const led = oSuitLed(ledId);
  const following = handIds.filter(id => oSuitLed(id) === led);
  return following.length ? following : handIds.slice();
}

/* "The picker's team needs 61 of the 120 points. A normal win pays one unit, 91
 *  or more pays two (a schneider), and taking every trick pays three. If the
 *  picker's team falls short they pay double, and more if they are held to 30
 *  points or fewer, or take no tricks at all." */
function oScore(pickerPts, pickerTricks, totalTricks) {
  if (pickerPts >= 61) {
    if (pickerTricks === totalTricks) return { win: true, mult: 3 };
    if (pickerPts >= 91) return { win: true, mult: 2 };
    return { win: true, mult: 1 };
  }
  if (pickerTricks === 0) return { win: false, mult: 4 };
  if (pickerPts <= 30) return { win: false, mult: 3 };
  return { win: false, mult: 2 };
}

/* ===================================================================
 * 1. The deck
 * =================================================================== */
{
  const engineDeck = G.deckFor(3).map(c => c.id).sort();
  claim(engineDeck.length === 32, 'the three player deck is not 32 cards: ' + engineDeck.length);
  claim(engineDeck.join(',') === ORACLE_DECK.slice().sort().join(','),
    'the deck is not the 32 cards the rules describe');

  // "At four players the seven and eight of diamonds come out, leaving thirty."
  const four = G.deckFor(4).map(c => c.id).sort();
  claim(four.length === 30, 'the four player deck is not 30 cards: ' + four.length);
  claim(four.indexOf('7D') < 0 && four.indexOf('8D') < 0,
    'the four player deck still contains the seven or eight of diamonds');

  // "Both are worth nothing, so a hand is 120 points at every table size."
  for (const n of [3, 4, 5, 6]) {
    const total = G.deckFor(n).reduce((t, c) => t + oPoints(c.id), 0);
    claim(total === 120, n + ' players: the deck is worth ' + total + ' points, not 120');
  }
}

/* ===================================================================
 * 2. Card values
 * =================================================================== */
for (const id of ORACLE_DECK) {
  claim(C.points(C.get(id)) === oPoints(id),
    id + ' is worth ' + C.points(C.get(id)) + ', the rules say ' + oPoints(id));
}

/* ===================================================================
 * 3. What is trump, and in what order
 * =================================================================== */
{
  claim(C.TRUMP_ORDER.join(',') === ORACLE_TRUMP.join(','),
    'the trump order does not match the rules.\n      engine: ' + C.TRUMP_ORDER.join(' ') +
    '\n      rules:  ' + ORACLE_TRUMP.join(' '));
  claim(ORACLE_TRUMP.length === 14, 'trump is not fourteen cards');

  for (const id of ORACLE_DECK) {
    claim(C.isTrump(C.get(id)) === oIsTrump(id),
      id + ': the engine calls it ' + (C.isTrump(C.get(id)) ? 'trump' : 'fail') +
      ', the rules say ' + (oIsTrump(id) ? 'trump' : 'fail'));
  }

  // "a queen of clubs does not follow a lead of clubs"
  claim(C.effSuit(C.get('QC')) !== C.effSuit(C.get('AC')),
    'the queen of clubs follows a lead of clubs, but it is trump');
  claim(C.effSuit(C.get('QC')) === C.effSuit(C.get('7D')),
    'the queen of clubs and the seven of diamonds are not the same suit, but both are trump');
}

/* ===================================================================
 * 4. Which card beats which — every ordered pair in the deck
 *
 * 32 x 32. This is the check that the trump-order swap could not have survived.
 * =================================================================== */
{
  let pairs = 0, wrong = [];
  for (const a of ORACLE_DECK) {
    for (const b of ORACLE_DECK) {
      if (a === b) continue;
      // b is the card currently winning the trick; does a take it from b?
      const expected = oIsTrump(a)
        ? (!oIsTrump(b) || oRank(a) < oRank(b))
        : (!oIsTrump(b) && a[1] === b[1] && oRank(a) < oRank(b));
      const got = C.beats(C.get(a), C.get(b));
      pairs++;
      if (got !== expected && wrong.length < 8) {
        wrong.push(a + ' over ' + b + ': engine says ' + got + ', rules say ' + expected);
      }
      if (got !== expected) assertions++;
    }
  }
  assertions += pairs - wrong.length;
  check(wrong.length === 0, 'beats() disagrees with the rules on ' + wrong.length +
    ' or more pairs:\n      ' + wrong.join('\n      '));

  // The headline consequences, stated separately so a failure names the rule.
  claim(C.beats(C.get('7D'), C.get('AC')), 'the lowest trump does not beat the highest fail card');
  claim(!C.beats(C.get('AC'), C.get('7D')), 'the ace of clubs beats a trump');
  claim(C.beats(C.get('QC'), C.get('QS')), 'the queen of clubs does not beat the queen of spades');
  claim(!C.beats(C.get('QS'), C.get('QC')), 'the queen of spades beats the queen of clubs');
  claim(C.beats(C.get('AC'), C.get('KC')), 'the ace of clubs does not beat the king of clubs');
  claim(C.beats(C.get('TC'), C.get('KC')), 'the ten does not beat the king — it outranks it in Sheephead');
  claim(!C.beats(C.get('KC'), C.get('TC')), 'the king beats the ten, but the ten is higher');
  claim(!C.beats(C.get('AS'), C.get('KC')), 'a spade beat a club that was winning the trick');
  claim(C.beats(C.get('JD'), C.get('AD')), 'the jack of diamonds does not beat the ace of diamonds');
}

/* ===================================================================
 * 5. Who takes the trick — written out cases, then exhaustive random ones
 * =================================================================== */
{
  // Hand-written, with the reason spelled out, so a failure is readable.
  const CASES = [
    { play: ['AC', 'TC', 'KC'], win: 0, why: 'ace is the highest club' },
    { play: ['KC', 'TC', 'AC'], win: 2, why: 'ace still wins from third seat' },
    { play: ['AC', 'TC', '7D'], win: 2, why: 'the lowest trump beats every fail card' },
    { play: ['AC', 'QC', 'KC'], win: 1, why: 'the queen of clubs is trump, not a club' },
    { play: ['AC', 'AS', 'AH'], win: 0, why: 'off-suit aces cannot win — they did not follow' },
    { play: ['QD', 'QC'], win: 1, why: 'queen of clubs is the highest card in the deck' },
    { play: ['7D', 'AD', 'JD'], win: 2, why: 'jacks outrank the ace of diamonds' },
    { play: ['JD', 'QD'], win: 1, why: 'every queen outranks every jack' },
    { play: ['TS', 'KS', '9S'], win: 0, why: 'the ten is the top card left in a fail suit' },
    { play: ['9H', '8H', '7H'], win: 0, why: 'nine is the highest of three worthless hearts' },
    { play: ['AH', '7C', '8S'], win: 0, why: 'nobody followed hearts, so the lead holds' }
  ];
  for (const t of CASES) {
    const plays = t.play.map((id, i) => ({ player: i, card: C.get(id) }));
    const got = G.trickWinnerIndex(plays);
    claim(got === t.win,
      'trick [' + t.play.join(' ') + '] was won by seat ' + got + ', should be seat ' +
      t.win + ' — ' + t.why);
  }

  // Then a wide random sweep, each trick scored independently.
  let tricks = 0, mismatches = [];
  let seed = 20260811;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 20000; i++) {
    const size = 3 + Math.floor(rnd() * 4);
    const pool = ORACLE_DECK.slice();
    const ids = [];
    for (let k = 0; k < size; k++) ids.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const plays = ids.map((id, k) => ({ player: k, card: C.get(id) }));
    const got = G.trickWinnerIndex(plays);
    const want = oTrickWinner(ids);
    tricks++;
    if (got !== want && mismatches.length < 5) {
      mismatches.push('[' + ids.join(' ') + '] engine seat ' + got + ', rules seat ' + want);
    }
  }
  assertions += tricks;
  check(mismatches.length === 0,
    'trickWinnerIndex disagrees with the rules:\n      ' + mismatches.join('\n      '));
}

/* ===================================================================
 * 6. What you are allowed to play
 * =================================================================== */
{
  // A state good enough for legalPlays: a trick in progress and a known hand.
  function legalFrom(handIds, ledId) {
    const st = G.createGame({
      numPlayers: 5, names: ['You', 'A', 'B', 'C', 'D'],
      allPass: 'leaster', difficulty: 'hard'
    });
    G.newHand(st);
    st.phase = 'play';
    st.players[0].hand = handIds.map(C.get);
    st.trick = ledId ? [{ player: 1, card: C.get(ledId) }] : [];
    return G.legalPlays(st, 0).map(c => c.id).sort();
  }

  const CASES = [
    { hand: ['AC', 'KC', 'AS'], led: 'TC', want: ['AC', 'KC'], why: 'must follow clubs' },
    { hand: ['AC', 'KC', 'AS'], led: 'QH', want: [], why: 'no trump in hand, so anything goes' },
    { hand: ['QC', 'JS', '9D', 'AC'], led: 'TD', want: ['QC', 'JS', '9D'],
      why: 'a diamond lead is a trump lead, so queens and jacks must follow' },
    { hand: ['QC', 'AC', 'KC'], led: 'AS', want: [],
      why: 'no spades, and the queen of clubs is not a club' },
    { hand: ['QC', 'AC', 'KC'], led: 'TC', want: ['AC', 'KC'],
      why: 'the queen of clubs does not follow a lead of clubs' },
    { hand: ['JD'], led: 'AC', want: [], why: 'the only card is always playable' },
    { hand: ['AH', '7H', 'QD'], led: '9H', want: ['AH', '7H'], why: 'must follow hearts' }
  ];
  for (const t of CASES) {
    const got = legalFrom(t.hand, t.led);
    const want = (t.want.length ? t.want : t.hand).slice().sort();
    claim(got.join(',') === want.join(','),
      'holding [' + t.hand + '] with ' + t.led + ' led, the engine allows [' + got +
      '] but the rules allow [' + want + '] — ' + t.why);
  }

  // Random hands against the independent reading of the follow-suit rule.
  let seed = 77777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let checked = 0, bad = [];
  for (let i = 0; i < 3000; i++) {
    const pool = ORACLE_DECK.slice();
    const size = 1 + Math.floor(rnd() * 7);
    const hand = [];
    for (let k = 0; k < size; k++) hand.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const led = pool[Math.floor(rnd() * pool.length)];
    const got = legalFrom(hand, led).join(',');
    const want = oLegal(hand, led).slice().sort().join(',');
    checked++;
    if (got !== want && bad.length < 5) {
      bad.push('hand [' + hand.join(' ') + '] led ' + led + ': engine [' + got + '] rules [' + want + ']');
    }
  }
  assertions += checked;
  check(bad.length === 0, 'legalPlays disagrees with the rules:\n      ' + bad.join('\n      '));
}

/* ===================================================================
 * 7. The partner card
 * =================================================================== */
{
  claim(G.PARTNER_CARD === 'JD', 'the partner card is not the jack of diamonds');
  claim(G.DEAL[3].partner === false, 'three players should have no partner card');
  for (const n of [4, 5, 6]) {
    claim(G.DEAL[n].partner === true, n + ' players should use the jack of diamonds partner');
  }
  // "Everyone gets a hand and a small blind is set aside."
  for (const n of [3, 4, 5, 6]) {
    const d = G.DEAL[n];
    claim(d.hand * n + d.blind === G.deckFor(n).length,
      n + ' players: ' + d.hand + ' cards each plus a ' + d.blind +
      ' card blind does not use up the deck');
  }
}

/* ===================================================================
 * 8. Scoring, re-derived over real gameplay
 *
 * Plays thousands of complete hands and independently recomputes the outcome
 * from the rules text, rather than trusting the engine's own arithmetic. Also
 * records which thresholds were actually reached, and fails if the interesting
 * boundaries were never exercised — a scoring test that never sees 61 points is
 * not testing the 61 point rule.
 * =================================================================== */
{
  const seen = { win: 0, lose: 0, schneider: 0, allTricks: 0, schneiderAgainst: 0, noTricks: 0 };
  const boundary = { at60: 0, at61: 0, at90: 0, at91: 0, at30: 0, at31: 0 };
  let scored = 0, leasters = 0, bad = [];

  for (const n of [3, 4, 5, 6]) {
    for (let i = 0; i < 1500; i++) {
      const st = G.createGame({
        numPlayers: n, names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n),
        allPass: 'leaster', difficulty: 'hard'
      });
      G.newHand(st);
      let guard = 0;
      while (st.phase !== 'handOver' && ++guard < 500) { AI.act(st); st.events.length = 0; }
      if (st.isLeaster) { leasters++; continue; }

      const r = st.result;
      const totalTricks = G.DEAL[n].hand;

      // Recompute the picker's side independently: buried cards belong to the
      // picker ("those buried cards count for the picker's team at the end"),
      // plus every trick taken by the picker and, if there is one, the partner.
      const team = [st.picker];
      if (!st.alone && st.partner >= 0) team.push(st.partner);
      let pts = st.buried.reduce((t, c) => t + oPoints(c.id), 0);
      let tricks = 0;
      for (const seat of team) { pts += st.players[seat].points; tricks += st.players[seat].tricksWon; }

      const want = oScore(pts, tricks, totalTricks);
      scored++;

      if (pts === 60) boundary.at60++;
      if (pts === 61) boundary.at61++;
      if (pts === 90) boundary.at90++;
      if (pts === 91) boundary.at91++;
      if (pts === 30) boundary.at30++;
      if (pts === 31) boundary.at31++;
      if (want.win) { seen.win++; if (want.mult === 2) seen.schneider++; if (want.mult === 3) seen.allTricks++; }
      else { seen.lose++; if (want.mult === 3) seen.schneiderAgainst++; if (want.mult === 4) seen.noTricks++; }

      if (r.pickerWins !== want.win && bad.length < 5) {
        bad.push(n + 'p: picker had ' + pts + ' points in ' + tricks + ' tricks; engine says ' +
          (r.pickerWins ? 'win' : 'loss') + ', the rules say ' + (want.win ? 'win' : 'loss'));
      }
      if (r.pickerPts !== pts && bad.length < 5) {
        bad.push(n + 'p: engine counted ' + r.pickerPts + ' points for the picker, the rules make it ' + pts);
      }
      // "Each opponent settles for two units times the multiplier."
      const oppCount = n - team.length;
      const expectedStake = 2 * want.mult * r.factor;
      const oppDeltas = st.players.map((p, seat) => team.indexOf(seat) < 0 ? r.deltas[seat] : null)
        .filter(v => v !== null);
      const wrongStake = oppDeltas.filter(v => Math.abs(v) !== expectedStake);
      if (wrongStake.length && bad.length < 5) {
        bad.push(n + 'p: with ' + pts + ' points the stake should be ' + expectedStake +
          ' per opponent, got ' + oppDeltas.join(','));
      }
      if (oppDeltas.length !== oppCount && bad.length < 5) {
        bad.push(n + 'p: expected ' + oppCount + ' opponents, found ' + oppDeltas.length);
      }
      // Winners gain and losers lose, in the direction the result claims.
      const pickerDelta = r.deltas[st.picker];
      if (want.win && pickerDelta <= 0 && bad.length < 5) {
        bad.push(n + 'p: the picker won with ' + pts + ' points but scored ' + pickerDelta);
      }
      if (!want.win && pickerDelta >= 0 && bad.length < 5) {
        bad.push(n + 'p: the picker lost with ' + pts + ' points but scored ' + pickerDelta);
      }
    }
  }

  assertions += scored * 4;
  check(bad.length === 0, 'scoring disagrees with the rules:\n      ' + bad.join('\n      '));

  console.log('hands scored:', scored, '(' + leasters + ' leasters skipped)');
  console.log('  picker won ' + seen.win + ', lost ' + seen.lose +
    '; schneider ' + seen.schneider + ', every trick ' + seen.allTricks +
    ', schneidered against ' + seen.schneiderAgainst + ', no tricks ' + seen.noTricks);
  console.log('  boundaries reached: 60/61 ' + boundary.at60 + '/' + boundary.at61 +
    ', 90/91 ' + boundary.at90 + '/' + boundary.at91 +
    ', 30/31 ' + boundary.at30 + '/' + boundary.at31);

  // A scoring test that never lands on the boundary is not testing the boundary.
  check(boundary.at60 > 0 && boundary.at61 > 0,
    'never saw a hand end on 60 or 61 points, so the winning threshold went untested');
  check(seen.schneider > 0, 'never saw a schneider, so the 91 point rule went untested');
  check(seen.lose > 0, 'the picker never lost, so the losing multipliers went untested');
}

/* =================================================================== */
if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
  uniq.slice(0, 20).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n' + assertions.toLocaleString() +
  ' assertions: the engine plays the game the rules describe.');
