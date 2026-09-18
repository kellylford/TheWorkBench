import XCTest
import CardCore
import SpadesEngine

/// The wrong seat, the wrong phase, a card not held: each refused with a
/// reason and the state unchanged. A refusal that has already happened is not
/// a refusal, so every one is compared against the state before it.
final class SpadesRefusalTests: XCTestCase {

    @discardableResult
    func mustRefuse(_ state: inout SpadesState, seat: Int, _ action: SpadesAction, _ what: String,
                    file: StaticString = #filePath, line: UInt = #line) -> ActionResult {
        let before = state
        var rng = RandomSource(seed: 99)
        let r = SpadesGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        XCTAssertFalse(r.ok, "\(what) was accepted", file: file, line: line)
        XCTAssertFalse(r.fault, "\(what) faulted rather than refused", file: file, line: line)
        XCTAssertNotNil(r.reason, "\(what) was refused with no reason", file: file, line: line)
        XCTAssertFalse(r.reason?.isEmpty ?? true, file: file, line: line)
        XCTAssertEqual(state, before, "\(what) was refused but the state changed", file: file, line: line)
        return r
    }

    func testNothingIsAcceptedBeforeTheGameStarts() {
        var state = SpadesGame.createGame(SpadesConfig(names: testNames))
        XCTAssertEqual(mustRefuse(&state, seat: 0, .play(card("AS")), "a card at idle").reason, "no trick is in progress")
        XCTAssertEqual(mustRefuse(&state, seat: 0, .bid(3), "a bid at idle").reason, "nobody is bidding")
        XCTAssertEqual(mustRefuse(&state, seat: 0, .nextHand, "a deal at idle").reason, "the hand is not over")
        XCTAssertEqual(mustRefuse(&state, seat: 0, .newGame, "a new game at idle").reason, "the game has not started")
        XCTAssertEqual(mustRefuse(&state, seat: 9, .start, "seat 9").reason, "not a seat at this table")
        XCTAssertEqual(mustRefuse(&state, seat: -1, .start, "seat -1").reason, "not a seat at this table")
        XCTAssertEqual(mustRefuse(&state, seat: 4, .bid(1), "seat 4").reason, "not a seat at this table")
    }

    func testTheBidding() {
        var (state, rng) = Drive.newGame(seed: 77)
        XCTAssertEqual(state.phase, .bidding)
        XCTAssertEqual(mustRefuse(&state, seat: 0, .start, "a second start").reason, "the game has already started")

        for round in 0..<4 {
            let turn = state.turn
            for other in 0..<4 where other != turn {
                for n in [0, 1, 5, 13] {
                    XCTAssertEqual(mustRefuse(&state, seat: other, .bid(n), "seat \(other) bidding out of turn").reason,
                                   "not your turn to bid")
                }
                XCTAssertEqual(mustRefuse(&state, seat: other, .play(state.players[other].hand[0]), "a card during the bidding").reason,
                               "no trick is in progress")
            }
            for bad in [-1, 14, 100] {
                XCTAssertEqual(mustRefuse(&state, seat: turn, .bid(bad), "a bid of \(bad)").reason,
                               "a bid is a whole number from zero to 13")
            }
            XCTAssertNil(state.players[turn].bid, "a refused bid was recorded anyway")
            mustRefuse(&state, seat: turn, .play(state.players[turn].hand[0]), "the bidder playing a card")
            XCTAssertEqual(mustRefuse(&state, seat: turn, .nextHand, "a deal during the bidding").reason, "the hand is not over")

            XCTAssertTrue(SpadesGame.applyAction(&state, seat: turn, action: .bid(round), rng: &rng).ok)
            if state.phase == .bidding {
                XCTAssertEqual(mustRefuse(&state, seat: turn, .bid(2), "bidding twice").reason, "not your turn to bid")
            }
        }
        XCTAssertEqual(state.phase, .play)
        XCTAssertEqual(SpadesGame.legalBids(state, seat: state.turn), [])
    }

    func testEverySeatIsOfferedEveryCardAtEveryPositionOfAHand() {
        var (state, rng) = Drive.toPlay(SpadesConfig(names: testNames, pointsToWin: 250), seed: 78)
        var positions = 0
        while state.phase == .play {
            positions += 1
            let turn = state.turn
            let legal = Set(SpadesGame.legalPlays(state, seat: turn))

            for other in 0..<4 where other != turn {
                for c in state.players[other].hand.prefix(3) {
                    XCTAssertEqual(mustRefuse(&state, seat: other, .play(c), "seat \(other) playing out of turn").reason, "not your turn")
                }
                XCTAssertEqual(mustRefuse(&state, seat: other, .bid(1), "a bid during play").reason, "nobody is bidding")
                XCTAssertEqual(mustRefuse(&state, seat: other, .nextHand, "a deal mid-hand").reason, "the hand is not over")
            }

            let held = Set(state.players[turn].hand)
            for c in SpadesCards.newDeck() where !legal.contains(c) {
                let r = mustRefuse(&state, seat: turn, .play(c), "playing \(c.id)")
                if held.contains(c) {
                    XCTAssertTrue(["you must follow clubs", "you must follow diamonds", "you must follow hearts",
                                   "you must follow spades", "spades have not been broken", "not a legal card here"]
                                    .contains(r.reason ?? ""), "held but illegal: \(r.reason ?? "")")
                    XCTAssertEqual(SpadesGame.whyNot(state, seat: turn, card: c), r.reason)
                } else {
                    XCTAssertEqual(r.reason, "you do not hold that card")
                    XCTAssertEqual(SpadesGame.whyNot(state, seat: turn, card: c), "you do not hold that card")
                }
            }
            for c in legal { XCTAssertNil(SpadesGame.whyNot(state, seat: turn, card: c)) }

            let pick = SpadesAI.chooseCard(state, seat: turn)!
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: turn, action: .play(pick), rng: &rng).ok)
        }
        XCTAssertEqual(positions, 52)
        XCTAssertTrue(state.phase == .handOver || state.phase == .gameOver)
        for s in 0..<4 {
            mustRefuse(&state, seat: s, .bid(3), "a bid at handOver")
            mustRefuse(&state, seat: s, .play(card("AS")), "a card at handOver")
            mustRefuse(&state, seat: s, .start, "a start at handOver")
        }
        if state.phase == .handOver {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: 3, action: .nextHand, rng: &rng).ok, "any seat may deal")
        }
    }

    func testWhyNotNamesTheRule() {
        // North leads, spades not broken, holding a spade and a club.
        var state = position(bids: [3, 3, 3, 3], tricks: [0, 0, 0, 0],
                             hands: ["AS 2C", "3C 4D", "5C 6C", "7C 8C"], leader: 0, tricksPlayed: 0)
        XCTAssertEqual(SpadesGame.whyNot(state, seat: 0, card: card("AS")), "spades have not been broken")
        XCTAssertNil(SpadesGame.whyNot(state, seat: 0, card: card("2C")))
        XCTAssertEqual(SpadesGame.whyNot(state, seat: 1, card: card("3C")), "not your turn")
        var rng = RandomSource(seed: 1)
        XCTAssertEqual(SpadesGame.applyAction(&state, seat: 0, action: .play(card("AS")), rng: &rng).reason,
                       "spades have not been broken")
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .play(card("2C")), rng: &rng).ok)
        // East holds a club and a diamond; clubs were led.
        XCTAssertEqual(SpadesGame.whyNot(state, seat: 1, card: card("4D")), "you must follow clubs")
        XCTAssertEqual(SpadesGame.applyAction(&state, seat: 1, action: .play(card("4D")), rng: &rng).reason,
                       "you must follow clubs")
        XCTAssertEqual(state.players[1].hand.count, 2, "a refused play removed the card")
    }

    /// A refusal may not name a card the asker cannot see: the same refusal
    /// for every card not held, and the same words whatever the other seats
    /// hold.
    func testRefusalsAreNotASideChannel() {
        let (state, _) = Drive.toPlay(seed: 79)
        let turn = state.turn
        let mine = Set(state.players[turn].hand)
        for c in SpadesCards.newDeck() where !mine.contains(c) {
            var probe = state
            var rng = RandomSource(seed: 1)
            let r = SpadesGame.applyAction(&probe, seat: turn, action: .play(c), rng: &rng)
            XCTAssertFalse(r.ok)
            XCTAssertEqual(r.reason, "you do not hold that card", "asking for \(c.id) said more than that it is not held")
        }

        // Move the other three hands around and ask again.
        var scrambled = state
        var pool: [Card] = []
        for i in 0..<4 where i != turn { pool += scrambled.players[i].hand }
        pool.reverse()
        var k = 0
        for i in 0..<4 where i != turn {
            let n = scrambled.players[i].hand.count
            scrambled.players[i].hand = Array(pool[k..<(k + n)])
            k += n
        }
        for c in SpadesCards.newDeck() {
            var a = state, b = scrambled
            var r1 = RandomSource(seed: 1), r2 = RandomSource(seed: 1)
            let ra = SpadesGame.applyAction(&a, seat: turn, action: .play(c), rng: &r1)
            let rb = SpadesGame.applyAction(&b, seat: turn, action: .play(c), rng: &r2)
            XCTAssertEqual(ra.ok, rb.ok)
            XCTAssertEqual(ra.reason, rb.reason, "the refusal for \(c.id) changed when other seats' cards moved")
        }
    }
}
