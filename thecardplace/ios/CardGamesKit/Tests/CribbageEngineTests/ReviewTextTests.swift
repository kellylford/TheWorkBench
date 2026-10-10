import XCTest
import CardCore
@testable import CribbageEngine

final class ReviewTextTests: XCTestCase {
    /// A position in the play: Ruth dealt; Ruth led the Eight of Hearts, you
    /// answered the Seven of Diamonds for fifteen; count 15, your turn.
    func midPlay() -> CribbageState {
        var s = CribbageGame.createGame(Sim.config(.normal, 121))
        s.phase = .play
        s.gameNumber = 1
        s.handNumber = 3
        s.dealer = 1
        s.turn = 0
        s.starter = card("QS")
        s.players[0].kept = cards("7C", "7D", "KS", "4H")
        s.players[0].hand = cards("7C", "KS", "4H")
        s.players[0].played = cards("7D")
        s.players[1].kept = cards("8H", "5C", "TD", "AS")
        s.players[1].hand = cards("5C", "TD", "AS")
        s.players[1].played = cards("8H")
        s.pile = [CribbagePilePlay(player: 1, card: card("8H")), CribbagePilePlay(player: 0, card: card("7D"))]
        s.runStart = 0
        s.count = 15
        s.players[0].score = 45
        s.players[1].score = 39
        s.crib = cards("2C", "3C", "9D", "JH")
        s.discarded = [cards("2C", "3C"), cards("9D", "JH")]
        s.deck = Card.fullDeck.filter { c in
            !(s.players[0].kept + s.players[1].kept + s.crib + [s.starter!]).contains(c)
        }
        return s
    }

    func testCardLabelsDuringThePlay() {
        let s = midPlay()
        XCTAssertEqual(CribbageReview.cardLabel(s, seat: 0, card: card("7C")),
                       "Seven of Clubs, worth seven, makes twenty-two, and scores a pair for two")
        XCTAssertEqual(CribbageReview.cardLabel(s, seat: 0, card: card("KS")),
                       "King of Spades, worth ten, makes twenty-five")
        XCTAssertEqual(CribbageReview.cardLabel(s, seat: 0, card: card("4H")),
                       "Four of Hearts, worth four, makes nineteen")
        var big = s
        big.count = 24
        XCTAssertEqual(CribbageReview.cardLabel(big, seat: 0, card: card("KS")),
                       "King of Spades, cannot be played, it would take the count to thirty-four, past thirty-one")
        XCTAssertEqual(CribbageReview.cardLabel(big, seat: 0, card: card("7C")),
                       "Seven of Clubs, worth seven, makes thirty-one, and scores thirty-one for two and a pair for two")
        // Not your turn: for review only.
        var theirs = s
        theirs.turn = 1
        XCTAssertEqual(CribbageReview.cardLabel(theirs, seat: 0, card: card("7C")),
                       "Seven of Clubs, for review, Ruth is to play")
        // A card that is not yours cannot be played.
        XCTAssertEqual(CribbageReview.cardLabel(s, seat: 0, card: card("5C")),
                       "Five of Clubs, cannot be played, that card is not in your hand")
    }

    func testHandDuringThePlay() {
        let s = midPlay()
        XCTAssertEqual(CribbageReview.hand(s, seat: 0),
                       "The count is 15. Your three cards: Four of Hearts, worth four, makes nineteen. " +
                       "Seven of Clubs, worth seven, makes twenty-two, and scores a pair for two. " +
                       "King of Spades, worth ten, makes twenty-five.")
        var big = s
        big.count = 24
        XCTAssertEqual(CribbageReview.hand(big, seat: 0),
                       "The count is 24. Your three cards: Four of Hearts, worth four, makes twenty-eight. " +
                       "Seven of Clubs, worth seven, makes thirty-one, and scores thirty-one for two and a pair for two. " +
                       "King of Spades, too big to play.")
        var empty = s
        empty.players[0].hand = []
        XCTAssertEqual(CribbageReview.hand(empty, seat: 0),
                       "You have played all four. You kept Four of Hearts, Seven of Clubs, Seven of Diamonds and King of Spades.")
    }

    func testHandAtTheDiscard() {
        var s = CribbageGame.createGame(Sim.config(.normal, 121))
        s.phase = .discard
        s.dealer = 1
        s.turn = 0
        s.players[0].hand = cards("KS", "5C", "AH", "TD", "5D", "9C")
        XCTAssertEqual(CribbageReview.hand(s, seat: 0),
                       "Your six cards: Ace of Hearts, Five of Clubs, Five of Diamonds, Nine of Clubs, Ten of Diamonds, King of Spades. Two of them go to Ruth’s crib.")
        XCTAssertEqual(CribbageReview.cardLabel(s, seat: 0, card: card("KS")), "King of Spades")
        XCTAssertEqual(CribbageReview.status(s, seat: 0), "Throw two cards to Ruth’s crib.")
        XCTAssertEqual(CribbageReview.prompt(s, seat: 0), "Choose two cards to throw to Ruth’s crib.")
        s.dealer = 0
        XCTAssertEqual(CribbageReview.status(s, seat: 0), "Throw two cards to your crib.")
        s.discarded[0] = cards("KS", "TD")
        s.players[0].hand = cards("5C", "AH", "5D", "9C")
        XCTAssertEqual(CribbageReview.status(s, seat: 0), "Your two are in the crib. Waiting for Ruth.")
        XCTAssertEqual(CribbageReview.cardLabel(s, seat: 0, card: card("5C")), "Five of Clubs, for review, your throw is already in")
        XCTAssertEqual(CribbageReview.dealerAndCrib(s, seat: 0),
                       "You dealt, so it is your crib. The starter has not been turned yet. Your two are in the crib; waiting for Ruth.")
        XCTAssertEqual(CribbageReview.prompt(s, seat: 0), "")
    }

    func testPlayAndCountingAid() {
        let s = midPlay()
        XCTAssertEqual(CribbageReview.play(s, seat: 0),
                       "The count is 15. Down this run: Ruth the Eight of Hearts, then you the Seven of Diamonds. " +
                       "You could score a pair for two with the Seven of Clubs.")
        XCTAssertEqual(CribbageReview.trick(s, seat: 0), CribbageReview.play(s, seat: 0))
        XCTAssertEqual(CribbageReview.countingAid(s, seat: 0),
                       "Played this hand: Ruth the Eight of Hearts, you the Seven of Diamonds. The count is 15.")

        // After a reset the earlier cards are only in the counting aid.
        var r = s
        r.pile.append(CribbagePilePlay(player: 1, card: card("TD")))
        r.pile.append(CribbagePilePlay(player: 0, card: card("4H")))
        r.runStart = 4
        r.count = 0
        r.turn = 1
        r.players[0].hand = cards("7C", "KS")
        XCTAssertEqual(CribbageReview.play(r, seat: 0),
                       "The count is 0. Nothing down since the count reset. Ruth to lead.")
        XCTAssertEqual(CribbageReview.countingAid(r, seat: 0),
                       "Played this hand: Ruth the Eight of Hearts, you the Seven of Diamonds, Ruth the Ten of Diamonds, you the Four of Hearts. The count is 0.")
        r.pile.append(CribbagePilePlay(player: 1, card: card("AS")))
        r.count = 1
        r.turn = 0
        XCTAssertEqual(CribbageReview.countingAid(r, seat: 0),
                       "Played this hand: Ruth the Eight of Hearts, you the Seven of Diamonds, Ruth the Ten of Diamonds, you the Four of Hearts, the count reset, then Ruth the Ace of Spades. The count is 1.")
        XCTAssertEqual(CribbageReview.play(r, seat: 0), "The count is 1. Down this run: Ruth the Ace of Spades.")

        // Nothing fits: you must say go.
        var g = s
        g.count = 28
        g.players[0].hand = cards("7C", "KS")
        XCTAssertEqual(CribbageReview.play(g, seat: 0),
                       "The count is 28. Down this run: Ruth the Eight of Hearts, then you the Seven of Diamonds. " +
                       "Nothing in your hand fits under thirty-one, so you must say go.")
        XCTAssertEqual(CribbageReview.prompt(g, seat: 0), "You cannot play. Say go.")

        let idle = CribbageGame.createGame(Sim.config(.normal, 121))
        XCTAssertEqual(CribbageReview.play(idle, seat: 0), "The play has not started yet.")
        XCTAssertEqual(CribbageReview.countingAid(idle, seat: 0), "The play has not started yet.")
    }

    func testScoresAndStatus() {
        let s = midPlay()
        XCTAssertEqual(CribbageReview.scores(s, seat: 0),
                       "You 45, Ruth 39, playing to 121. You need seventy-six more; Ruth needs eighty-two.")
        XCTAssertEqual(CribbageReview.status(s, seat: 0), "The count is 15 — your turn.")
        XCTAssertEqual(CribbageReview.prompt(s, seat: 0), "Your turn. The count is 15.")
        var t = s
        t.turn = 1
        XCTAssertEqual(CribbageReview.status(t, seat: 0), "The count is 15 — Ruth to play.")
        XCTAssertEqual(CribbageReview.prompt(t, seat: 0), "")
        t.gamesWon = [1, 2]
        XCTAssertEqual(CribbageReview.scores(t, seat: 0),
                       "You 45, Ruth 39, playing to 121. You need seventy-six more; Ruth needs eighty-two. Games won: you 1, Ruth 2.")

        var idle = CribbageGame.createGame(Sim.config(.normal, 61))
        XCTAssertEqual(CribbageReview.status(idle, seat: 0), "Cribbage, playing to 61. Start the game to cut for deal.")
        XCTAssertEqual(CribbageReview.dealerAndCrib(idle, seat: 0), "Nobody has dealt yet. Cut for deal to begin.")
        idle.phase = .cutForDeal
        XCTAssertEqual(CribbageReview.status(idle, seat: 0), "Cut for deal — the lower card deals and takes the first crib.")
        idle.cutForDeal = CribbageCut(cuts: cards("TC", "TD"), tie: true)
        XCTAssertEqual(CribbageReview.status(idle, seat: 0), "Cut for deal — the lower card deals and takes the first crib. That was a tie; cut again.")

        var c = s
        c.phase = .count
        c.countStage = 0
        c.turn = 0
        XCTAssertEqual(CribbageReview.status(c, seat: 0), "Counting: the non-dealer’s hand — yours to count.")
        XCTAssertEqual(CribbageReview.prompt(c, seat: 0), "Your hand to count.")
        c.countStage = 1
        c.turn = 1
        XCTAssertEqual(CribbageReview.status(c, seat: 0), "Counting: the dealer’s hand — Ruth is counting.")
        c.countStage = 2
        XCTAssertEqual(CribbageReview.status(c, seat: 0), "Counting: the crib — Ruth is counting.")
        XCTAssertEqual(CribbageReview.dealerAndCrib(c, seat: 0),
                       "Ruth dealt, so the crib is theirs. The starter is the Queen of Spades. Counting: the crib next.")

        var over = s
        over.phase = .roundOver
        over.countStage = 3
        XCTAssertEqual(CribbageReview.status(over, seat: 0), "Hand 3 complete. You 45, Ruth 39.")
        XCTAssertEqual(CribbageReview.dealerAndCrib(over, seat: 0),
                       "Ruth dealt, so the crib is theirs. The starter is the Queen of Spades. The crib was Two of Clubs, Three of Clubs, Nine of Diamonds and Jack of Hearts.")

        var won = s
        won.phase = .gameOver
        won.gameWinner = 0
        won.players[0].score = 121
        won.players[1].score = 58
        won.result = CribbageHandResult(gameOver: true, winner: 0, scores: [121, 58], skunk: .skunk, counts: [])
        XCTAssertEqual(CribbageReview.status(won, seat: 0), "You win, 121 to 58.")
        XCTAssertEqual(CribbageReview.handSummary(won, seat: 0), "You win, 121 to 58 — a skunk.")
        won.gameWinner = 1
        XCTAssertEqual(CribbageReview.status(won, seat: 0), "Ruth wins, 58 to 121.")
    }

    func testPlayOrder() {
        let s = midPlay()
        XCTAssertEqual(CribbageReview.playOrder(s, seat: 0),
                       "Ruth dealt, so you lead the play and Ruth answers. At the count, you count first, then Ruth, then Ruth’s crib.")
        var mine = s
        mine.dealer = 0
        XCTAssertEqual(CribbageReview.playOrder(mine, seat: 0),
                       "You dealt, so Ruth leads the play and you answer. At the count, Ruth counts first, then you, then your crib.")
    }

    func testLastCountAndTheCountEvents() {
        var rng = RandomSource(seed: 21)
        var state = CribbageGame.createGame(Sim.config(.normal, 121))
        XCTAssertEqual(CribbageReview.lastCount(state, seat: 0), "Nothing has been counted yet.")
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .count })
        XCTAssertEqual(CribbageReview.lastCount(state, seat: 0), "Nothing has been counted yet.")
        let nonDealer = 1 - state.dealer!
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: nonDealer, action: .next, rng: &rng), .ok)
        let kept = CribbageCards.sortHand(state.players[nonDealer].kept)
        let r = CribbageScoring.scoreHand(kept, starter: state.starter, isCrib: false)
        let whose = nonDealer == 0 ? "Your" : "Ruth’s"
        let want = "\(whose) hand: " + CribbageCards.listNames(kept) + " with the " + state.starter!.name + ". " +
            CribbageGame.cap(r.spoken) + "."
        XCTAssertEqual(CribbageReview.lastCount(state, seat: 0), want)
        let countEvent = state.log.events.last { $0.kind == .count }!
        XCTAssertEqual(countEvent.cards, kept)
        if r.total > 0 {
            let scoreEvent = state.log.events.last { $0.kind == .score }!
            let name = nonDealer == 0 ? "You score " : "Ruth scores "
            XCTAssertTrue(scoreEvent.text.hasPrefix(name + CribbageCards.numberWord(r.total) + " for the hand. "), scoreEvent.text)
            XCTAssertTrue(scoreEvent.text.hasSuffix("You \(state.players[0].score), Ruth \(state.players[1].score)."))
        }
    }

    func testEventWording() {
        var rng = RandomSource(seed: 33)
        var state = CribbageGame.createGame(Sim.config(.normal, 121))
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng), .ok)
        XCTAssertEqual(state.log.events.last?.text, "Cut for deal. The lower card deals first and takes the first crib.")
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .discard })
        let texts = state.log.events.map(\.text)
        XCTAssertTrue(texts.contains { $0.hasPrefix("You cut the ") && $0.contains(". Ruth cuts the ") })
        let dealer = state.dealer!
        if dealer == 0 {
            XCTAssertTrue(texts.contains("You have the lower card and deal first."))
            XCTAssertTrue(texts.contains("Hand 1. You deal, so it is your crib. Both players throw two cards to it."))
        } else {
            XCTAssertTrue(texts.contains("Ruth has the lower card and deals first."))
            XCTAssertTrue(texts.contains("Hand 1. Ruth deals, so it is Ruth’s crib. Both players throw two cards to it."))
        }
        let six = state.log.events.last { $0.audience == 0 }!
        XCTAssertTrue(six.text.hasPrefix("Your six cards: "))
        XCTAssertEqual(six.cards.count, 6)

        XCTAssertTrue(advance(&state, &rng) { $0.phase == .play })
        let after = state.log.events.map(\.text)
        XCTAssertTrue(after.contains { $0.hasPrefix("You threw the ") && $0.contains(" crib. You keep ") })
        XCTAssertTrue(after.contains("You have thrown two cards to the crib."))
        XCTAssertTrue(after.contains("Ruth has thrown two cards to the crib."))
        XCTAssertTrue(after.contains { $0.hasPrefix("The starter is the ") })
        XCTAssertTrue(after.contains(dealer == 0 ? "Ruth leads. The count starts at nothing." : "You lead. The count starts at nothing."))

        XCTAssertTrue(advance(&state, &rng) { $0.phase == .play && !$0.pile.isEmpty })
        let play = state.log.events.last { $0.kind == .play }!
        let leader = 1 - dealer
        XCTAssertTrue(play.text.hasPrefix(leader == 0 ? "You play the " : "Ruth plays the "), play.text)
        XCTAssertTrue(play.text.hasSuffix(". The count is \(state.count)."))
        XCTAssertEqual(play.cards, [state.pile[0].card])
        XCTAssertEqual(play.seat, leader)
    }

    func testHelpAndCards() {
        XCTAssertEqual(CribbageHelp.rules.count, 6)
        XCTAssertEqual(CribbageHelp.rules[0].heading, "How to play Cribbage")
        for r in CribbageHelp.rules {
            XCTAssertFalse(r.body.contains("<"))
            XCTAssertFalse(r.body.isEmpty)
        }
        XCTAssertEqual(CribbageCards.describe(card("KC")), "King of Clubs")
        XCTAssertEqual(CribbageCards.role(card("KC")), "")
        XCTAssertEqual(CribbageCards.sortHand(cards("KS", "AC", "TD", "JC", "AS")).ids, ["AC", "AS", "TD", "JC", "KS"])
        XCTAssertEqual(CribbageCards.listNames([]), "nothing")
        XCTAssertEqual(CribbageCards.listNames(cards("AS")), "Ace of Spades")
        XCTAssertEqual(CribbageCards.listNames(cards("AS", "5H")), "Ace of Spades and Five of Hearts")
        XCTAssertEqual(CribbageCards.numberWord(0), "no")
        XCTAssertEqual(CribbageCards.numberWord(29), "twenty-nine")
        XCTAssertEqual(CribbageCards.numberWord(40), "forty")
        XCTAssertEqual(CribbageCards.numberWord(121), "121")
        XCTAssertEqual(CribbageConfig().targetScore, 121)
        XCTAssertEqual(CribbageConfig().difficulty, .normal)
        XCTAssertEqual(CribbageConfig().names, ["You", "Ruth"])
    }
}
