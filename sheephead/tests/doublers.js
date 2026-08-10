/* House-rule doublers.
 *
 * The rules as chosen:
 *   - a queen pair counts only when ONE player holds both, in their own hand
 *     after burying
 *   - a doubler multiplies the whole hand, win or lose, not just the holder's
 *     winnings
 *   - a redeal doubles the NEXT hand and does not stack
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function load() {
  const sandbox = { console, Math, Date, JSON, setTimeout, Set };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.SH;
}
const SH = load();
const { Game: G, AI, Cards: C } = SH;

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

function newGame(over) {
  return G.createGame(Object.assign({
    numPlayers: 5,
    names: ['You', 'A', 'B', 'C', 'D'],
    allPass: 'leaster',
    difficulty: 'hard',
    blackQueenDoubler: true,
    redQueenDoubler: true,
    redealDoubler: true
  }, over || {}));
}

/* Deal a controlled hand: `seatCards[i]` are forced into seat i. */
function stack(st, seatCards) {
  const want = {};
  seatCards.forEach((ids, seat) => ids.forEach(id => { want[id] = seat; }));
  const pool = [];
  st.players.forEach(p => pool.push(...p.hand));
  pool.push(...st.blind);
  const byId = {}; pool.forEach(c => { byId[c.id] = c; });
  const taken = {};
  const hands = st.players.map((p, seat) => {
    const mine = (seatCards[seat] || []).map(id => { taken[id] = 1; return byId[id]; });
    return mine;
  });
  const rest = pool.filter(c => !taken[c.id]);
  let r = 0;
  hands.forEach((h, seat) => { while (h.length < st.players[seat].hand.length) h.push(rest[r++]); });
  st.players.forEach((p, seat) => { p.hand = C.sortHand(hands[seat]); });
  st.blind = rest.slice(r, r + 2);
}

function playOut(st) {
  let guard = 0;
  while (st.phase !== 'handOver' && ++guard < 500) { AI.act(st); st.events.length = 0; }
  return st.result;
}

/* --- 1. a pair split across a team must NOT count --- */
{
  const st = newGame();
  G.newHand(st);
  st.turn = 0;
  stack(st, [['QC'], ['QS']]);          // black queens in two different hands
  G.doPick(st, 0);
  const h = st.players[0].hand.filter(c => c.id !== 'QC');
  G.doBury(st, [h[0].id, h[1].id]);
  check(st.doublers.length === 0,
    'a queen pair split across two hands must not double: ' + JSON.stringify(st.doublers));
}

/* --- 2. one player holding both DOES count, and only once --- */
{
  const st = newGame();
  G.newHand(st);
  st.turn = 0;
  stack(st, [['QC', 'QS']]);
  G.doPick(st, 0);
  const h = st.players[0].hand.filter(c => !/^Q[CS]$/.test(c.id));
  G.doBury(st, [h[0].id, h[1].id]);
  check(st.doublers.length === 1, 'one hand with both black queens should give one doubler');
  check(st.doublers[0].kind === 'black' && st.doublers[0].player === 0, 'wrong doubler recorded');
}

/* --- 3. all four queens in one hand doubles twice (4x) --- */
{
  const st = newGame();
  G.newHand(st);
  st.turn = 0;
  stack(st, [['QC', 'QS', 'QH', 'QD']]);
  G.doPick(st, 0);
  const h = st.players[0].hand.filter(c => c.r !== 'Q');
  G.doBury(st, [h[0].id, h[1].id]);
  check(st.doublers.length === 2, 'all four queens should give two doublers');
  const res = playOut(st);
  check(res.factor === 4, 'all four queens should make the hand worth 4x, got ' + res.factor);
}

/* --- 4. a doubler multiplies a LOSS too --- */
{
  // The SAME deal played twice: once with doublers off, once on. Only the
  // magnitude may change — the winner and the shape of the result must not.
  // The deal is seeded, otherwise the two runs get different cards and the
  // comparison is meaningless.
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function run(withDoublers) {
    const realRandom = Math.random;
    Math.random = seeded(20260810);
    try {
      const st = newGame(withDoublers ? {} : {
        blackQueenDoubler: false, redQueenDoubler: false, redealDoubler: false
      });
      st.dealer = 3;
      G.newHand(st);
      st.turn = 0;
      stack(st, [['QC', 'QS']]);
      G.doPick(st, 0);
      const h = st.players[0].hand.filter(c => !/^Q[CS]$/.test(c.id));
      G.doBury(st, [h[0].id, h[1].id]);
      return { st, res: playOut(st) };
    } finally {
      Math.random = realRandom;
    }
  }
  const off = run(false), on = run(true);
  check(off.res.pickerWins === on.res.pickerWins, 'the doubler changed who won the hand');
  check(on.res.factor === 2, 'expected a 2x hand, got ' + on.res.factor);
  for (let i = 0; i < 5; i++) {
    check(on.res.deltas[i] === off.res.deltas[i] * 2,
      'seat ' + i + ' should be exactly doubled: ' + off.res.deltas[i] + ' -> ' + on.res.deltas[i]);
  }
  check(on.res.deltas.reduce((a, b) => a + b, 0) === 0, 'doubled scores are not zero sum');
  // and the doubled result must include a loss somewhere, proving losses double too
  check(on.res.deltas.some(v => v < 0), 'no losing side in the doubled hand');
}

/* --- 5. redeal doubles the next hand, and does not stack --- */
{
  const st = newGame({ allPass: 'redeal' });
  G.newHand(st);
  check(st.redealDoubler === false, 'a fresh hand should not be a doubler');
  const before = st.handNumber;
  for (let i = 0; i < 5; i++) G.doPass(st, st.turn);   // everyone passes -> redeal
  check(st.handNumber === before + 1, 'a redeal should start a new hand');
  check(st.redealDoubler === true, 'the hand after a redeal should be a doubler');
  check(G.doublerFactorFor(st) === 2, 'redeal should give 2x');

  // pass again: still 2x, not 4x
  for (let i = 0; i < 5; i++) G.doPass(st, st.turn);
  check(st.redealDoubler === true, 'the hand after a second redeal should still be a doubler');
  check(G.doublerFactorFor(st) === 2, 'consecutive redeals must not stack, got ' + G.doublerFactorFor(st));
}

/* --- 6. the redeal doubler is spent, not permanent --- */
{
  const st = newGame({ allPass: 'redeal', blackQueenDoubler: false, redQueenDoubler: false });
  G.newHand(st);
  for (let i = 0; i < 5; i++) G.doPass(st, st.turn);
  check(st.redealDoubler === true, 'expected a doubler after the redeal');
  st.turn = 0; G.doPick(st, 0);
  const h = st.players[0].hand;
  G.doBury(st, [h[0].id, h[1].id]);
  const res = playOut(st);
  check(res.factor === 2, 'the redealt hand should score 2x, got ' + res.factor);
  G.newHand(st);
  check(st.redealDoubler === false, 'the doubler should not carry into the hand after that');
}

/* --- 7. turning the options off restores plain scoring --- */
{
  const st = newGame({ blackQueenDoubler: false, redQueenDoubler: false, redealDoubler: false });
  G.newHand(st);
  st.turn = 0;
  stack(st, [['QC', 'QS', 'QH', 'QD']]);
  G.doPick(st, 0);
  const h = st.players[0].hand.filter(c => c.r !== 'Q');
  G.doBury(st, [h[0].id, h[1].id]);
  check(st.doublers.length === 0, 'doublers should be off');
  check(playOut(st).factor === 1, 'factor should be 1 with every doubler disabled');
}

/* --- 8. zero-sum and the audit still hold with doublers on, across many hands --- */
{
  let hands = 0, doubled = 0;
  for (const n of [3, 4, 5, 6]) {
    const st = G.createGame({
      numPlayers: n, names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n),
      allPass: 'redeal', difficulty: 'hard',
      blackQueenDoubler: true, redQueenDoubler: true, redealDoubler: true
    });
    for (let i = 0; i < 250; i++) {
      G.newHand(st);
      playOut(st);
      hands++;
      if (st.result.factor > 1) doubled++;
      check(st.result.deltas.reduce((a, b) => a + b, 0) === 0,
        n + 'p: scores not zero sum with doublers: ' + st.result.deltas.join(','));
    }
    st.history.forEach(h => check(h.problems.length === 0,
      n + 'p hand ' + h.handNumber + ' failed its audit: ' + h.problems.join(' ')));
  }
  console.log('hands played with doublers on:', hands, '(' + Math.round(100 * doubled / hands) + '% doubled)');
}

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
  uniq.slice(0, 15).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nDoublers behave as specified.');
