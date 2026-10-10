import XCTest
import CardCore
@testable import HeartsEngine

/// Can a seat do something that is not its to do? Mirrors
/// hearts/tests/authorization.js: a refusal happens, a refusal changes
/// NOTHING (the whole state is compared before and after), and a refusal says
/// nothing about cards the asking seat cannot see.
final class RefusalTests: XCTestCase {
    var rng = RandomSource(seed: 90210)

    /// Send an action and insist that nothing moved.
    @discardableResult
    func refused(_ s: inout HeartsState, seat: Int, _ action: HeartsAction, _ why: String,
                 file: StaticString = #filePath, line: UInt = #line) -> ActionResult? {
        let before = s
        let r = HeartsGame.applyAction(&s, seat: seat, action: action, rng: &rng)
        if r.ok {
            XCTFail("\(why) — the engine ACCEPTED it", file: file, line: line)
            return nil
        }
        XCTAssertFalse(r.fault, "\(why) — a refusal, not a fault", file: file, line: line)
        XCTAssertNotNil(r.reason, "\(why) — refused without a reason", file: file, line: line)
        XCTAssertFalse(r.reason?.isEmpty ?? true, file: file, line: line)
        XCTAssertEqual(s, before, "\(why) — refused, but the state changed anyway", file: file, line: line)
        return r
    }

    /// Does this refusal tell the asking seat something about somebody else's cards?
    func reasonIsSafe(_ s: HeartsState, seat: Int, _ reason: String?, _ where_: String,
                      file: StaticString = #filePath, line: UInt = #line) {
        guard let reason = reason else { return }
        let mine = Set(s.players[seat].hand)
        for (i, p) in s.players.enumerated() where i != seat {
            for c in p.hand where !mine.contains(c) {
                XCTAssertFalse(reason.contains(c.name),
                               "\(where_): a refusal sent to seat \(seat) names the \(c.name), which is in seat \(i)'s hand",
                               file: file, line: line)
            }
        }
    }

    func testBeforeTheGameStarts() {
        var s = HeartsGame.createGame(Support.config())
        let three = Support.cards(["2C", "3C", "4C"])
        for seat in 0..<4 {
            refused(&s, seat: seat, .play(HeartsCards.twoOfClubs), "seat \(seat) played before the deal")
            refused(&s, seat: seat, .pass(three), "seat \(seat) passed before the deal")
            refused(&s, seat: seat, .nextHand, "seat \(seat) dealt before the game started")
            refused(&s, seat: seat, .newGame, "seat \(seat) started a new game before this one")
        }
        XCTAssertEqual(HeartsGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).reason, "the hand is not over")
        for bad in [-1, 4, 99, Int.min, Int.max] {
            let r = refused(&s, seat: bad, .start, "seat \(bad) was allowed to start")
            XCTAssertEqual(r?.reason, "not a seat at this table")
        }
        XCTAssertTrue(HeartsGame.legalPlays(s, seat: 0).isEmpty)
        XCTAssertTrue(HeartsGame.legalPlays(s, seat: 9).isEmpty)
        XCTAssertNil(HeartsGame.seatToAct(s))
        XCTAssertFalse(HeartsGame.canDeal(s))
        XCTAssertNil(HeartsAI.decide(s, seat: 0, rng: &rng))
        XCTAssertNil(HeartsAI.decide(s, seat: 7, rng: &rng))
    }

    func testThePass() {
        var s = HeartsGame.createGame(Support.config())
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertEqual(s.phase, .passing)
        refused(&s, seat: 0, .start, "the game started twice")
        XCTAssertEqual(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).reason, "the game has already started")

        for seat in 0..<4 {
            let mine = Set(s.players[seat].hand)
            var others: [Card] = []
            for (i, p) in s.players.enumerated() where i != seat { others += p.hand }
            let notMine = Array(others.filter { !mine.contains($0) }.prefix(3))

            let r = refused(&s, seat: seat, .pass(notMine), "seat \(seat) passed cards from another hand")
            XCTAssertEqual(r?.reason, "you do not hold that card")
            reasonIsSafe(s, seat: seat, r?.reason, "pass of another seat's cards")

            XCTAssertEqual(refused(&s, seat: seat, .pass([]), "seat \(seat) passed nothing")?.reason, "pass exactly 3 cards")
            XCTAssertEqual(refused(&s, seat: seat, .pass(Array(s.players[seat].hand.prefix(4))), "seat \(seat) passed four")?.reason,
                           "pass exactly 3 cards")
            XCTAssertEqual(refused(&s, seat: seat, .pass(Array(s.players[seat].hand.prefix(1))), "seat \(seat) passed one")?.reason,
                           "pass exactly 3 cards")
            let h = s.players[seat].hand
            XCTAssertEqual(refused(&s, seat: seat, .pass([h[0], h[0], h[1]]), "seat \(seat) passed the same card twice")?.reason,
                           "the same card twice")
            // Two held and one not: still refused, still nothing moved.
            refused(&s, seat: seat, .pass([h[0], h[1], notMine[0]]), "seat \(seat) passed a card it does not hold")

            XCTAssertEqual(refused(&s, seat: seat, .play(h[0]), "seat \(seat) played during the pass")?.reason,
                           "no trick is in progress")
            XCTAssertEqual(refused(&s, seat: seat, .nextHand, "seat \(seat) dealt during the pass")?.reason, "the hand is not over")
            XCTAssertEqual(HeartsGame.whyNot(s, seat: seat, card: h[0]), "no trick is in progress")
        }

        // A legal pass goes through, and only once.
        for seat in 0..<4 {
            let cards = Array(s.players[seat].hand.prefix(3))
            let r = HeartsGame.applyAction(&s, seat: seat, action: .pass(cards), rng: &rng)
            XCTAssertTrue(r.ok, "a legal pass from seat \(seat) was refused: \(r.reason ?? "")")
            if s.phase == .passing {
                let again = refused(&s, seat: seat, .pass(Array(s.players[seat].hand.prefix(3))), "seat \(seat) passed twice")
                XCTAssertEqual(again?.reason, "you have already passed")
                XCTAssertNil(HeartsAI.decide(s, seat: seat, rng: &rng), "a seat that has passed has nothing to decide")
                XCTAssertEqual(HeartsGame.seatToAct(s), seat + 1)
            }
        }
        XCTAssertEqual(s.phase, .play, "four passes should have started the play")
        XCTAssertEqual(refused(&s, seat: 0, .pass(Array(s.players[0].hand.prefix(3))), "passed during play")?.reason,
                       "nothing is being passed")
    }

    func testThePlay() {
        var s = HeartsGame.createGame(Support.config())
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        while s.phase == .passing {
            let seat = HeartsGame.seatToAct(s)!
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: HeartsAI.decide(s, seat: seat, rng: &rng)!, rng: &rng).ok)
        }
        XCTAssertEqual(s.phase, .play)

        var moves = 0
        while s.phase == .play && moves < 60 {
            let onTurn = s.turn

            // EVERY other seat tries its cards. None may move the game.
            for seat in 0..<4 where seat != onTurn {
                let hand = s.players[seat].hand
                for c in hand.prefix(4) {
                    let r = refused(&s, seat: seat, .play(c), "seat \(seat) played out of turn (\(c.id))")
                    XCTAssertEqual(r?.reason, "not your turn")
                    reasonIsSafe(s, seat: seat, r?.reason, "out-of-turn play")
                    XCTAssertEqual(HeartsGame.whyNot(s, seat: seat, card: c), "not your turn")
                }
                XCTAssertTrue(HeartsGame.legalPlays(s, seat: seat).isEmpty)
                refused(&s, seat: seat, .pass(Array(hand.prefix(3))), "seat \(seat) passed during the play")
                refused(&s, seat: seat, .nextHand, "seat \(seat) dealt mid-hand")
                refused(&s, seat: seat, .start, "seat \(seat) restarted mid-hand")
            }

            // The seat on turn may not play a card it does not hold, nor an
            // illegal one, and neither refusal may move anything.
            let held = Set(s.players[onTurn].hand)
            for c in Card.fullDeck.filter({ !held.contains($0) }).prefix(5) {
                let r = refused(&s, seat: onTurn, .play(c), "seat \(onTurn) played \(c.id), which it does not hold")
                XCTAssertEqual(r?.reason, "you do not hold that card")
                reasonIsSafe(s, seat: onTurn, r?.reason, "playing a card not held")
                XCTAssertEqual(HeartsGame.whyNot(s, seat: onTurn, card: c), "you do not hold that card")
            }
            let legal = Set(HeartsGame.legalPlays(s, seat: onTurn))
            for c in s.players[onTurn].hand.filter({ !legal.contains($0) }).prefix(3) {
                let r = refused(&s, seat: onTurn, .play(c), "seat \(onTurn) played \(c.id), which the rules forbid here")
                let why = HeartsGame.whyNot(s, seat: onTurn, card: c)
                XCTAssertNotNil(why)
                XCTAssertEqual(r?.reason, why, "the refusal is the rule")
                XCTAssertTrue(["you must follow clubs", "you must follow diamonds", "you must follow spades",
                               "you must follow hearts", "no points on the first trick",
                               "the two of clubs must be led first", "hearts have not been broken"].contains(why ?? ""),
                              "unexpected reason: \(why ?? "")")
                reasonIsSafe(s, seat: onTurn, r?.reason, "illegal play")
            }
            for c in legal { XCTAssertNil(HeartsGame.whyNot(s, seat: onTurn, card: c)) }

            let a = HeartsAI.decide(s, seat: onTurn, rng: &rng)!
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: onTurn, action: a, rng: &rng).ok)
            moves += 1
        }
        XCTAssertGreaterThan(moves, 20)
    }

    func testBetweenHandsAndAfterTheGame() {
        var s = HeartsGame.createGame(Support.config(pointsToWin: 50))
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        var sawHandOver = false
        var guard_ = 0
        let three = Support.cards(["2C", "3C", "4C"])
        while s.phase != .gameOver && guard_ < 5000 {
            guard_ += 1
            if s.phase == .handOver {
                sawHandOver = true
                for seat in 0..<4 {
                    refused(&s, seat: seat, .play(HeartsCards.twoOfClubs), "seat \(seat) played between hands")
                    refused(&s, seat: seat, .pass(three), "seat \(seat) passed between hands")
                    refused(&s, seat: seat, .start, "seat \(seat) restarted a game in progress")
                }
                // Dealing the next hand is open to any seated player.
                XCTAssertTrue(HeartsGame.applyAction(&s, seat: 2, action: .nextHand, rng: &rng).ok)
                continue
            }
            let seat = HeartsGame.seatToAct(s)!
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: HeartsAI.decide(s, seat: seat, rng: &rng)!, rng: &rng).ok)
        }
        XCTAssertTrue(sawHandOver)
        XCTAssertEqual(s.phase, .gameOver)

        // A finished game is finished.
        for seat in 0..<4 {
            refused(&s, seat: seat, .play(HeartsCards.twoOfClubs), "seat \(seat) played after the game")
            refused(&s, seat: seat, .nextHand, "seat \(seat) dealt after the game")
            refused(&s, seat: seat, .pass(three), "seat \(seat) passed after the game")
            refused(&s, seat: seat, .start, "seat \(seat) started over a finished game")
        }
        XCTAssertFalse(HeartsGame.canDeal(s))
        XCTAssertNil(HeartsGame.seatToAct(s))
        // The only way on is a new game.
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .newGame, rng: &rng).ok)
        XCTAssertEqual(s.phase, .idle)
    }

    func testABrokenTableIsAFaultNotARefusal() {
        var s = HeartsGame.createGame(Support.config())
        s.players.removeLast()
        let r = HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.fault)
    }
}
