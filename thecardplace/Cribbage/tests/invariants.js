/* Invariants: play thousands of complete games and check the things that must
 * be true of every one of them.
 *
 * Sheephead has had this since the beginning and Cribbage never did. It is the
 * layer that catches a game which is individually correct everywhere and yet
 * goes wrong over time — a score that moves backwards, a round that never ends,
 * a card that is in two places at once, points awarded after somebody has
 * already won.
 *
 * Worth being clear about what this layer can and cannot see: these are
 * conservation laws. They would all hold perfectly while the game scored a
 * double run as a single run, which is what the rules oracle is for. Neither
 * suite substitutes for the other.
 *
 *   node tests/invariants.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const cutAt = src.indexOf('class GameUI');
if (cutAt < 0) {
  console.error('Could not find `class GameUI` — game.js has been restructured, fix this slice.');
  process.exit(2);
}
const sandbox = { console, Math, Date, JSON, setTimeout };
vm.createContext(sandbox);
vm.runInContext(src.slice(0, cutAt) +
  '\nthis.__engine = { Card, Deck, Player, CribbageGame };', sandbox, { filename: 'game.js' });
const { CribbageGame } = sandbox.__engine;

const fails = [];
const seen = new Set();
/* One line per distinct problem. A broken invariant tends to break in every
 * game, and five thousand copies of the same sentence hides the second one. */
function check(cond, msg) {
  if (cond) return;
  if (seen.has(msg)) return;
  seen.add(msg);
  fails.push(msg);
}

const id = c => c.rank + c.suit;

/* The reset after a 31 or a go lives in the UI, so anything headless has to do
 * it too. Named rather than inlined, because it is the one thing here that has
 * to know something about the interface. */
function resumeAfterPause(game) {
  game.currentCount = 0;
  game.playedPile = [];
  if (game.checkPlayComplete()) game.endPlay();
  else game.state = 'PLAY';
}

const GAMES = 1200;
let rounds = 0, unfinished = 0, longestGame = 0, maxCount = 0;

for (let n = 0; n < GAMES; n++) {
  const g = new CribbageGame();
  g.player.score = 0;
  g.computer.score = 0;
  g.dealer = n % 2 === 0 ? g.computer : g.player;

  let prevPlayer = 0, prevComputer = 0;
  let roundCount = 0;
  const dealers = [];

  while (g.state !== 'GAME_OVER' && roundCount < 80) {
    roundCount++;
    rounds++;
    const dealerBefore = g.dealer;
    dealers.push(dealerBefore === g.player ? 'P' : 'C');

    g.startRound();

    /* --- the deal --- */
    check(g.player.hand.length === 6, 'a player was dealt ' + g.player.hand.length + ' cards, not 6');
    check(g.computer.hand.length === 6, 'the computer was dealt ' + g.computer.hand.length + ' cards, not 6');
    check(g.crib.length === 0, 'the crib was not empty at the deal');
    {
      const all = [...g.player.hand, ...g.computer.hand].map(id);
      check(new Set(all).size === all.length, 'the same card was dealt to both players');
    }

    /* --- the discard --- */
    g.discardToCrib([0, 1]);
    if (g.state === 'GAME_OVER') break;         // his heels can win it
    check(g.crib.length === 4, 'the crib holds ' + g.crib.length + ' cards, not 4');
    check(g.player.hand.length === 4 && g.computer.hand.length === 4,
      'a hand is not 4 cards after discarding');
    check(!!g.cutCard, 'no cut card after the discard');
    {
      // Nothing may be in two places at once.
      const everywhere = [...g.player.hand, ...g.computer.hand, ...g.crib, g.cutCard].map(id);
      check(new Set(everywhere).size === everywhere.length,
        'a card is in two places at once after the cut');
    }

    /* --- the play --- */
    let guard = 0;
    const playedThisRound = [];
    while (!g.checkPlayComplete() && g.state !== 'GAME_OVER' && ++guard < 300) {
      if (g.state === 'PAUSE_GO' || g.state === 'PAUSE_31') { resumeAfterPause(g); continue; }
      if (g.state !== 'PLAY') break;

      const who = g.currentTurn;
      check(!!who, 'nobody has the turn during the play');
      if (!who) break;
      const playable = who.hand.filter(c =>
        !who.playedCards.includes(c) && g.currentCount + c.value <= 31);

      /* Offer the engine things it must refuse.
       *
       * The loop below only ever hands it legal cards, so on its own it tests
       * this driver's filter rather than the game's rules — deleting the engine's
       * own over-31 guard changed nothing and the suite stayed green. A test that
       * only exercises the happy path is not testing the guard at all. */
      {
        const bust = who.hand.find(c =>
          !who.playedCards.includes(c) && g.currentCount + c.value > 31);
        if (bust) {
          const count = g.currentCount, pile = g.playedPile.length;
          check(g.playCard(who, bust) === false,
            'the engine accepted a card that would take the count past 31');
          check(g.currentCount === count && g.playedPile.length === pile,
            'a refused over-31 card still changed the count or the pile');
        }
        const spent = who.playedCards[0];
        if (spent) {
          const count = g.currentCount, pile = g.playedPile.length;
          check(g.playCard(who, spent) === false, 'the engine let a card be played twice');
          check(g.currentCount === count && g.playedPile.length === pile,
            'a refused repeat card still changed the count or the pile');
        }
        const other = who === g.player ? g.computer : g.player;
        const theirs = other.hand.find(c => !other.playedCards.includes(c));
        if (theirs) {
          const pile = g.playedPile.length;
          check(g.playCard(other, theirs) === false, 'the engine let a player move out of turn');
          check(g.playedPile.length === pile, 'a refused out-of-turn play still reached the pile');
        }
      }

      if (!playable.length) { g.sayGo(); continue; }

      const before = g.playedPile.length;
      const card = who === g.computer
        ? g.selectBestPlayCard(playable)
        : playable[0];
      g.playCard(who, card);

      if (g.playedPile.length > before) playedThisRound.push(id(card));
      check(g.currentCount <= 31, 'the count reached ' + g.currentCount + ', which is over 31');
      if (g.currentCount > maxCount) maxCount = g.currentCount;
    }
    check(guard < 300, 'the play phase did not finish within 300 turns');

    check(new Set(playedThisRound).size === playedThisRound.length,
      'the same card was played twice in one round');
    if (g.state !== 'GAME_OVER') {
      check(g.player.playedCards.length === 4,
        'the player finished the play having played ' + g.player.playedCards.length + ' cards, not 4');
      check(g.computer.playedCards.length === 4,
        'the computer finished the play having played ' + g.computer.playedCards.length + ' cards, not 4');
    }

    if (g.state === 'GAME_OVER') break;

    /* --- the count --- */
    const dealerAtCount = g.dealer;
    g.countHands();

    // Scores only ever go up. A peg does not move backwards.
    check(g.player.score >= prevPlayer, 'the player\'s score went down');
    check(g.computer.score >= prevComputer, 'the computer\'s score went down');
    prevPlayer = g.player.score;
    prevComputer = g.computer.score;

    // Whoever did not deal counts first, so the dealer cannot win a race the
    // non-dealer should have won. If both cross 121 in the same count, the
    // non-dealer must be the one to take it.
    if (g.state === 'GAME_OVER' && g.lastWinner) {
      const nonDealer = dealerAtCount === g.player ? g.computer : g.player;
      const both = g.player.score >= 121 && g.computer.score >= 121;
      check(!both || g.lastWinner === nonDealer,
        'both players passed 121 in one count and the dealer took it; the non-dealer counts first');
    }

    if (g.state !== 'GAME_OVER') {
      check(g.dealer !== dealerAtCount, 'the deal did not pass to the other player after a round');
    }
  }

  if (roundCount >= 80) unfinished++;
  if (roundCount > longestGame) longestGame = roundCount;

  /* --- the finished game --- */
  check(g.state === 'GAME_OVER', 'a game ended in state ' + g.state + ' rather than GAME_OVER');
  if (g.state === 'GAME_OVER') {
    check(!!g.lastWinner, 'a game finished with no winner recorded');
    if (g.lastWinner) {
      const loser = g.lastWinner === g.player ? g.computer : g.player;
      check(g.lastWinner.score >= 121,
        'the winner finished on ' + g.lastWinner.score + ', which is short of 121');
      check(loser.score < 121,
        'the loser finished on ' + loser.score + ', which is 121 or more');
    }
  }

  // The deal alternates all the way through.
  for (let i = 1; i < dealers.length; i++) {
    check(dealers[i] !== dealers[i - 1],
      'the same player dealt twice in a row: ' + dealers.join(''));
  }
}

check(unfinished === 0, unfinished + ' games did not finish within 80 rounds');

console.log(GAMES.toLocaleString() + ' complete games, ' + rounds.toLocaleString() + ' rounds');
console.log('  longest game: ' + longestGame + ' rounds; highest count reached in play: ' + maxCount);

if (fails.length) {
  console.log('\nFAILURES (' + fails.length + '):');
  fails.slice(0, 15).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nEvery invariant held.');
