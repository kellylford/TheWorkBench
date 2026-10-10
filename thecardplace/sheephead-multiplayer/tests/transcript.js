/* Checks the exported game log: that the per-hand audit runs and passes on
 * healthy hands, that it actually catches a corrupted hand, and that exporting
 * part way through a hand does not disclose anybody else's cards. */
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

function newGame(n, names) {
  return G.createGame({
    numPlayers: n,
    names: names || ['You', 'Alice', 'Ben', 'Cara', 'Dan', 'Elle'].slice(0, n),
    allPass: 'leaster',
    difficulty: 'hard'
  });
}
function playHand(st) {
  let guard = 0;
  while (st.phase !== 'handOver' && ++guard < 500) { AI.act(st); st.events.length = 0; }
}

/* --- 1. the audit passes on healthy hands at every table size --- */
let audited = 0, leasters = 0;
for (const n of [3, 4, 5, 6]) {
  const st = newGame(n);
  for (let i = 0; i < 300; i++) { G.newHand(st); playHand(st); }
  st.history.forEach(h => {
    audited++;
    if (h.isLeaster) leasters++;
    check(h.problems.length === 0, `${n}p hand ${h.handNumber} failed its own audit: ${h.problems.join(' ')}`);
  });
  check(st.history.length === 300, `${n}p: expected 300 recorded hands, got ${st.history.length}`);

  const text = G.transcript(st, 0, []);
  check(/all 300 completed hands add up correctly/.test(text), `${n}p: transcript header did not report a clean check`);
  check(text.split('=== Hand ').length === 301, `${n}p: transcript is missing hands`);
}

/* --- 2. the audit CATCHES a deliberately broken hand --- */
{
  const cases = {
    'points that do not total 120': h => { h.points[0] += 1; },
    'a trick credited to the wrong total': h => { h.tricks[0].points += 5; },
    'scores that are not zero sum': h => { h.result.deltas[0] += 3; },
    'a duplicated card': h => { h.tricks[0].plays[0].card = h.tricks[0].plays[1].card; },
    'a missing trick': h => { h.tricks.pop(); }
  };
  for (const [label, corrupt] of Object.entries(cases)) {
    const st = newGame(5);
    G.newHand(st); playHand(st);
    const h = JSON.parse(JSON.stringify(st.history[0]));
    check(h.problems.length === 0, 'baseline hand was not clean');
    corrupt(h);
    const problems = G.auditHand(h);
    check(problems.length > 0, 'the audit did NOT catch ' + label);
  }
}

/* --- 3. mid-hand export must not disclose other players' cards --- */
{
  let checked = 0;
  for (const n of [4, 5, 6]) {
    for (let i = 0; i < 200; i++) {
      const st = newGame(n);
      G.newHand(st);
      // stop part way through the play phase
      let steps = 0;
      while (st.phase !== 'handOver' && steps < 3 + (i % 7)) {
        AI.act(st); st.events.length = 0;
        if (st.phase === 'play') steps++;
      }
      if (st.phase === 'handOver') continue;

      const text = G.transcript(st, 0, []);
      const mine = new Set(C.ids(st.players[0].hand));
      const played = new Set(st.played.map(c => c.id));

      // Every card id mentioned must be one of: my own hand, an already played
      // card, trump-order reference, or the deck-exclusion note.
      const body = text.split('=== Hand ').slice(1).join('=== Hand ');
      for (let p = 1; p < n; p++) {
        for (const id of C.ids(st.players[p].hand)) {
          if (mine.has(id) || played.has(id)) continue;
          const sym = C.shortText(C.get(id));
          // the trump reference line lists every trump, so only scan the hand body
          const handSection = body.split('Your hand:')[1] || body;
          check(handSection.indexOf(sym) < 0 || played.has(id),
            `${n}p: mid-hand export shows ${sym}, which is still in ${st.players[p].name}'s hand`);
        }
      }
      // the picker's bury must not appear unless the picker is me
      if (st.picker > 0 && st.buried.length) {
        for (const c of st.buried) {
          if (played.has(c.id) || mine.has(c.id)) continue;
          const handSection = (body.split('Your hand:')[1] || body);
          check(handSection.indexOf(C.shortText(c)) < 0,
            `${n}p: mid-hand export shows buried card ${C.shortText(c)}`);
        }
      }
      check(/in progress/.test(text), 'mid-hand export is not marked as in progress');
      check(!/^Dealt:/m.test(body.split('in progress)')[1] || ''), 'mid-hand export includes the full deal');
      checked++;
    }
  }
  console.log('mid-hand exports checked:', checked);
}

console.log('hands audited:        ', audited, '(' + leasters + ' leasters)');

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
  uniq.slice(0, 15).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nTranscript and audit behave correctly.');
