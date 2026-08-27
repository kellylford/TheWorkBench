/* Headless harness: plays full hands with every seat driven by the computer and
 * checks the invariants that must hold whatever the cards are.
 *
 * These are self-consistency checks, and that is a weaker property than it
 * sounds — tests/rules-oracle.js exists because of it. What this file adds is
 * VOLUME and VARIETY: every rule combination, thousands of hands, and a check
 * that the game never stops making progress. A rules bug that only appears when
 * somebody goes alone into a stick-the-dealer hand is found here or nowhere.
 *
 *   node tests/engine-invariants.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 20260820;
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
function check(cond, msg) { checks++; if (!cond) fails.push(msg); }

function fingerprint(st) {
  return st.phase + ':' + st.turn + ':' + st.trickLog.length + ':' +
    st.players.map(p => p.hand.length).join(',') + ':' + st.bidLog.length;
}

function playOne(st) {
  let guard = 0;
  while (st.phase !== 'handOver') {
    if (++guard > 400) { fails.push('stuck at ' + fingerprint(st)); return false; }
    const before = fingerprint(st);

    /* Before every play, check the computer's choice against the rules the
     * engine itself will apply. A bot that picks an illegal card gets its move
     * refused by the gate and AI.act throws, which would show up as a crash
     * rather than as this assertion — but the assertion names the card. */
    if (st.phase === 'play') {
      const p = st.turn;
      check(p !== st.sittingOut, 'the turn rested on a seat that is sitting out');
      const legal = G.legalPlays(st, p);
      check(legal.length > 0, 'a seat on turn had no legal play');
      const pick = AI.chooseCard(st, p);
      check(legal.some(c => c.id === pick), 'the computer chose an illegal card: ' + pick);
      if (st.trick.length) {
        const led = C.effSuit(st.trick[0].card, st.trump);
        const canFollow = st.players[p].hand.some(c => C.effSuit(c, st.trump) === led);
        if (canFollow) {
          check(C.effSuit(C.get(pick), st.trump) === led,
            'the computer failed to follow ' + led + ' holding a card of it');
        }
      }
    }

    if (st.phase === 'discard') {
      check(st.players[st.dealer].hand.length === 6,
        'the discard phase began with the dealer holding ' +
        st.players[st.dealer].hand.length + ' cards');
    }

    AI.act(st);
    st.events.length = 0;                       // otherwise it grows for the whole run
    check(before !== fingerprint(st), 'no progress at ' + before);
  }
  return true;
}

function checkHandEnd(st) {
  const h = st.history[st.history.length - 1];
  check(h.problems.length === 0, 'the audit failed: ' + h.problems.join('; '));

  if (h.result.thrownIn) {
    check(st.trickLog.length === 0, 'a thrown-in hand played tricks');
    check(st.trump === null, 'a thrown-in hand has a trump suit');
    return;
  }

  const expectPerTrick = st.sittingOut >= 0 ? 3 : 4;
  check(st.trickLog.length === 5, 'trick count ' + st.trickLog.length + ' instead of 5');
  check(st.players.every((p, i) => i === st.sittingOut || p.hand.length === 0),
    'cards left in a hand at the end');
  check(st.played.length === 5 * expectPerTrick,
    'played count ' + st.played.length + ' instead of ' + 5 * expectPerTrick);
  check(new Set(st.played.map(c => c.id)).size === st.played.length, 'a card was played twice');

  const tricks = st.players.reduce((a, p) => a + p.tricksWon, 0);
  check(tricks === 5, 'tricks taken total ' + tricks + ' instead of 5');

  /* Exactly one side scores, and by 1, 2 or 4. Euchre is not zero-sum — the
   * sheephead invariant does not transfer — so this is the equivalent. */
  const d = st.result.deltas;
  check((d[0] === 0) !== (d[1] === 0),
    'both sides scored, or neither did: ' + d.join('/'));
  check([1, 2, 4].indexOf(d[0] + d[1]) >= 0, 'a hand was worth ' + (d[0] + d[1]) + ' points');
  if (d[0] + d[1] === 4) check(st.alone, 'four points were awarded without anybody going alone');

  check(st.maker >= 0, 'a played hand has no maker');
  check(st.trump !== null, 'a played hand has no trump suit');
  if (st.alone) {
    check(st.sittingOut === G.partnerOf(st.maker), 'the wrong seat sat out');
    check(st.players[st.sittingOut].tricksWon === 0, 'a seat sitting out took a trick');
  } else {
    check(st.sittingOut === -1, 'a seat sat out without anybody going alone');
  }

  /* The dealer holds five cards after discarding, whoever ordered it up. */
  if (!h.turnedDown) {
    check(h.discard !== null, 'the upcard was taken but nothing was put back');
  } else {
    check(h.discard === null, 'a card was put back on a hand where the upcard was turned down');
  }
}

const stats = {};
let handsPlayed = 0;

for (const stickTheDealer of [false, true]) {
  for (const allowAlone of [true, false]) {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const key = `${difficulty}/${stickTheDealer ? 'stick' : 'throw'}/${allowAlone ? 'alone' : 'noalone'}`;
      stats[key] = { hands: 0, games: 0, thrown: 0, alone: 0 };
      const st = G.createGame({
        numPlayers: 4, names: ['N', 'E', 'S', 'W'],
        pointsToWin: 10, stickTheDealer, allowAlone, difficulty
      });
      G.applyAction(st, 0, { type: 'start' });

      for (let i = 0; i < 300; i++) {
        if (!playOne(st)) break;
        checkHandEnd(st);
        handsPlayed++;
        stats[key].hands++;
        if (st.result.thrownIn) stats[key].thrown++;
        if (st.alone) stats[key].alone++;
        if (st.gameOver) {
          stats[key].games++;
          const target = 10;
          check(Math.max(st.scores[0], st.scores[1]) >= target,
            'the game ended below the target: ' + st.scores.join('-'));
          check(st.gameWinner >= 0, 'a finished game has no winner');
        }
        if (stickTheDealer) check(!st.result.thrownIn, 'a hand was thrown in with stick the dealer on');
        if (!allowAlone) check(!st.alone, 'somebody went alone with going alone turned off');
        G.applyAction(st, 0, { type: 'nextHand' });
      }

      /* A new game must genuinely start from nothing. */
      check(st.scores[0] <= 10 && st.scores[1] <= 10 + 4,
        'scores ran past the target without a new game starting: ' + st.scores.join('-'));
    }
  }
}

console.log('engine invariants: ' + handsPlayed.toLocaleString() + ' hands, ' +
  checks.toLocaleString() + ' assertions');
for (const [k, v] of Object.entries(stats)) {
  console.log('  ' + k.padEnd(26) + ' ' + v.hands + ' hands, ' + v.games + ' games, ' +
    v.thrown + ' thrown in, ' + v.alone + ' alone');
}

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  process.exit(1);
}
console.log('engine invariants: OK');
