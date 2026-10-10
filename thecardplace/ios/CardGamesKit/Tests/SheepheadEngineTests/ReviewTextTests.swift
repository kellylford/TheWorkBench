import XCTest
import CardCore
@testable import SheepheadEngine

final class ReviewTextTests: XCTestCase {
    /// Five players, seat 4 dealt, trick 1 about to be led by seat 0, with
    /// Alice the picker and Ben her (hidden) partner, and known hands.
    private func position() -> SheepheadState {
        var (state, _) = fiveHanded()
        state.phase = .play
        state.picker = 1
        state.partner = 0
        state.alone = false
        state.partnerRevealed = false
        state.buried = cards("AH", "TH")
        state.players[0].hand = cards("QC", "AC", "9H", "JD")
        state.players[0].hand = SheepheadCards.sortHand(state.players[0].hand)
        state.players[1].hand = cards("QS", "TC", "KC", "8H")
        state.players[2].hand = cards("JC", "AS", "TS", "7H")
        state.players[3].hand = cards("QH", "AD", "KS", "9S")
        state.players[4].hand = cards("QD", "TD", "9C", "8S")
        state.players[0].hand = cards("QC", "JD", "AC", "9H")
        state.trick = []
        state.turn = 0
        state.leader = 0
        return state
    }

    func testCardDescriptions() {
        XCTAssertEqual(SheepheadCards.describe(card("QC")), "Queen of Clubs, trump, 3 points")
        XCTAssertEqual(SheepheadCards.describe(card("JD")), "Jack of Diamonds, trump, 2 points")
        XCTAssertEqual(SheepheadCards.describe(card("7D")), "Seven of Diamonds, trump, 0 points")
        XCTAssertEqual(SheepheadCards.describe(card("AC")), "Ace of Clubs, Clubs fail, 11 points")
        XCTAssertEqual(SheepheadCards.describe(card("9H")), "Nine of Hearts, Hearts fail, 0 points")
        XCTAssertEqual(SheepheadCards.role(card("TS")), "Spades fail, 10 points")
        XCTAssertEqual(SheepheadCards.sortHand(cards("9H", "AC", "JD", "7C", "QC", "AH", "TS")).map(\.id),
                       ["QC", "JD", "AC", "7C", "TS", "AH", "9H"])
    }

    func testTheJackOfDiamondsSaysWhatItMeansForYourOwnSeat() {
        var state = position()
        XCTAssertEqual(SheepheadReview.describe(card("JD"), in: state, seat: 0),
                       "Jack of Diamonds, trump, 2 points, the partner card, so you are the picker's partner")
        XCTAssertEqual(SheepheadReview.describe(card("QC"), in: state, seat: 0), "Queen of Clubs, trump, 3 points")
        // Asked about a seat that does not hold it, nothing is added.
        XCTAssertEqual(SheepheadReview.describe(card("JD"), in: state, seat: 1), "Jack of Diamonds, trump, 2 points")
        state.picker = 0
        XCTAssertEqual(SheepheadReview.describe(card("JD"), in: state, seat: 0),
                       "Jack of Diamonds, trump, 2 points, the partner card, so you are playing alone")
        state.picker = nil
        state.phase = .pick
        XCTAssertEqual(SheepheadReview.describe(card("JD"), in: state, seat: 0),
                       "Jack of Diamonds, trump, 2 points, the partner card")
        // At three players there is no partner card to speak of.
        var (three, _) = newGame(players: 3, seed: 1)
        three.players[0].hand = cards("JD", "AC")
        XCTAssertEqual(SheepheadReview.describe(card("JD"), in: three, seat: 0), "Jack of Diamonds, trump, 2 points")
    }

    func testHand() {
        var state = position()
        XCTAssertEqual(SheepheadReview.hand(state, seat: 0),
                       "Your hand, 4 cards. Trump: Queen of Clubs, Jack of Diamonds. Non-trump: Ace of Clubs, Nine of Hearts. Worth 16 points. You hold the Jack of Diamonds, the partner card, so you are the picker's partner.")
        XCTAssertEqual(SheepheadReview.hand(state, seat: 0, verbose: false),
                       "Your hand, 4 cards. Trump: Queen of Clubs, Jack of Diamonds. Non-trump: Ace of Clubs, Nine of Hearts. You hold the Jack of Diamonds, the partner card, so you are the picker's partner.")
        state.players[0].hand = cards("AC", "9H")
        XCTAssertEqual(SheepheadReview.hand(state, seat: 0), "Your hand, 2 cards. No trump. Non-trump: Ace of Clubs, Nine of Hearts. Worth 11 points.")
        state.players[0].hand = cards("QC")
        XCTAssertEqual(SheepheadReview.hand(state, seat: 0), "Your hand, 1 card. Trump: Queen of Clubs. No non-trump cards. Worth 3 points.")
        state.players[0].hand = []
        XCTAssertEqual(SheepheadReview.hand(state, seat: 0), "Your hand is empty.")
    }

    func testHandAfterPickingLeadsWithTheBlind() {
        var (state, rng) = fiveHanded()
        state.blind = cards("AS", "TS")
        state.players[0].hand = SheepheadCards.sortHand(cards("QC", "JD", "AC", "9H", "KS", "7C"))
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .pick, rng: &rng), .ok)
        XCTAssertEqual(state.players[0].hand.prefix(2).map(\.id), ["AS", "TS"], "the blind sits at the front, unsorted")
        XCTAssertEqual(SheepheadReview.hand(state, seat: 0),
                       "From the blind: Ace of Spades, Ten of Spades. Then your hand. Your hand, 8 cards. Trump: Queen of Clubs, Jack of Diamonds. Non-trump: Ace of Clubs, Seven of Clubs, Ace of Spades, Ten of Spades, King of Spades, Nine of Hearts. Worth 41 points. You hold the Jack of Diamonds, the partner card, so you are playing alone.")
        XCTAssertEqual(SheepheadReview.describe(card("AS"), in: state, seat: 0), "Ace of Spades, Spades fail, 11 points, from the blind")
        XCTAssertEqual(SheepheadReview.status(state, seat: 0), "You picked. Bury 2 cards.")
        XCTAssertEqual(SheepheadReview.status(state, seat: 1), "You picked and is burying.")
        XCTAssertEqual(SheepheadReview.prompt(state, seat: 0), "You picked. Choose 2 cards to bury, then choose Bury.")
        XCTAssertEqual(state.log.events(for: 0).last?.text, "From the blind: Ace of Spades, Ten of Spades.")
        XCTAssertEqual(state.log.events(for: 1).last?.text, "You pick up the blind (2 cards).")
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .bury(cards("KS", "7C")), rng: &rng), .ok)
        XCTAssertEqual(state.players[0].hand.map(\.id), ["QC", "JD", "AC", "AS", "TS", "9H"], "sorted again after the bury")
        XCTAssertEqual(SheepheadReview.describe(card("AS"), in: state, seat: 0), "Ace of Spades, Spades fail, 11 points")
        XCTAssertEqual(state.log.events(for: 0).map(\.text).suffix(4), [
            "You bury 2 cards.",
            "You buried 4 points.",
            "You are the picker. The Jack of Diamonds is the partner card.",
            "You have the Jack of Diamonds yourself, so you are playing alone — nobody else knows that yet.",
        ])
        XCTAssertEqual(SheepheadReview.scores(state, seat: 0),
                       "This hand: You 0, 0 tricks. Alice 0, 0 tricks. Ben 0, 0 tricks. Cara 0, 0 tricks. Elle 0, 0 tricks. You buried 4 points. Running score: You 0, Alice 0, Ben 0, Cara 0, Elle 0.")
    }

    func testTrickAndLastTrick() {
        var state = position()
        XCTAssertEqual(SheepheadReview.trick(state, seat: 0), "Trick 3 of 6. Nothing played yet. You to lead.")
        XCTAssertEqual(SheepheadReview.trickShort(state), "Nothing played to this trick yet.")
        XCTAssertEqual(SheepheadReview.lastTrick(state, seat: 0), "No trick has been completed yet this hand.")
        state.trick = [SheepheadPlay(player: 1, card: card("QS")), SheepheadPlay(player: 2, card: card("AS"))]
        state.turn = 3
        XCTAssertEqual(SheepheadReview.trick(state, seat: 0),
                       "Trick 3 of 6. Alice, Queen of Spades, trump, 3 points. Ben, Ace of Spades, Spades fail, 11 points. Trump led. Alice is winning with Queen of Spades. 14 points in the trick so far.")
        XCTAssertEqual(SheepheadReview.trick(state, seat: 0, verbose: false),
                       "Trick 3 of 6. Alice, Queen of Spades. Ben, Ace of Spades. Trump led. Alice is winning with Queen of Spades. 14 points in the trick so far.")
        state.trick = [SheepheadPlay(player: 1, card: card("KC"))]
        XCTAssertEqual(SheepheadReview.trickShort(state), "Clubs led. Alice is winning with King of Clubs. 4 points in the trick so far.")
        state.lastTrick = SheepheadTrick(plays: [SheepheadPlay(player: 0, card: card("9H")), SheepheadPlay(player: 1, card: card("8H"))], winner: 0, points: 0, fromBlind: 0)
        XCTAssertEqual(SheepheadReview.lastTrick(state, seat: 0), "Last trick. You, Nine of Hearts. Alice, Eight of Hearts. You took it for 0 points.")
    }

    func testScores() {
        var state = position()
        state.players[1].points = 14
        state.players[1].tricksWon = 1
        state.players[3].score = -4
        state.players[1].score = 4
        XCTAssertEqual(SheepheadReview.scores(state, seat: 0),
                       "This hand: You 0, 0 tricks. Alice 14, 1 trick. Ben 0, 0 tricks. Cara 0, 0 tricks. Elle 0, 0 tricks. Running score: You 0, Alice 4, Ben 0, Cara -4, Elle 0.")
    }

    func testPicker() {
        var state = position()
        XCTAssertEqual(SheepheadReview.picker(state, seat: 0), "Alice is the picker. You hold the Jack of Diamonds, so you are the secret partner. Nobody else knows yet.")
        XCTAssertEqual(SheepheadReview.picker(state, seat: 3), "Alice is the picker. The Jack of Diamonds has not been played, so the partner is still unknown — and the picker may be holding it and playing alone.")
        XCTAssertEqual(SheepheadReview.picker(state, seat: 1), "You are the picker. Somebody else holds the Jack of Diamonds and is your secret partner.")
        state.partnerRevealed = true
        XCTAssertEqual(SheepheadReview.picker(state, seat: 0), "Alice is the picker. You are the partner.")
        XCTAssertEqual(SheepheadReview.picker(state, seat: 3), "Alice is the picker. You is the partner.")
        state.alone = true
        state.partner = nil
        XCTAssertEqual(SheepheadReview.picker(state, seat: 3), "Alice is the picker. The picker is playing alone.")
        state.partnerRevealed = false
        state.picker = 0
        state.players[0].hand = cards("QC", "AC")
        XCTAssertEqual(SheepheadReview.picker(state, seat: 0), "You are the picker. You have the Jack of Diamonds yourself, so you are playing alone. Nobody else knows that yet.")
        state.phase = .pick
        state.turn = 2
        XCTAssertEqual(SheepheadReview.picker(state, seat: 0), "Nobody has picked yet. Ben is deciding.")
        state.phase = .play
        state.isLeaster = true
        XCTAssertEqual(SheepheadReview.picker(state, seat: 0), "Leaster. There is no picker; everyone plays for themselves and the fewest points wins. You must take at least one trick to be eligible.")
        var (three, _) = newGame(players: 3, seed: 1)
        three.phase = .play
        three.picker = 2
        three.alone = true
        three.partnerRevealed = true
        XCTAssertEqual(SheepheadReview.picker(three, seat: 0), "Ben is the picker. With 3 players the picker always plays alone.")
    }

    func testCardsPlayed() {
        var state = position()
        XCTAssertEqual(SheepheadReview.cardsPlayed(state, seat: 0), "Trump played: 0 of 14. Clubs: 0 of 6 played. Spades: 0 of 6 played. Hearts: 0 of 6 played.")
        state.played = cards("QS", "AS", "KC", "7D", "AH")
        XCTAssertEqual(SheepheadReview.cardsPlayed(state, seat: 0), "Trump played: 2 of 14. Clubs: 1 of 6 played. Spades: 1 of 6 played. Hearts: 1 of 6 played.")
        var (four, _) = newGame(players: 4, seed: 1)
        four.played = cards("QC")
        XCTAssertEqual(SheepheadReview.cardsPlayed(four, seat: 0), "Trump played: 1 of 12. Clubs: 0 of 6 played. Spades: 0 of 6 played. Hearts: 0 of 6 played.")
    }

    func testPlayOrder() {
        var state = position()
        XCTAssertEqual(SheepheadReview.playOrder(state, seat: 0),
                       "Play order for this trick, starting with the lead. 1, You, partner, to play. 2, Alice, picker, to play. 3, Ben, to play. 4, Cara, to play. 5, Elle, dealer, to play. You lead. The picker plays one place after you. 4 players play after you: Alice, Ben, Cara, Elle.")
        state.trick = [SheepheadPlay(player: 0, card: card("AC")), SheepheadPlay(player: 1, card: card("KC"))]
        state.turn = 2
        XCTAssertEqual(SheepheadReview.playOrder(state, seat: 3),
                       "Play order for this trick, starting with the lead. 1, You, played Ace of Clubs. 2, Alice, picker, played King of Clubs. 3, Ben, to play. 4, Cara, to play. 5, Elle, dealer, to play. The picker plays two places before you. 1 player plays after you: Elle.")
        state.partnerRevealed = true
        state.trick = [SheepheadPlay(player: 4, card: card("9C"))]
        state.turn = 0
        XCTAssertEqual(SheepheadReview.playOrder(state, seat: 1),
                       "Play order for this trick, starting with the lead. 1, Elle, dealer, played Nine of Clubs. 2, You, partner, to play. 3, Alice, picker, to play. 4, Ben, to play. 5, Cara, to play. You are the picker. 2 players play after you: Ben, Cara.")
        // Seat 3 plays last: "You play last" and nobody after.
        XCTAssertEqual(SheepheadReview.playOrder(state, seat: 3),
                       "Play order for this trick, starting with the lead. 1, Elle, dealer, played Nine of Clubs. 2, You, partner, to play. 3, Alice, picker, to play. 4, Ben, to play. 5, Cara, to play. You play last. The picker plays two places before you. Nobody plays after you.")

        var (pick, _) = fiveHanded()
        pick.pickLog = [SheepheadPickEntry(player: 0, picked: false)]
        pick.turn = 1
        pick.passCount = 1
        XCTAssertEqual(SheepheadReview.playOrder(pick, seat: 0),
                       "Picking order, starting to the dealer's left. 1, You, passed. 2, Alice, deciding now. 3, Ben, still to decide. 4, Cara, still to decide. 5, Elle, dealer, still to decide.")
        pick.phase = .bury
        XCTAssertEqual(SheepheadReview.playOrder(pick, seat: 0), "Seating order: You, Alice, Ben, Cara, Elle.")
    }

    func testStatusAndPrompt() {
        let idle = SheepheadGame.createGame(SheepheadConfig())
        XCTAssertEqual(SheepheadReview.status(idle, seat: 0), "Ready to start.")
        XCTAssertEqual(SheepheadReview.prompt(idle, seat: 0), "")

        var (state, _) = fiveHanded()
        XCTAssertEqual(SheepheadReview.status(state, seat: 0), "Your turn: pick up the blind (2 cards) or pass?")
        XCTAssertEqual(SheepheadReview.status(state, seat: 1), "Waiting for You to pick or pass.")
        XCTAssertEqual(SheepheadReview.prompt(state, seat: 0), "Your turn. Pick up the blind of 2 cards, or pass?")
        XCTAssertEqual(SheepheadReview.prompt(state, seat: 1), "")
        state.turn = 2
        XCTAssertEqual(SheepheadReview.status(state, seat: 0), "Waiting for Ben to pick or pass.")

        var play = position()
        XCTAssertEqual(SheepheadReview.status(play, seat: 0), "Trick 3 of 6 — your turn to play.")
        XCTAssertEqual(SheepheadReview.prompt(play, seat: 0), "Your lead. Trick 3 of 6.")
        play.turn = 1
        XCTAssertEqual(SheepheadReview.status(play, seat: 0), "Trick 3 of 6 — Alice to play.")
        play.trick = [SheepheadPlay(player: 1, card: card("TC"))]
        play.turn = 0
        XCTAssertEqual(SheepheadReview.prompt(play, seat: 0), "Your turn to play. Clubs led. Alice is winning with Ten of Clubs. 10 points in the trick so far.")
        play.phase = .handOver
        play.handNumber = 2
        XCTAssertEqual(SheepheadReview.status(play, seat: 0), "Hand 2 complete.")
        XCTAssertEqual(SheepheadReview.prompt(play, seat: 0), "Choose Deal next hand.")
    }

    func testHandOverSummaryShowsTheBlindAndTheBury() {
        var (state, rng) = fiveHanded(seed: 12)
        state.blind = cards("AS", "TS")
        state.players[0].hand = SheepheadCards.sortHand(cards("QC", "QS", "JC", "JD", "AC", "9H"))
        // Give the rest of the deck out so the deal still adds up.
        let rest = SheepheadCards.deck(for: 5).filter { !state.blind.contains($0) && !state.players[0].hand.contains($0) }
        for i in 1..<5 { state.players[i].hand = SheepheadCards.sortHand(Array(rest[(i - 1) * 6..<i * 6])) }
        state.dealt = SheepheadDeal(hands: state.players.map(\.hand), blind: state.blind)
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .pick, rng: &rng), .ok)
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .bury(cards("AS", "TS")), rng: &rng), .ok)
        playHand(&state, rng: &rng)
        let r = state.result!
        XCTAssertFalse(r.leaster)
        XCTAssertTrue(r.summary.hasPrefix("Hand over. You alone took \(r.pickerPoints) points (including 21 buried); the defenders took \(r.opponentPoints). The blind held Ace of Spades and Ten of Spades. Buried: Ace of Spades, Ten of Spades (21 points). The picker's team \(r.pickerWins ? "wins" : "loses") — \(r.label). "), r.summary)
        XCTAssertTrue(r.summary.hasSuffix("."))
        XCTAssertEqual(SheepheadReview.blindReveal(state),
                       "The blind, and what You buried (21 points, counted for the picker's team). Blind: Ace of Spades, Ten of Spades. Buried: Ace of Spades, Ten of Spades.")
        XCTAssertEqual(SheepheadReview.resultHeadline(state, seat: 0), "You \(r.pickerWins ? "win" : "lose") alone — \(r.label).")
        XCTAssertEqual(SheepheadReview.resultHeadline(state, seat: 1), "You \(r.pickerWins ? "wins" : "loses") alone — \(r.label).")
        XCTAssertEqual(state.log.events.last?.kind, .score)
        XCTAssertEqual(state.log.events.last?.cards, cards("AS", "TS", "AS", "TS"))
    }

    func testLeasterReveal() {
        var (state, rng) = newGame(players: 5, seed: 11)
        for _ in 0..<5 {
            let seat = SheepheadGame.seatToAct(state)!
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: seat, action: .pass, rng: &rng), .ok)
        }
        let blind = state.blind
        playHand(&state, rng: &rng)
        let winner = state.players[state.trickLog.last!.winner].name
        XCTAssertEqual(SheepheadReview.blindReveal(state),
                       "Nobody picked, so the blind was worth \(SheepheadCards.sumPoints(blind)) to \(winner) with the last trick. Blind: \(blind.map(\.name).joined(separator: ", ")).")
        XCTAssertTrue(state.result!.summary.contains("The blind held \(blind[0].name) and \(blind[1].name), worth \(SheepheadCards.sumPoints(blind)), and went to \(winner) with the last trick."))
        XCTAssertEqual(SheepheadReview.resultHeadline(state, seat: 0), "\(state.players[state.result!.winners[0]].name) wins the leaster with the fewest points.")
        XCTAssertEqual(SheepheadReview.blindReveal(position()), "")
    }

    func testHelp() {
        XCTAssertEqual(SheepheadHelp.rules.count, 8)
        XCTAssertEqual(SheepheadHelp.rules[0].heading, "The idea")
        XCTAssertTrue(SheepheadHelp.rules[1].body.contains("queen of clubs, queen of spades, queen of hearts, queen of diamonds, jack of clubs, jack of spades, jack of hearts, jack of diamonds, then ace, ten, king, nine, eight and seven of diamonds"))
        for r in SheepheadHelp.rules {
            XCTAssertFalse(r.body.contains("<"), "no markup")
            XCTAssertFalse(r.body.lowercased().contains("press "), "no key references")
        }
    }
}
