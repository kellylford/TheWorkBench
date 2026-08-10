/* Headless harness: runs full hands with every seat driven by the AI and
 * checks the invariants that matter. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Math, Date, JSON, setTimeout, localStorage: undefined };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Cards: C, Game: G, AI } = sandbox.SH;

let fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); }

function playOne(numPlayers, allPass, difficulty) {
  const names = ['You', 'Alice', 'Ben', 'Cara', 'Elle', 'Finn'].slice(0, numPlayers);
  const st = G.createGame({ numPlayers, names, allPass, difficulty });
  G.newHand(st);
  let guard = 0;
  while (st.phase !== 'handOver') {
    if (++guard > 500) { fails.push('stuck: ' + st.phase); return st; }
    const before = st.phase + ':' + st.turn + ':' + st.players.map(p => p.hand.length).join(',');

    if (st.phase === 'play') {
      const p = st.turn;
      const legal = G.legalPlays(st, p);
      const pick = AI.chooseCard(st, p);
      check(legal.some(c => c.id === pick), 'AI chose an illegal card: ' + pick);
      // trick-following invariant
      if (st.trick.length) {
        const led = C.effSuit(st.trick[0].card);
        const canFollow = st.players[p].hand.some(c => C.effSuit(c) === led);
        if (canFollow) check(C.effSuit(C.get(pick)) === led, 'AI failed to follow suit');
      }
    }
    AI.act(st);
    st.events.length = 0;
    const after = st.phase + ':' + st.turn + ':' + st.players.map(p => p.hand.length).join(',');
    check(before !== after, 'no progress at ' + before);
  }

  // ---- invariants at hand end ----
  const d = G.DEAL[numPlayers];
  const dealt = st.players.reduce((a, p) => a + p.tricksWon, 0);
  check(dealt === d.hand, `trick count ${dealt} != ${d.hand} (${numPlayers}p)`);
  check(st.players.every(p => p.hand.length === 0), 'cards left in hand');
  check(st.played.length === numPlayers * d.hand, 'played count wrong: ' + st.played.length);
  check(new Set(st.played.map(c => c.id)).size === st.played.length, 'duplicate card played');

  const taken = st.players.reduce((a, p) => a + p.points, 0);
  const buried = C.sumPoints(st.buried);
  const blind = st.isLeaster ? 0 : C.sumPoints(st.blind);
  check(taken + buried + blind === 120, `points ${taken}+${buried}+${blind} != 120`);

  const sum = st.result.deltas.reduce((a, b) => a + b, 0);
  check(sum === 0, 'scoring is not zero-sum: ' + st.result.deltas.join(','));

  if (!st.isLeaster) {
    check(st.picker >= 0, 'no picker in a non-leaster hand');
    if (!st.alone) check(st.partnerRevealed, 'partner never revealed');
    if (st.alone) check(st.partner === -1, 'alone but has a partner index');
    check(st.buried.length === d.blind, 'wrong bury size');
  }
  return st;
}

const stats = {};
for (const n of [3, 4, 5, 6]) {
  for (const ap of ['leaster', 'redeal']) {
    for (const diff of ['easy', 'normal', 'hard']) {
      const key = `${n}p/${ap}/${diff}`;
      stats[key] = { hands: 0, leaster: 0, alone: 0, pickerWins: 0, scored: 0 };
      for (let i = 0; i < 150; i++) {
        const st = playOne(n, ap, diff);
        const s = stats[key];
        s.hands++;
        if (st.isLeaster) s.leaster++;
        else {
          s.scored++;
          if (st.alone) s.alone++;
          if (st.result.pickerWins) s.pickerWins++;
        }
      }
    }
  }
}

for (const k of Object.keys(stats)) {
  const s = stats[k];
  console.log(k.padEnd(20),
    'leaster', String(Math.round(100 * s.leaster / s.hands)).padStart(3) + '%',
    ' alone', String(Math.round(100 * s.alone / Math.max(1, s.scored))).padStart(3) + '%',
    ' picker wins', String(Math.round(100 * s.pickerWins / Math.max(1, s.scored))).padStart(3) + '%');
}

/* The opening dealer must be drawn at random, then rotate. Otherwise the player
 * always deals hand 1 and is always last to decide on the blind. */
{
  for (const n of [3, 4, 5, 6]) {
    const counts = new Array(n).fill(0);
    const RUNS = 4000;
    for (let i = 0; i < RUNS; i++) {
      const st = G.createGame({
        numPlayers: n, names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n),
        allPass: 'leaster', difficulty: 'hard'
      });
      G.newHand(st);
      counts[st.dealer]++;
      // and it rotates from there
      const first = st.dealer;
      for (let k = 1; k <= n; k++) {
        G.newHand(st);
        check(st.dealer === (first + k) % n,
          `${n}p: dealer should rotate, expected ${(first + k) % n} got ${st.dealer}`);
      }
    }
    check(counts.every(c => c > 0), `${n}p: some seats never dealt first: ${counts.join(',')}`);
    const expected = RUNS / n;
    counts.forEach((c, i) => {
      check(Math.abs(c - expected) < expected * 0.25,
        `${n}p: seat ${i} dealt first ${c} times, expected around ${expected}`);
    });
    check(counts[0] < RUNS * 0.9, `${n}p: the player is nearly always the first dealer`);
  }
}

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + fails.length + ' total, ' + uniq.length + ' distinct):');
  uniq.slice(0, 20).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nAll invariants held across ' + Object.values(stats).reduce((a, s) => a + s.hands, 0) + ' hands.');
