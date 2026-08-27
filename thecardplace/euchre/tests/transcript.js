/* The written record, and the accounting check behind it.
 *
 * Two separate jobs, tested together because they share a fixture.
 *
 * THE AUDIT MUST BE ABLE TO DISAGREE. Every hand is audited the moment it
 * finishes, and an audit that only ever passes is indistinguishable from no
 * audit at all. So the second half of this file takes real recorded hands,
 * breaks them in eight specific ways, and fails if the audit does not notice.
 *
 * THE EXPORT MUST NOT BE A PEEPHOLE. A player can export the log at any moment,
 * including in the middle of a hand — so the in-progress section is written from
 * one seat's point of view and must never print a card that is still in somebody
 * else's hand. Finished hands are printed in full, because by then they were
 * shown in full anyway.
 *
 *   node tests/transcript.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 777333;
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

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

function newGame(opts) {
  return G.createGame(Object.assign({
    numPlayers: 4, names: ['Ann', 'Bob', 'Cid', 'Dot'],
    pointsToWin: 10, stickTheDealer: false, allowAlone: true, difficulty: 'hard'
  }, opts || {}));
}

/* ============ 1. EVERY HAND AUDITS CLEAN ============ */

const st = newGame();
G.applyAction(st, 0, { type: 'start' });
let handsPlayed = 0;
for (let i = 0; i < 400; i++) {
  let guard = 0;
  while (st.phase !== 'handOver' && guard++ < 400) AI.act(st);
  if (st.phase !== 'handOver') { fails.push('a hand never finished'); break; }
  handsPlayed++;
  const h = st.history[st.history.length - 1];
  check(h.problems.length === 0, 'a played hand failed its audit: ' + h.problems.join('; '));
  G.applyAction(st, 0, { type: 'nextHand' });
  st.events.length = 0;
}
check(handsPlayed >= 400, 'only ' + handsPlayed + ' hands were played');

const played = st.history.filter(h => !h.result.thrownIn);
check(played.length > 300, 'only ' + played.length + ' hands were actually contested');

/* ============ 2. THE AUDIT CATCHES DELIBERATE CORRUPTION ============
 *
 * Each mutation takes a real hand, breaks one thing, and expects a complaint.
 * The interesting column is not that they are caught — it is that each one is a
 * DIFFERENT kind of wrong, so a single check that happens to fire on all of them
 * would be doing less work than it looks. */
const MUTATIONS = [
  ['a trick given to the wrong player', h => {
    const t = h.tricks[0];
    t.winner = (t.winner + 1) % 4;
  }],
  ['a card played in two tricks', h => {
    h.tricks[1].plays[0].card = h.tricks[0].plays[0].card;
  }],
  ['a missing trick', h => { h.tricks.pop(); }],
  ['a trick with a card too many', h => {
    h.tricks[0].plays.push({ player: 0, card: h.tricks[1].plays[0].card });
  }],
  ['a wrong trick count', h => { h.tricksWon[0] = h.tricksWon[0] + 1; }],
  ['a score that does not follow from the tricks', h => {
    h.result.deltas = [h.result.deltas[0] + 1, h.result.deltas[1]];
  }],
  ['both sides scoring on one hand', h => { h.result.deltas = [1, 2]; }],
  ['a card that is not in the deck', h => { h.dealt[0][0] = 'XX'; }],
  ['a card dealt to two players', h => { h.dealt[1][0] = h.dealt[0][0]; }],
  ['a deal that is short of the full deck', h => { h.kitty.pop(); }]
];

for (const [label, mutate] of MUTATIONS) {
  let caught = 0, tried = 0;
  for (const original of played.slice(0, 60)) {
    const h = JSON.parse(JSON.stringify(original));
    try { mutate(h); } catch (e) { continue; }
    tried++;
    const problems = G.auditHand(h);
    if (problems.length) caught++;
  }
  check(tried > 0, 'the mutation "' + label + '" could not be applied to any hand');
  check(caught === tried,
    'the audit missed "' + label + '" on ' + (tried - caught) + ' of ' + tried + ' hands');
}

/* And a hand that has NOT been corrupted still passes, so the mutations above
 * are not simply being caught by an audit that complains about everything. */
for (const original of played.slice(0, 60)) {
  const copy = JSON.parse(JSON.stringify(original));
  check(G.auditHand(copy).length === 0,
    'the audit complained about an untouched hand: ' + G.auditHand(copy).join('; '));
}

/* A thrown-in hand has no trump, no maker and no tricks, and must not be
 * reported as broken for it. */
{
  const thrown = st.history.filter(h => h.result.thrownIn);
  check(thrown.length > 0, 'no hand was ever thrown in, so that audit path is untested');
  for (const h of thrown) {
    check(G.auditHand(JSON.parse(JSON.stringify(h))).length === 0,
      'the audit complained about a thrown-in hand: ' + G.auditHand(h).join('; '));
  }
  /* But a thrown-in hand that somehow scored, or recorded tricks, is broken. */
  if (thrown.length) {
    const bad = JSON.parse(JSON.stringify(thrown[0]));
    bad.result.deltas = [1, 0];
    check(G.auditHand(bad).length > 0, 'the audit let a thrown-in hand score');
  }
}

/* ============ 3. A FAILED AUDIT REACHES THE PLAYER ============
 *
 * A check nobody is told about is a check that did not happen. The hand's own
 * problems are written into the log at the time, and the export flags them at
 * the top so a discrepancy is visible rather than buried in a plausible-looking
 * column. */
{
  const broken = newGame();
  G.applyAction(broken, 0, { type: 'start' });
  let guard = 0;
  while (broken.phase !== 'handOver' && guard++ < 400) AI.act(broken);
  broken.history[0].problems = ['the sky is the wrong colour'];
  const text = G.transcript(broken, 0, []);
  check(/ACCOUNTING CHECK FAILED/.test(text),
    'a hand with a failed audit is not flagged in the export');
  check(/Accounting checks failed: 1/.test(text),
    'the export does not count the failed audits at the top');
  check(/the sky is the wrong colour/.test(text),
    'the export does not say what actually failed');
}

/* ============ 4. A MID-HAND EXPORT IS NOT A PEEPHOLE ============ */
{
  let checkedStates = 0;
  for (let g = 0; g < 120; g++) {
    const live = newGame();
    G.applyAction(live, 0, { type: 'start' });
    let guard = 0;
    while (live.phase !== 'handOver' && guard++ < 400) {
      for (let seat = 0; seat < 4; seat++) {
        const text = G.transcript(live, seat, ['a log line']);
        checkedStates++;

        /* Anything still in somebody else's hand must not appear. Card names are
         * the thing to search for, because that is what the transcript prints. */
        for (let other = 0; other < 4; other++) {
          if (other === seat) continue;
          for (const card of live.players[other].hand) {
            const name = C.name(card);
            /* Unless it is legitimately public: it was the upcard, which
             * everybody watched being turned over. */
            if (live.upcard && live.upcard.id === card.id) continue;
            if (text.indexOf(name) >= 0) {
              fails.push(`a mid-hand export for seat ${seat + 1} printed ${name}, ` +
                `which is in seat ${other + 1}'s hand (phase ${live.phase})`);
            }
          }
        }

        /* And the dealer's discard belongs to the dealer alone. */
        if (live.discard && seat !== live.dealer) {
          check(text.indexOf(C.name(live.discard)) < 0,
            `a mid-hand export for seat ${seat + 1} printed the dealer's hidden discard`);
        }

        /* What it MUST contain: this seat's own cards, or it is useless. */
        if (live.players[seat].hand.length && live.phase !== 'handOver') {
          const mine = C.name(live.players[seat].hand[0]);
          check(text.indexOf(mine) >= 0,
            `a mid-hand export for seat ${seat + 1} does not include their own ${mine}`);
        }
      }
      AI.act(live);
      live.events.length = 0;
    }
  }
  check(checkedStates > 2000, 'only ' + checkedStates + ' mid-hand exports were checked');
}

/* ============ 5. THE EXPORT SAYS ENOUGH TO BE USEFUL ============ */
{
  const text = G.transcript(st, 0, ['newest log line', 'older log line']);
  check(/^Euchre — game log/.test(text), 'the export has no header');
  check(/Partnerships:/.test(text), 'the export does not say who is partnered with whom');
  check(/Playing to 10/.test(text), 'the export does not record the rules the game was played under');
  check((text.match(/--- Hand /g) || []).length >= 300,
    'the export is missing hands: ' + (text.match(/--- Hand /g) || []).length);
  check(/Trump: /.test(text), 'the export does not record what trump was');
  check(/Kitty /.test(text), 'the export does not record the kitty');
  check(/newest log line/.test(text), 'the on-screen log was not carried into the export');
  check(/Games won:/.test(text), 'the export does not record the match score');

  /* One completed hand, in full, so somebody reading it could replay it. */
  const first = text.split('--- Hand ')[1] || '';
  check(/Trick 1: /.test(first), 'a completed hand does not list its tricks');
  check(/Dealer: /.test(first), 'a completed hand does not say who dealt');
}

console.log('transcript: ' + checks.toLocaleString() + ' assertions over ' +
  handsPlayed + ' hands (' + played.length + ' contested)');

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
  process.exit(1);
}
console.log('transcript: OK');
