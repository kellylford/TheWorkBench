/* How the game actually plays, measured rather than asserted.
 *
 * Not part of `npm test`, and it deliberately fails nothing: these are numbers,
 * and what counts as a good number is a judgement about the game rather than a
 * fact about the code. It exists because the bidding thresholds in js/ai.js are
 * the only figures in this project arrived at by measurement, and a tuning knob
 * with no way to measure it is a knob nobody will ever turn again.
 *
 * What a euchre player would expect to see at a table of four reasonable
 * players, and what this actually measures:
 *
 *   a suit is named on roughly nine hands in ten     measured 94-99%   met
 *   the makers are euchred roughly one hand in six   measured 13-19%   met
 *   somebody goes alone a few times an evening       measured 8-10%    met
 *   a march comes up                                 measured 12-16%   LOW
 *
 * THE MARCH RATE IS THE ONE OPEN QUESTION. Published figures for euchre put a
 * sweep nearer one hand in five, and this table sits below that in every
 * configuration. It is not known whether that is the computer defending a shade
 * too well, the makers bidding a shade too thin, or the published figure being
 * for a livelier table than four cautious players make. Nobody has measured it
 * properly, so it is written down as an open question rather than quietly
 * restated as the target — a target that matches whatever the code happens to do
 * is not a target.
 *
 *   node tests/balance.js            report the current settings
 *   node tests/balance.js sweep      sweep the two thresholds
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function load(seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const seededMath = Object.create(Math);
  seededMath.random = rnd;
  const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.SH;
}

function run(SH, { hands, difficulty, stickTheDealer, allowAlone }) {
  const { Game: G, AI } = SH;
  const st = G.createGame({
    numPlayers: 4,
    names: ['North', 'East', 'South', 'West'],
    pointsToWin: 10, stickTheDealer, difficulty, allowAlone
  });
  G.applyAction(st, 0, { type: 'start' });

  const s = {
    hands: 0, thrown: 0, alone: 0, aloneMarch: 0, euchred: 0, march: 0,
    round1: 0, round2: 0, dealerSide: 0, points: [0, 0], games: 0, problems: 0
  };
  let guard = 0;
  while (s.hands < hands && guard++ < hands * 200) {
    if (st.phase === 'handOver') {
      const h = st.history[st.history.length - 1];
      s.hands++;
      if (h.problems.length) { s.problems++; console.error('AUDIT FAILED:', h.problems.join('; ')); }
      if (h.result.thrownIn) s.thrown++;
      else {
        if (h.turnedDown) s.round2++; else s.round1++;
        if (h.alone) { s.alone++; if (h.result.made === 5) s.aloneMarch++; }
        if (h.result.euchred) s.euchred++;
        if (h.result.made === 5) s.march++;
        if (G.teamOf(h.maker) === G.teamOf(h.dealer)) s.dealerSide++;
        s.points[0] += h.result.deltas[0];
        s.points[1] += h.result.deltas[1];
      }
      if (st.gameOver) s.games++;
      G.applyAction(st, 0, { type: 'nextHand' });
      continue;
    }
    AI.act(st);
  }
  return s;
}

function pct(a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '—'; }

function report(label, s) {
  const bid = s.hands - s.thrown;
  console.log(
    label.padEnd(30) +
    ' named ' + pct(bid, s.hands).padStart(6) +
    '  euchred ' + pct(s.euchred, bid).padStart(6) +
    '  march ' + pct(s.march, bid).padStart(6) +
    '  alone ' + pct(s.alone, bid).padStart(6) +
    '  alone swept ' + pct(s.aloneMarch, s.alone).padStart(6) +
    '  r1/r2 ' + pct(s.round1, bid).padStart(6) +
    '  dealer side ' + pct(s.dealerSide, bid).padStart(6) +
    (s.problems ? '  *** ' + s.problems + ' AUDIT FAILURES ***' : '')
  );
}

const mode = process.argv[2] || 'report';

if (mode === 'sweep') {
  console.log('Sweeping the two bidding thresholds. 3000 hands each, hard opponents.\n');
  for (const order of [1.85, 1.95, 2.05, 2.15, 2.25, 2.40]) {
    for (const call of [2.05, 2.20, 2.35, 2.50]) {
      const SH = load(20260820);
      SH.AI.THRESHOLDS.order = order;
      SH.AI.THRESHOLDS.call = call;
      const s = run(SH, { hands: 3000, difficulty: 'hard', stickTheDealer: false, allowAlone: true });
      report('order ' + order.toFixed(2) + ' call ' + call.toFixed(2), s);
    }
  }
} else {
  console.log('Euchre balance, 4000 hands per row, at the settings in js/ai.js.\n');
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const SH = load(20260820);
    report(difficulty + ', alone on', run(SH, { hands: 4000, difficulty, stickTheDealer: false, allowAlone: true }));
  }
  {
    const SH = load(777);
    report('hard, stick the dealer', run(SH, { hands: 4000, difficulty: 'hard', stickTheDealer: true, allowAlone: true }));
  }
  {
    const SH = load(778);
    report('hard, alone off', run(SH, { hands: 4000, difficulty: 'hard', stickTheDealer: false, allowAlone: false }));
  }
  console.log('\nThe first column is the one the thresholds move most. A euchre table' +
    '\nnames a suit on about nine hands in ten.');
}
