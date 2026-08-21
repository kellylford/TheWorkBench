/* Whole games, driven by the computer on both seats, checking the things that
 * must hold whatever the cards are.
 *
 * These are self-consistency checks — tests/rules-oracle.js exists because that
 * is a weaker property than it sounds. What this file adds is VOLUME and the
 * state machine: cribbage has more phases than the other games here, and the
 * transitions between them are where a hand gets stuck, a card gets played
 * twice, or somebody wins a game they should not have.
 *
 * THE ONE THAT MATTERS MOST IS THE LAST ONE: the game ends the moment somebody
 * reaches the target, not at the end of the hand. A non-dealer who pegs out
 * during the play wins before the dealer ever counts, and getting that wrong
 * hands games to the wrong player in exactly the situations most worth winning.
 *
 *   node tests/engine-invariants.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 20260821;
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

/* Everything that could legitimately change on one action.
 *
 * The cut cards are in here because a TIE at the cut for deal changes nothing
 * else: the phase stays, the scores stay, nobody has any cards. Without them a
 * perfectly correct re-cut looks like the game having seized up, which is what
 * the first version of this file reported. */
function fingerprint(st) {
  return [st.phase, st.turn, st.count, st.countStage, st.pile.length,
    st.players[0].hand.length, st.players[1].hand.length,
    st.players[0].score, st.players[1].score,
    st.handNumber,
    st.cutForDeal ? st.cutForDeal.cuts.join('') : '-',
    st.discarded.map(d => (d ? 1 : 0)).join('')].join(':');
}

const PHASES = ['idle', 'cutForDeal', 'discard', 'play', 'count', 'roundOver', 'gameOver'];

const stats = {};
let handsPlayed = 0, gamesPlayed = 0;
const seen = { heels: 0, go: 0, lastCard: 0, thirtyOne: 0, pegOut: 0, skunk: 0, tie: 0 };

for (const difficulty of ['easy', 'normal', 'hard']) {
  for (const targetScore of [121, 61]) {
    const key = `${difficulty}/to${targetScore}`;
    stats[key] = { games: 0, hands: 0 };

    for (let g = 0; g < 40; g++) {
      const st = G.createGame({ names: ['North', 'South'], targetScore, difficulty });
      G.applyAction(st, 0, { type: 'start' });

      let guard = 0;
      let handsThisGame = 0;
      while (!st.gameOver) {
        if (++guard > 6000) { fails.push('a game got stuck at ' + fingerprint(st)); break; }
        const before = fingerprint(st);
        const phaseBefore = st.phase;

        check(PHASES.indexOf(st.phase) >= 0, 'unknown phase ' + st.phase);
        check(st.count >= 0 && st.count <= 31, 'the count is ' + st.count);

        /* Whoever the engine says is on move must actually have something legal
         * to do, or the table is stuck and nothing will say so. */
        const onMove = G.seatToAct(st);
        if (st.phase === 'play') {
          check(onMove === st.turn, 'seatToAct disagrees with turn during the play');
          const legal = G.legalPlays(st, onMove);
          const canGo = !G.canPlay(st, onMove);
          check(legal.length > 0 || canGo,
            'the seat on move can neither play nor say go');
          /* Go is refused from somebody who can play. If you can play, you must. */
          if (legal.length) {
            const r = G.applyAction(st, onMove, { type: 'go' });
            check(r.ok === false, 'go was allowed while a playable card was held');
          }
        }
        if (st.phase === 'discard') {
          check(onMove >= 0 && !st.discarded[onMove],
            'the discard phase named a seat that has already thrown');
        }

        if (st.phase === 'roundOver') {
          handsPlayed++; handsThisGame++; stats[key].hands++;
          checkHandEnd(st);
          G.applyAction(st, 0, { type: 'nextHand' });
          continue;
        }

        AI.act(st);
        /* Counted BEFORE the log is cleared. The first version scanned
         * st.events after the game had finished, by which point every event had
         * been thrown away on the line below — so two of the scoring cases
         * reported zero occurrences and the coverage check passed them because
         * they were not in the required list. A coverage counter that always
         * reads zero is worse than no counter. */
        for (const e of st.events) {
          if (/for the go/.test(e.text)) seen.go++;
          if (/for the last card/.test(e.text)) seen.lastCard++;
        }
        st.events.length = 0;
        check(before !== fingerprint(st) || phaseBefore !== st.phase,
          'no progress at ' + before);
      }

      /* The game ended, and ended properly. */
      if (st.gameOver) {
        gamesPlayed++; stats[key].games++;
        const w = st.gameWinner;
        check(w === 0 || w === 1, 'a finished game has no winner');
        check(st.players[w].score >= targetScore,
          'the winner is below the target: ' + st.players.map(p => p.score).join('-'));
        check(st.players[1 - w].score < targetScore,
          'both players passed the target — the game did not stop when it should');
        /* The moment it ended is the moment they crossed. Nothing may be scored
         * afterwards, so the loser's score is whatever it was. */
        check(st.phase === 'gameOver', 'the game is over but the phase is ' + st.phase);
        if (st.result && st.result.skunk) seen.skunk++;
        const last = st.history[st.history.length - 1];
        check(last && last.problems.length === 0,
          'the final hand failed its audit: ' + (last ? last.problems.join('; ') : 'no record'));
        handsPlayed++; stats[key].hands++;
      }

      for (const h of st.history) {
        if (h.starter && h.starter[0] === 'J') seen.heels++;
        let running = 0;
        for (const e of h.pile) {
          const v = C.value(C.get(e.card));
          if (running + v > 31) running = 0;
          running += v;
          if (running === 31) seen.thirtyOne++;
        }
        /* A hand that ended before the crib was counted is one somebody pegged
         * out on, which is legal and worth counting separately. */
        if (h.counts.length < 3) seen.pegOut++;
      }
    }
  }
}

function checkHandEnd(st) {
  const h = st.history[st.history.length - 1];
  check(!!h, 'a hand ended with nothing recorded');
  if (!h) return;
  check(h.problems.length === 0, 'the audit failed: ' + h.problems.join('; '));

  /* Every card accounted for. Six each, two each to the crib, four each kept,
   * four played each unless somebody pegged out. */
  check(h.dealt.hands[0].length === 6 && h.dealt.hands[1].length === 6,
    'somebody was not dealt six cards');
  check(h.crib.length === 4, 'the crib holds ' + h.crib.length);
  const everything = h.dealt.hands[0].concat(h.dealt.hands[1], [h.starter]);
  check(new Set(everything).size === everything.length, 'a card was dealt twice');

  /* The three counts happen in order: non-dealer, dealer, crib. `dealer` has
   * already rotated by the time the hand is recorded, so the non-dealer of the
   * hand just played is the seat that is about to deal. */
  const nonDealer = h.dealer;
  if (h.counts.length >= 1) check(h.counts[0].who === nonDealer && h.counts[0].kind === 'hand',
    'the non-dealer did not count first');
  if (h.counts.length >= 2) check(h.counts[1].who === 1 - nonDealer && h.counts[1].kind === 'hand',
    'the dealer did not count second');
  if (h.counts.length >= 3) check(h.counts[2].kind === 'crib' && h.counts[2].who === 1 - nonDealer,
    'the crib went to the wrong player');

  /* No card played twice, and only cards that seat kept. */
  const played = h.pile.map(e => e.card);
  check(new Set(played).size === played.length, 'a card was played twice');
  for (const e of h.pile) {
    check(h.kept[e.player].indexOf(e.card) >= 0,
      'seat ' + (e.player + 1) + ' played a card they did not keep');
  }
  /* Scores only go up. */
  check(h.scores[0] >= 0 && h.scores[1] >= 0, 'a negative score');
}

/* Every one of these must actually have come up, or the run proved less than it
 * looks. `tie` is at the cut for deal and is rare on purpose — about one deal in
 * seventeen — so it gets a low bar rather than none. */
{
  /* A fresh game per cut, rather than forcing one game's phase back round the
   * loop: reusing a state means every cut after the first happens with a dealer
   * already set and a hand already dealt, which is not the situation being
   * measured. */
  let ties = 0;
  for (let i = 0; i < 4000; i++) {
    const st = G.createGame({ names: ['a', 'b'], targetScore: 121, difficulty: 'hard' });
    G.applyAction(st, 0, { type: 'start' });
    G.applyAction(st, 0, { type: 'cut' });
    if (st.cutForDeal && st.cutForDeal.tie) ties++;
  }
  seen.tie = ties;
  const rate = ties / 4000;
  /* Three in fifty-one. The stable game compared by counting value, which made a
   * ten, jack, queen and king all equal and pushed this to about 13%. */
  check(rate > 0.03 && rate < 0.09,
    'the cut-for-deal tie rate is ' + (rate * 100).toFixed(1) + '%, expected about 5.9% — ' +
    'if it is near 13% the cut is comparing counting value instead of run order');
}

for (const [name, min] of [['heels', 20], ['thirtyOne', 100], ['pegOut', 5],
  ['go', 100], ['lastCard', 100]]) {
  check(seen[name] >= min,
    `only ${seen[name]} hands reached the "${name}" case (wanted at least ${min})`);
}

console.log('engine invariants: ' + handsPlayed.toLocaleString() + ' hands across ' +
  gamesPlayed + ' games, ' + checks.toLocaleString() + ' assertions');
for (const [k, v] of Object.entries(stats)) {
  console.log('  ' + k.padEnd(18) + ' ' + v.games + ' games, ' + v.hands + ' hands');
}
console.log('  cases: ' + Object.entries(seen).map(([k, v]) => k + ' ' + v).join(', '));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  process.exit(1);
}
console.log('engine invariants: OK');
