/* Cribbage balance simulator — headless, many games, win rates and score spreads.
 *
 * This file used to carry its own copy of Card, Deck, Player and CribbageGame:
 * 566 lines of duplicated engine sitting beside the real one and slowly drifting
 * from it. It had gone stale in exactly the way that predicts — it still scored a
 * double run as a single run months after that was the biggest scoring bug in the
 * game — so every number it printed was about a game nobody plays.
 *
 * It now drives the real engine out of game.js. A simulator that does not run the
 * shipped code is not evidence about the shipped code.
 *
 *   node simulate.js [games]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;

/* game.js is a browser script: engine classes first, then a GameUI that touches
 * the DOM the moment it is constructed. Take the engine and leave the rest. */
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

/* The real game resets the count and the pile in the UI's Continue handler
 * rather than in the engine, so anything headless has to do it too. Kept here,
 * named, rather than scattered through the loop — and it is worth noting as the
 * one place this simulator has to know something about the interface. */
function resumeAfterPause(game) {
  game.currentCount = 0;
  game.playedPile = [];
  if (game.checkPlayComplete()) game.endPlay();
  else game.state = 'PLAY';
}

class GameSimulator {
  constructor(numGames = 1000) {
    this.numGames = numGames;
    this.results = [];
  }

  runSimulation() {
    for (let gameNum = 0; gameNum < this.numGames; gameNum++) {
      const game = new CribbageGame();
      game.player.score = 0;
      game.computer.score = 0;
      // Alternate who gets the first crib, so the dealer advantage does not all
      // fall on one seat across the run.
      game.dealer = gameNum % 2 === 0 ? game.computer : game.player;
      const firstDealer = game.dealer;

      let rounds = 0;
      while (game.state !== 'GAME_OVER' && rounds < 60) {
        rounds++;
        game.startRound();
        this.discard(game);
        if (game.state === 'GAME_OVER') break;      // his heels can end it
        this.playPhase(game);
        if (game.state === 'GAME_OVER') break;
        game.countHands();
      }

      this.results.push({
        gameNumber: gameNum + 1,
        playerScore: game.player.score,
        computerScore: game.computer.score,
        winner: game.lastWinner ? game.lastWinner.name : 'none',
        dealer: firstDealer.name,
        rounds
      });
    }
  }

  /* The human seat discards its two lowest cards — a deliberately plain baseline,
   * so the number being measured is the computer's play against an ordinary
   * opponent rather than against itself. */
  discard(game) {
    const byValue = game.player.hand
      .map((c, i) => ({ i, v: c.value }))
      .sort((a, b) => a.v - b.v)
      .slice(0, 2)
      .map(x => x.i);
    game.discardToCrib(byValue);
  }

  playPhase(game) {
    let guard = 0;
    while (!game.checkPlayComplete() && game.state !== 'GAME_OVER' && ++guard < 200) {
      if (game.state === 'PAUSE_GO' || game.state === 'PAUSE_31') {
        resumeAfterPause(game);
        continue;
      }
      if (game.state !== 'PLAY') break;

      const who = game.currentTurn;
      const playable = who.hand.filter(c =>
        !who.playedCards.includes(c) && game.currentCount + c.value <= 31);

      if (!playable.length) { game.sayGo(); continue; }
      const card = who === game.computer
        ? game.selectBestPlayCard(playable)
        // The human seat plays its highest legal card: again, plain on purpose.
        : playable.reduce((a, b) => (b.value > a.value ? b : a));
      game.playCard(who, card);
    }
    if (game.state === 'PAUSE_GO' || game.state === 'PAUSE_31') resumeAfterPause(game);
  }

  getSummary() {
    const n = this.results.length;
    const playerWins = this.results.filter(r => r.winner === 'Player').length;
    const computerWins = this.results.filter(r => r.winner === 'Computer').length;
    const avg = k => (this.results.reduce((t, r) => t + r[k], 0) / n).toFixed(1);
    const unfinished = this.results.filter(r => r.winner === 'none').length;
    return {
      totalGames: n,
      playerWins,
      computerWins,
      unfinished,
      winRate: ((playerWins / n) * 100).toFixed(1) + '%',
      avgPlayerScore: avg('playerScore'),
      avgComputerScore: avg('computerScore'),
      avgRounds: avg('rounds'),
      results: this.results
    };
  }
}

const games = parseInt(process.argv[2], 10) || 1000;
const simulator = new GameSimulator(games);
simulator.runSimulation();
const s = simulator.getSummary();

console.log('Cribbage simulation — ' + s.totalGames + ' full games to 121\n');
console.log('  Player wins    : ' + s.playerWins + '  (' + s.winRate + ')');
console.log('  Computer wins  : ' + s.computerWins);
if (s.unfinished) console.log('  UNFINISHED     : ' + s.unfinished + '  <- games that hit the round guard');
console.log('  Average score  : player ' + s.avgPlayerScore + ', computer ' + s.avgComputerScore);
console.log('  Average rounds : ' + s.avgRounds);
console.log('\nThe human seat here is a deliberately plain baseline — discards its two');
console.log('lowest cards, always plays its highest legal one. A win rate near even means');
console.log('the computer is not beating a naive opponent, which is worth knowing either way.');

if (process.argv.includes('--write')) {
  let out = '# Cribbage simulation results\n\n';
  out += '- Games: ' + s.totalGames + ' (played in full to 121)\n';
  out += '- Player wins: ' + s.playerWins + ' (' + s.winRate + ')\n';
  out += '- Computer wins: ' + s.computerWins + '\n';
  out += '- Average score: player ' + s.avgPlayerScore + ', computer ' + s.avgComputerScore + '\n';
  out += '- Average rounds per game: ' + s.avgRounds + '\n';
  fs.writeFileSync(path.join(root, 'SIMULATION_RESULTS.md'), out);
  console.log('\nWritten to SIMULATION_RESULTS.md');
}
