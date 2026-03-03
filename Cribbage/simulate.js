// Cribbage Game Simulator - Headless version for running multiple games

class Card {
    constructor(rank, suit) {
        this.rank = rank;
        this.suit = suit;
    }

    get value() {
        const rankValue = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(this.rank) + 1;
        return rankValue >= 10 ? 10 : rankValue;
    }

    get rankValue() {
        return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(this.rank) + 1;
    }

    get name() {
        const rankNames = {
            'A': 'Ace', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
            '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten',
            'J': 'Jack', 'Q': 'Queen', 'K': 'King'
        };
        const suitNames = {'♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs', '♠': 'Spades'};
        return `${rankNames[this.rank]} of ${suitNames[this.suit]}`;
    }

    toString() {
        return this.name;
    }
}

class Deck {
    constructor() {
        this.cards = [];
        const suits = ['♥', '♦', '♣', '♠'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        
        for (const suit of suits) {
            for (const rank of ranks) {
                this.cards.push(new Card(rank, suit));
            }
        }
        this.shuffle();
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal() {
        return this.cards.pop();
    }
}

class Player {
    constructor(name, isComputer = false) {
        this.name = name;
        this.hand = [];
        this.playedCards = [];
        this.score = 0;
        this.isComputer = isComputer;
    }

    addCard(card) {
        this.hand.push(card);
    }

    removeCard(card) {
        const index = this.hand.indexOf(card);
        if (index > -1) {
            return this.hand.splice(index, 1)[0];
        }
        return null;
    }

    playCard(card) {
        const removed = this.removeCard(card);
        if (removed) {
            this.playedCards.push(removed);
        }
        return removed;
    }

    clearPlayedCards() {
        this.playedCards = [];
    }

    resetHand() {
        this.hand = [];
        this.playedCards = [];
    }

    sortHand() {
        this.hand.sort((a, b) => a.rankValue - b.rankValue);
    }
}

class CribbageGame {
    constructor(isSimulation = false) {
        this.player = new Player('Player', false);
        this.computer = new Player('Computer', true);
        this.dealer = null;
        this.deck = null;
        this.crib = [];
        this.cutCard = null;
        this.state = 'CUT_FOR_DEAL';
        this.messages = [];
        this.currentTurn = null;
        this.currentCount = 0;
        this.playedPile = [];
        this.selectedForDiscard = new Set();
        this.lastWinner = null;
        this.isSimulation = isSimulation;
    }

    addMessage(message) {
        if (!this.isSimulation) {
            this.messages.push(message);
        }
    }

    startGame(dealerPlayer) {
        this.dealer = dealerPlayer;
        this.dealCards();
    }

    dealCards() {
        this.deck = new Deck();
        this.player.resetHand();
        this.computer.resetHand();
        
        for (let i = 0; i < 6; i++) {
            this.player.addCard(this.deck.deal());
            this.computer.addCard(this.deck.deal());
        }
        
        this.crib = [];
        this.selectedForDiscard.clear();
        this.state = 'DISCARD';
        this.addMessage('Deal complete. Select 2 cards to discard to the crib.');
        this.addMessage(this.dealer === this.player ? "Player's crib." : "Computer's crib.");
    }

    discardToCrib(playerIndices) {
        if (this.state !== 'DISCARD') return;

        // Player discards
        const playerDiscards = playerIndices.map(i => this.player.hand[i]).filter(c => c);
        playerDiscards.sort((a, b) => this.player.hand.indexOf(b) - this.player.hand.indexOf(a));
        
        for (const card of playerDiscards) {
            const removed = this.player.removeCard(card);
            if (removed) this.crib.push(removed);
        }

        // Computer discards using strategic evaluation
        const cardsToDiscard = this.selectComputerDiscard();
        for (const card of cardsToDiscard) {
            const removed = this.computer.removeCard(card);
            if (removed) this.crib.push(removed);
        }

        // Cut card
        this.cutCard = this.deck.deal();
        this.addMessage(`Cut card: ${this.cutCard}`);

        // Check for his heels (Jack cut)
        if (this.cutCard.rank === 'J') {
            this.dealer.score += 2;
            this.addMessage(`${this.dealer.name} scores 2 for his heels!`);
            if (this.checkForWinner()) {
                return;
            }
        }

        // Start play phase
        this.state = 'PLAY';
        this.currentTurn = this.dealer === this.player ? this.computer : this.player;
        this.addMessage(`${this.currentTurn.name} plays first.`);
    }

    playCard(player, card) {
        if (this.state !== 'PLAY') return false;
        if (this.currentTurn !== player) return false;

        const removed = player.playCard(card);
        if (!removed) return false;

        this.currentCount += card.value;
        this.playedPile.push({card, player});
        
        this.addMessage(`${player.name} plays ${card.rank}${card.suit}. Count: ${this.currentCount}`);

        if (this.currentCount === 31) {
            player.score += 2;
            this.addMessage(`${player.name} scores 2 for 31!`);
            if (this.checkForWinner()) return true;
            this.resetCount();
            this.switchTurn();
            return true;
        }

        if (this.currentCount === 15) {
            player.score += 2;
            this.addMessage(`${player.name} scores 2 for 15!`);
        }

        this.switchTurn();
        return true;
    }

    resetCount() {
        this.currentCount = 0;
        this.playedPile = [];
    }

    canPlay(player) {
        return player.hand.some(card =>
            !player.playedCards.includes(card) &&
            this.currentCount + card.value <= 31
        );
    }

    sayGo() {
        const opponent = this.currentTurn === this.player ? this.computer : this.player;
        
        if (this.canPlay(opponent)) {
            this.currentTurn = opponent;
            this.addMessage(`${opponent.name}'s turn.`);
        } else if (this.canPlay(this.currentTurn)) {
            this.addMessage(`${opponent.name} says Go.`);
        } else {
            const lastPlayer = this.playedPile[this.playedPile.length - 1]?.player;
            if (lastPlayer && this.currentCount > 0 && this.currentCount !== 31) {
                lastPlayer.score += 1;
                this.addMessage(`${lastPlayer.name} scores 1 for go.`);
                if (this.checkForWinner()) {
                    return;
                }
            }
            
            this.state = 'PAUSE_GO';
            this.addMessage('Go scored. Use Continue to resume play.');
            
            if (lastPlayer) {
                this.currentTurn = lastPlayer === this.player ? this.computer : this.player;
            }
        }
    }

    switchTurn() {
        const opponent = this.currentTurn === this.player ? this.computer : this.player;
        
        if (this.canPlay(opponent)) {
            this.currentTurn = opponent;
        } else if (this.canPlay(this.currentTurn)) {
            this.addMessage(`${opponent.name} says Go.`);
        } else {
            const lastPlayer = this.playedPile[this.playedPile.length - 1]?.player;
            if (lastPlayer && this.currentCount > 0 && this.currentCount !== 31) {
                lastPlayer.score += 1;
                this.addMessage(`${lastPlayer.name} scores 1 for go.`);
                if (this.checkForWinner()) {
                    return;
                }
            }
            
            this.state = 'PAUSE_GO';
            this.addMessage('Go scored. Use Continue to resume play.');
            
            if (lastPlayer) {
                this.currentTurn = lastPlayer === this.player ? this.computer : this.player;
            }
        }
    }

    checkPlayComplete() {
        return this.player.playedCards.length === 4 && this.computer.playedCards.length === 4;
    }

    endPlay() {
        this.addMessage('Play phase complete. Use Continue to count hands.');
        this.state = 'PAUSE_BEFORE_COUNT';
    }

    countHands() {
        this.addMessage('Counting hands...');
        
        const nonDealer = this.dealer === this.player ? this.computer : this.player;
        
        const nonDealerScore = this.scoreHand(nonDealer.playedCards, this.cutCard, false);
        nonDealer.score += nonDealerScore;
        this.addMessage(`${nonDealer.name} scores ${nonDealerScore} from hand.`);
        
        if (this.checkForWinner()) {
            return;
        }
        
        const dealerScore = this.scoreHand(this.dealer.playedCards, this.cutCard, false);
        this.dealer.score += dealerScore;
        this.addMessage(`${this.dealer.name} scores ${dealerScore} from hand.`);
        
        if (this.checkForWinner()) {
            return;
        }
        
        const cribScore = this.scoreHand(this.crib, this.cutCard, true);
        this.dealer.score += cribScore;
        this.addMessage(`${this.dealer.name} scores ${cribScore} from crib.`);
        
        if (this.checkForWinner()) {
            return;
        }
        
        this.dealer = this.dealer === this.player ? this.computer : this.player;
        
        this.addMessage(`Current score: Player ${this.player.score}, Computer ${this.computer.score}`);
        
        this.state = 'ROUND_OVER';
    }

    checkForWinner() {
        if (this.player.score >= 121) {
            this.addMessage('Player wins!');
            this.lastWinner = this.player;
            this.state = 'GAME_OVER';
            return true;
        } else if (this.computer.score >= 121) {
            this.addMessage('Computer wins!');
            this.lastWinner = this.computer;
            this.state = 'GAME_OVER';
            return true;
        }
        return false;
    }

    scoreHand(hand, cutCard, isCrib) {
        const cards = [...hand];
        if (cutCard) cards.push(cutCard);
        
        let score = 0;

        // 15s
        for (let i = 0; i < (1 << cards.length); i++) {
            const subset = [];
            for (let j = 0; j < cards.length; j++) {
                if (i & (1 << j)) subset.push(cards[j]);
            }
            if (subset.length >= 2 && subset.reduce((sum, c) => sum + c.value, 0) === 15) {
                score += 2;
            }
        }

        // Pairs
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                if (cards[i].rank === cards[j].rank) {
                    score += 2;
                }
            }
        }

        // Runs
        const runScore = this.findBestRun(cards);
        score += runScore;

        // Flush
        if (hand.every(c => c.suit === hand[0].suit)) {
            if (isCrib) {
                if (cutCard && cutCard.suit === hand[0].suit) {
                    score += 5;
                }
            } else {
                score += 4;
                if (cutCard && cutCard.suit === hand[0].suit) {
                    score += 1;
                }
            }
        }

        // Nobs (Jack of same suit as cut card)
        if (cutCard) {
            for (const card of hand) {
                if (card.rank === 'J' && card.suit === cutCard.suit) {
                    score += 1;
                }
            }
        }

        return score;
    }

    findBestRun(cards) {
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        let maxScore = 0;

        for (let len = 5; len >= 3; len--) {
            for (let i = 0; i < (1 << cards.length); i++) {
                const subset = [];
                for (let j = 0; j < cards.length; j++) {
                    if (i & (1 << j)) subset.push(cards[j]);
                }
                
                if (subset.length === len) {
                    const values = subset.map(c => ranks.indexOf(c.rank)).sort((a, b) => a - b);
                    let isRun = true;
                    for (let k = 1; k < values.length; k++) {
                        if (values[k] !== values[k - 1] + 1) {
                            isRun = false;
                            break;
                        }
                    }
                    if (isRun) {
                        maxScore = Math.max(maxScore, len);
                    }
                }
            }
            if (maxScore > 0) break;
        }

        return maxScore;
    }

    selectComputerDiscard() {
        const hand = this.computer.hand;
        let bestDiscard = [hand[0], hand[1]];
        let bestScore = Infinity;
        
        for (let i = 0; i < hand.length; i++) {
            for (let j = i + 1; j < hand.length; j++) {
                const discardPair = [hand[i], hand[j]];
                const remainingCards = hand.filter(c => !discardPair.includes(c));
                
                // Score the remaining hand (simple: fifteens and pairs)
                let handScore = 0;
                for (const card of remainingCards) {
                    for (const other of remainingCards) {
                        if (card !== other && card.value + other.value === 15) {
                            handScore += 2;
                        }
                    }
                }
                
                // Score the crib (fifteens and pairs)
                const cribScore = this.estimateCribScore(discardPair);
                
                // If computer owns the crib, weight it (it's an advantage)
                const totalScore = this.dealer === this.computer 
                    ? handScore + (cribScore * 1.5)
                    : handScore - (cribScore * 1.5);
                
                if (totalScore < bestScore) {
                    bestScore = totalScore;
                    bestDiscard = discardPair;
                }
            }
        }
        
        return bestDiscard;
    }

    estimateCribScore(cards) {
        // Estimate potential score in crib for given 2 cards
        let score = 0;
        
        // Check for fifteens
        if (cards[0].value + cards[1].value === 15) {
            score += 2;
        }
        
        // Check for pairs
        if (cards[0].rank === cards[1].rank) {
            score += 2;
        }
        
        return score;
    }

    selectBestPlayCard(playableCards) {
        // Enhanced strategy with lookahead thinking for the pegging phase
        const currentCount = this.currentCount;
        
        if (playableCards.length === 1) {
            return playableCards[0];
        }
        
        // Score each playable card with lookahead evaluation
        let bestCard = playableCards[0];
        let bestScore = -Infinity;
        
        for (const card of playableCards) {
            let score = 0;
            const newCount = currentCount + card.value;
            
            // 1. IMMEDIATE SCORING (make 15 or 31)
            if (newCount === 15) {
                score += 20; // Worth 2 points
            }
            if (newCount === 31) {
                score += 20; // Worth 2 points
            }
            
            // 2. LOOKAHEAD: What cards do we have left and can we still play?
            // This simulates "thinking ahead" - we want flexibility
            const remainingHand = this.computer.hand.filter(c => c !== card);
            const futurePlayable = remainingHand.filter(c => c.value + newCount <= 31).length;
            
            // Penalize plays that leave us with no follow-up (dead position)
            if (futurePlayable === 0 && newCount < 31) {
                score -= 10; // We'll be forced to say "Go"
            } else {
                score += futurePlayable * 2; // Reward flexibility
            }
            
            // 3. AVOID SETTING UP OPPONENT
            const opponentHand = this.player.hand.filter(c => !this.player.playedCards.includes(c));
            
            // Can opponent make 31?
            if (opponentHand.some(c => newCount + c.value === 31)) {
                score -= 15; // Very dangerous
            }
            
            // Can opponent make 15?
            if (opponentHand.some(c => newCount + c.value === 15)) {
                score -= 8; // Dangerous
            }
            
            // Does opponent have pair card?
            if (opponentHand.some(c => c.rank === card.rank)) {
                score -= 5; // Moderate danger
            }
            
            // 4. PRESERVE FLEXIBILITY FOR FUTURE COUNT RESETS
            // Don't burn high cards when count is still low
            const percentOfMax = newCount / 31;
            if (percentOfMax < 0.6 && card.value >= 10) {
                score -= 3; // Wasteful to use high cards early
            }
            
            // 5. SAFE PLAYS ARE PREFERRED WHEN NO SCORING
            // If this card doesn't score, prefer plays that don't set up opponent
            if (newCount !== 15 && newCount !== 31) {
                // Prefer lower cards that leave less room for danger
                score -= card.value / 10; // Small tiebreaker
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestCard = card;
            }
        }
        
        return bestCard;
    }
}

// Simulation engine
class GameSimulator {
    constructor(numGames = 100) {
        this.numGames = numGames;
        this.results = [];
    }

    runSimulation() {
        let currentDealer = null;

        for (let gameNum = 0; gameNum < this.numGames; gameNum++) {
            const game = new CribbageGame(true);
            
            // Alternate dealer, starting with computer
            currentDealer = gameNum % 2 === 0 ? game.computer : game.player;
            
            game.startGame(currentDealer);
            
            // Simulate discard phase - simple random discard for player
            const playerDiscardIndices = [0, 1]; // Just discard first 2 for simulation
            game.discardToCrib(playerDiscardIndices);
            
            // Simulate play phase
            this.simulatePlayPhase(game);
            
            // Count hands
            game.countHands();
            
            // If somehow game didn't complete, force a winner
            if (!game.lastWinner) {
                game.lastWinner = game.player.score >= game.computer.score ? game.player : game.computer;
            }
            
            // Record results
            this.results.push({
                gameNumber: gameNum + 1,
                playerScore: game.player.score,
                computerScore: game.computer.score,
                winner: game.lastWinner.name,
                dealer: currentDealer.name
            });
        }
    }

    simulatePlayPhase(game) {
        // Keep playing until both players have played all 4 cards
        let playCount = 0;
        const maxPlays = 100; // Safety limit
        
        while ((game.player.playedCards.length < 4 || game.computer.playedCards.length < 4) && playCount < maxPlays) {
            playCount++;
            
            if (game.state === 'PAUSE_GO' || game.state === 'PAUSE_31') {
                // Reset count for next sequence
                game.resetCount();
                game.state = 'PLAY';
            }

            const currentPlayer = game.currentTurn;
            
            if (game.currentTurn === game.computer) {
                const playableCards = game.computer.hand.filter(card =>
                    !game.computer.playedCards.includes(card) &&
                    game.currentCount + card.value <= 31
                );

                if (playableCards.length > 0) {
                    const cardToPlay = game.selectBestPlayCard(playableCards);
                    game.playCard(game.computer, cardToPlay);
                } else {
                    game.sayGo();
                }
            } else {
                // Player's turn - simple strategy for simulation
                const playerPlayable = game.player.hand.filter(card =>
                    !game.player.playedCards.includes(card) &&
                    game.currentCount + card.value <= 31
                );

                if (playerPlayable.length > 0) {
                    // Player: try to make 31, then 15, otherwise play lowest
                    let cardToPlay = null;
                    
                    // Try for 31
                    for (const card of playerPlayable) {
                        if (game.currentCount + card.value === 31) {
                            cardToPlay = card;
                            break;
                        }
                    }
                    
                    // Try for 15
                    if (!cardToPlay) {
                        for (const card of playerPlayable) {
                            if (game.currentCount + card.value === 15) {
                                cardToPlay = card;
                                break;
                            }
                        }
                    }
                    
                    // Otherwise play lowest
                    if (!cardToPlay) {
                        cardToPlay = playerPlayable.reduce((lowest, card) => 
                            card.value < lowest.value ? card : lowest
                        );
                    }
                    
                    game.playCard(game.player, cardToPlay);
                } else {
                    game.sayGo();
                }
            }

            // Safety check to avoid infinite loops
            if (game.player.playedCards.length === 4 && game.computer.playedCards.length === 4) {
                break;
            }
        }
        
        // Ensure all cards are played even if simulation didn't complete naturally
        if (game.player.playedCards.length < 4) {
            const remaining = game.player.hand.filter(c => !game.player.playedCards.includes(c));
            for (const card of remaining) {
                game.player.playCard(card);
            }
        }
        if (game.computer.playedCards.length < 4) {
            const remaining = game.computer.hand.filter(c => !game.computer.playedCards.includes(c));
            for (const card of remaining) {
                game.computer.playCard(card);
            }
        }
    }

    getResults() {
        return this.results;
    }

    getSummary() {
        const playerWins = this.results.filter(r => r.winner === 'Player').length;
        const computerWins = this.results.filter(r => r.winner === 'Computer').length;
        const avgPlayerScore = this.results.reduce((sum, r) => sum + r.playerScore, 0) / this.numGames;
        const avgComputerScore = this.results.reduce((sum, r) => sum + r.computerScore, 0) / this.numGames;

        return {
            totalGames: this.numGames,
            playerWins,
            computerWins,
            winRate: `${(playerWins / this.numGames * 100).toFixed(1)}%`,
            avgPlayerScore: avgPlayerScore.toFixed(1),
            avgComputerScore: avgComputerScore.toFixed(1),
            results: this.results
        };
    }
}

// Run simulation
const simulator = new GameSimulator(10000);
simulator.runSimulation();
const summary = simulator.getSummary();

// Output results
console.log('\n=== CRIBBAGE GAME SIMULATION RESULTS ===\n');
console.log(`Total Games Played: ${summary.totalGames}`);
console.log(`Player Wins: ${summary.playerWins}`);
console.log(`Computer Wins: ${summary.computerWins}`);
console.log(`Player Win Rate: ${summary.winRate}`);
console.log(`Average Player Score: ${summary.avgPlayerScore}`);
console.log(`Average Computer Score: ${summary.avgComputerScore}`);
console.log('\n--- Game-by-Game Results ---\n');
console.log('Game# | Player Score | Computer Score | Winner   | Dealer');
console.log('------|--------------|----------------|----------|--------');
summary.results.forEach(result => {
    const gameNum = String(result.gameNumber).padStart(4, ' ');
    const pScore = String(result.playerScore).padStart(12, ' ');
    const cScore = String(result.computerScore).padStart(14, ' ');
    const winner = result.winner.padEnd(8, ' ');
    const dealer = result.dealer;
    console.log(`${gameNum}  |${pScore}  |${cScore}  | ${winner} | ${dealer}`);
});

// Write to file
const fs = require('fs');
let output = '# CRIBBAGE GAME SIMULATION RESULTS\n\n';
output += `**Date:** ${new Date().toLocaleString()}\n\n`;
output += '## Summary Statistics\n\n';
output += `- **Total Games Played:** ${summary.totalGames}\n`;
output += `- **Player Wins:** ${summary.playerWins}\n`;
output += `- **Computer Wins:** ${summary.computerWins}\n`;
output += `- **Player Win Rate:** ${summary.winRate}\n`;
output += `- **Average Player Score:** ${summary.avgPlayerScore}\n`;
output += `- **Average Computer Score:** ${summary.avgComputerScore}\n\n`;

output += '## Game-by-Game Results\n\n';
output += '| Game # | Player Score | Computer Score | Winner | Dealer |\n';
output += '|--------|--------------|----------------|--------|--------|\n';
summary.results.forEach(result => {
    output += `| ${result.gameNumber} | ${result.playerScore} | ${result.computerScore} | ${result.winner} | ${result.dealer} |\n`;
});

fs.writeFileSync('./SIMULATION_RESULTS.md', output);
console.log('\n✓ Results saved to SIMULATION_RESULTS.md');
