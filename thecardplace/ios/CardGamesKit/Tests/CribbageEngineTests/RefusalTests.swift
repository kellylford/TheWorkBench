import XCTest
import CardCore
@testable import CribbageEngine

/// The wrong seat, the wrong phase, a card not held: each refused with a
/// reason, and the state compared before and after.
final class RefusalTests: XCTestCase {
    private func refuse(_ state: inout CribbageState, _ rng: inout RandomSource, seat: Int,
                        _ action: CribbageAction, _ reason: String, file: StaticString = #filePath, line: UInt = #line) {
        let before = state
        let rngBefore = rng
        let r = CribbageGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        XCTAssertFalse(r.ok, "\(action) was accepted", file: file, line: line)
        XCTAssertFalse(r.fault, file: file, line: line)
        XCTAssertEqual(r.reason, reason, file: file, line: line)
        XCTAssertEqual(state, before, "the state changed on a refusal", file: file, line: line)
        _ = rngBefore
    }

    func testBeforeTheGameStarts() {
        var rng = RandomSource(seed: 1)
        var state = CribbageGame.createGame(Sim.config(.normal, 121))
        refuse(&state, &rng, seat: 2, .start, "not a seat at this table")
        refuse(&state, &rng, seat: -1, .start, "not a seat at this table")
        refuse(&state, &rng, seat: 0, .cut, "there is nothing to cut for")
        refuse(&state, &rng, seat: 0, .discard(cards("AS", "2S")), "it is not the discard")
        refuse(&state, &rng, seat: 0, .play(card("AS")), "it is not the play")
        refuse(&state, &rng, seat: 0, .go, "it is not the play")
        refuse(&state, &rng, seat: 0, .next, "there is nothing to count")
        refuse(&state, &rng, seat: 0, .nextHand, "the hand is not over")
        refuse(&state, &rng, seat: 0, .newGame, "the game is not over")
        XCTAssertNil(CribbageGame.seatToAct(state))
        XCTAssertFalse(CribbageGame.canDeal(state))
        XCTAssertEqual(CribbageGame.legalPlays(state, seat: 0), [])
        XCTAssertEqual(CribbageGame.whyNot(state, seat: 0, card: card("AS")), "it is not the play")

        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng), .ok)
        refuse(&state, &rng, seat: 0, .start, "the game has already started")
        refuse(&state, &rng, seat: 1, .nextHand, "the hand is not over")
    }

    func testTheDiscard() {
        var rng = RandomSource(seed: 3)
        var state = CribbageGame.createGame(Sim.config(.normal, 121))
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .discard && $0.seatsOutstanding.count == 2 })
        let hand = state.players[0].hand
        let notMine = state.players[1].hand[0]
        refuse(&state, &rng, seat: 0, .discard([hand[0]]), "choose exactly two cards")
        refuse(&state, &rng, seat: 0, .discard([hand[0], hand[1], hand[2]]), "choose exactly two cards")
        refuse(&state, &rng, seat: 0, .discard([hand[0], hand[0]]), "choose two different cards")
        refuse(&state, &rng, seat: 0, .discard([hand[0], notMine]), "the \(notMine.name) is not in your hand")
        refuse(&state, &rng, seat: 0, .play(hand[0]), "it is not the play")
        refuse(&state, &rng, seat: 0, .go, "it is not the play")
        refuse(&state, &rng, seat: 0, .cut, "there is nothing to cut for")
        refuse(&state, &rng, seat: 0, .next, "there is nothing to count")
        refuse(&state, &rng, seat: 0, .nextHand, "the hand is not over")
        XCTAssertEqual(CribbageGame.seatToAct(state), 0)

        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .discard([hand[0], hand[1]]), rng: &rng), .ok)
        XCTAssertEqual(state.phase, .discard, "the hand waits for the other throw")
        XCTAssertEqual(state.players[0].hand.count, 4)
        XCTAssertEqual(state.crib, [], "the crib is not formed until both are in")
        XCTAssertEqual(CribbageGame.seatToAct(state), 1)
        refuse(&state, &rng, seat: 0, .discard([hand[2], hand[3]]), "you have already thrown to the crib")
        // Seat 0 cannot throw for seat 1.
        let theirs = state.players[1].hand
        refuse(&state, &rng, seat: 0, .discard([theirs[0], theirs[1]]), "you have already thrown to the crib")
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 1, action: .discard([theirs[0], theirs[1]]), rng: &rng), .ok)
        XCTAssertEqual(state.phase, .play)
        XCTAssertEqual(state.crib.count, 4)
        XCTAssertNotNil(state.starter)
        XCTAssertEqual(state.deck.count, 39)
        XCTAssertEqual(state.turn, 1 - state.dealer!)
    }

    func testThePlay() {
        var rng = RandomSource(seed: 11)
        var state = CribbageGame.createGame(Sim.config(.hard, 121))
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .play && $0.pile.isEmpty })
        let me = state.turn, them = 1 - me
        let mine = state.players[me].hand[0]
        let theirs = state.players[them].hand[0]
        refuse(&state, &rng, seat: them, .play(theirs), "not your turn")
        refuse(&state, &rng, seat: them, .go, "not your turn")
        refuse(&state, &rng, seat: me, .play(theirs), "that card is not in your hand")
        refuse(&state, &rng, seat: me, .go, "you have a card you can play, so you must play it")
        refuse(&state, &rng, seat: me, .discard([mine, state.players[me].hand[1]]), "it is not the discard")
        refuse(&state, &rng, seat: me, .next, "there is nothing to count")
        refuse(&state, &rng, seat: me, .nextHand, "the hand is not over")
        refuse(&state, &rng, seat: me, .newGame, "the game is not over")
        XCTAssertEqual(CribbageGame.legalPlays(state, seat: them), [])
        XCTAssertEqual(CribbageGame.whyNot(state, seat: them, card: theirs), "it is not your turn")
        XCTAssertNil(CribbageGame.whyNot(state, seat: me, card: mine))
    }

    func testACardThatWouldPassThirtyOne() {
        // Find a position where the seat to act holds a card too big to play.
        var found = false
        for seed in 20..<80 where !found {
            var rng = RandomSource(seed: UInt64(seed))
            var state = CribbageGame.createGame(Sim.config(.hard, 121))
            let ok = advance(&state, &rng) { s in
                s.phase == .play && s.players[s.turn].hand.contains { s.count + CribbageCards.value($0) > 31 }
                    && !CribbageGame.legalPlays(s, seat: s.turn).isEmpty
            }
            guard ok else { continue }
            found = true
            let me = state.turn
            let big = state.players[me].hand.first { state.count + CribbageCards.value($0) > 31 }!
            let to = state.count + CribbageCards.value(big)
            let reason = "it would take the count to " + CribbageCards.numberWord(to) + ", past thirty-one"
            refuse(&state, &rng, seat: me, .play(big), reason)
            XCTAssertEqual(CribbageGame.whyNot(state, seat: me, card: big), reason)
            XCTAssertFalse(CribbageGame.legalPlays(state, seat: me).contains(big))
            refuse(&state, &rng, seat: me, .go, "you have a card you can play, so you must play it")
        }
        XCTAssertTrue(found, "no position with an unplayable card was found")
    }

    func testTheGoIsOnlyForSomebodyWhoCannotPlay() {
        var found = false
        for seed in 100..<160 where !found {
            var rng = RandomSource(seed: UInt64(seed))
            var state = CribbageGame.createGame(Sim.config(.hard, 121))
            let ok = advance(&state, &rng) { s in
                s.phase == .play && !s.players[s.turn].hand.isEmpty && CribbageGame.legalPlays(s, seat: s.turn).isEmpty
            }
            guard ok else { continue }
            found = true
            let me = state.turn
            let held = state.players[me].hand[0]
            refuse(&state, &rng, seat: me, .play(held),
                   "it would take the count to " + CribbageCards.numberWord(state.count + CribbageCards.value(held)) + ", past thirty-one")
            refuse(&state, &rng, seat: 1 - me, .go, "not your turn")
            let scoreBefore = state.players.map(\.score)
            XCTAssertEqual(CribbageGame.applyAction(&state, seat: me, action: .go, rng: &rng), .ok)
            XCTAssertTrue(state.log.events.last!.text.hasSuffix("go.") || state.log.events.contains { $0.text.contains(" go.") })
            // A go itself scores nobody anything; only a mutual go pays the point.
            let after = state.players.map(\.score)
            XCTAssertGreaterThanOrEqual(after[0] + after[1], scoreBefore[0] + scoreBefore[1])
        }
        XCTAssertTrue(found)
    }

    func testTheCount() {
        var rng = RandomSource(seed: 9)
        var state = CribbageGame.createGame(Sim.config(.normal, 121))
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .count })
        let dealer = state.dealer!
        XCTAssertEqual(state.turn, 1 - dealer, "the non-dealer counts first")
        XCTAssertEqual(state.countStage, 0)
        refuse(&state, &rng, seat: dealer, .next, "it is not your count")
        refuse(&state, &rng, seat: 1 - dealer, .play(state.players[1 - dealer].kept[0]), "it is not the play")
        refuse(&state, &rng, seat: 1 - dealer, .nextHand, "the hand is not over")
        XCTAssertEqual(CribbageGame.legalPlays(state, seat: 1 - dealer), [])
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 1 - dealer, action: .next, rng: &rng), .ok)
        if state.phase == .count {
            XCTAssertEqual(state.turn, dealer)
            XCTAssertEqual(state.countStage, 1)
            refuse(&state, &rng, seat: 1 - dealer, .next, "it is not your count")
            XCTAssertEqual(CribbageGame.applyAction(&state, seat: dealer, action: .next, rng: &rng), .ok)
        }
        if state.phase == .count {
            XCTAssertEqual(state.countStage, 2)
            XCTAssertEqual(CribbageGame.applyAction(&state, seat: dealer, action: .next, rng: &rng), .ok)
        }
        XCTAssertTrue(state.phase == .roundOver || state.phase == .gameOver)
        XCTAssertTrue(CribbageGame.canDeal(state))
        XCTAssertNil(CribbageGame.seatToAct(state))
        refuse(&state, &rng, seat: 0, .next, "there is nothing to count")
        refuse(&state, &rng, seat: 0, .play(card("AS")), "it is not the play")
        if state.phase == .roundOver {
            refuse(&state, &rng, seat: 0, .newGame, "the game is not over")
            XCTAssertEqual(state.history.count, 1)
            XCTAssertEqual(state.dealer, 1 - dealer, "the deal passes")
        }
    }

    func testABrokenStateFaults() {
        var rng = RandomSource(seed: 1)
        var state = CribbageGame.createGame(Sim.config(.normal, 121))
        state.players.removeLast()
        let r = CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
        XCTAssertTrue(r.fault)
        XCTAssertFalse(r.ok)
    }
}
