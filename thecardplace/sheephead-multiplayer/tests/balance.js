/* Focused per-count sweep around the crossover found in tune2. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function load(base) {
  const sandbox = { console, Math, Date, JSON, setTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
    let src = fs.readFileSync(path.join(root, f), 'utf8');
    if (f === 'js/ai.js') {
      const v = String(base);
      src = src.replace(/var PICK_BASE = \{[^}]*\};/,
        `var PICK_BASE = { 3: ${v}, 4: ${v}, 5: ${v}, 6: ${v} };`);
    }
    vm.runInContext(src, sandbox, { filename: f });
  }
  return sandbox.SH;
}

function trial(SH, numPlayers, hands) {
  const { Game: G, AI } = SH;
  const names = ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, numPlayers);
  let leaster = 0, scored = 0, wins = 0, ev = 0, picks = 0, dec = 0;
  for (let i = 0; i < hands; i++) {
    const st = G.createGame({ numPlayers, names, allPass: 'leaster', difficulty: 'hard' });
    G.newHand(st);
    let guard = 0;
    while (st.phase !== 'handOver' && ++guard < 500) {
      if (st.phase === 'pick') { dec++; if (AI.shouldPick(st, st.turn)) picks++; }
      AI.act(st);
      st.events.length = 0;
    }
    if (st.isLeaster) leaster++;
    else { scored++; if (st.result.pickerWins) wins++; ev += st.result.deltas[st.picker]; }
  }
  return {
    pickRate: 100 * picks / Math.max(1, dec),
    leaster: 100 * leaster / hands,
    win: 100 * wins / Math.max(1, scored),
    ev: ev / Math.max(1, scored)
  };
}

const PLAN = {
  3: [11, 12, 13, 14, 15, 16, 17],
  4: [7.0, 7.25, 7.5, 7.75, 8.0],
  5: [8.25, 8.5, 8.75, 9.0, 9.25],
  6: [8.25, 8.5, 8.75, 9.0, 9.25]
};
const N = 6000;
console.log(' n  base  pickRate  leaster  pickerWin  pickerEV');
for (const n of [3, 4, 5, 6]) {
  for (const base of PLAN[n]) {
    const r = trial(load(base), n, N);
    console.log(
      String(n).padStart(2), String(base).padStart(5),
      String(Math.round(r.pickRate)).padStart(9) + '%',
      String(Math.round(r.leaster)).padStart(7) + '%',
      String(Math.round(r.win)).padStart(9) + '%',
      r.ev.toFixed(2).padStart(10));
  }
  console.log('');
}
