import XCTest
import CardCore
@testable import EuchreEngine

/// Hundreds of complete hands played by the AI on every difficulty, every
/// stick-the-dealer and going-alone setting, with seeded randomness: never an
/// illegal play, every card accounted for once, tricks total what they must,
/// scoring is what the table says, the game always reaches an end.
final class EuchreInvariantsTests: XCTestCase {
    func checkHand(_ s: EuchreState, stick: Bool, aloneAllowed: Bool,
                   file: StaticString = #filePath, line: UInt = #line) {
        guard let h = s.history.last else {
            XCTFail("no record of the hand", file: file, line: line)
            return
        }
        XCTAssertEqual(h.problems, [], "the accounting check failed", file: file, line: line)

        // Every card dealt exactly once, and the whole deck accounted for.
        var all = h.dealt.flatMap { $0 } + h.kitty
        if let up = h.upcard { all.append(up) }
        XCTAssertEqual(all.count, 24, file: file, line: line)
        XCTAssertEqual(Set(all), Set(EuchreCards.deck), "the deal is not the deck", file: file, line: line)
        XCTAssertEqual(h.kitty.count, 3, file: file, line: line)
        for hand in h.dealt { XCTAssertEqual(hand.count, 5, file: file, line: line) }

        if h.result.thrownIn {
            XCTAssertFalse(stick, "a hand was thrown in with stick the dealer on", file: file, line: line)
            XCTAssertTrue(h.tricks.isEmpty, file: file, line: line)
            XCTAssertEqual(h.result.deltas, [0, 0], file: file, line: line)
            XCTAssertNil(h.trump, file: file, line: line)
            XCTAssertNil(h.maker, file: file, line: line)
            XCTAssertEqual(s.phase, .handOver, file: file, line: line)
            return
        }

        XCTAssertEqual(h.tricks.count, 5, file: file, line: line)
        XCTAssertEqual(h.tricksWon.reduce(0, +), 5, "tricks must total five", file: file, line: line)
        XCTAssertNotNil(h.trump, file: file, line: line)
        XCTAssertNotNil(h.maker, file: file, line: line)

        // Exactly one side scores, and by 1, 2 or 4.
        let nonZero = h.result.deltas.filter { $0 != 0 }
        XCTAssertEqual(nonZero.count, 1, "exactly one side scores on a hand: \(h.result.deltas)", file: file, line: line)
        XCTAssertTrue([1, 2, 4].contains(nonZero.first ?? 0), "a hand scores 1, 2 or 4: \(h.result.deltas)", file: file, line: line)
        if nonZero.first == 4 { XCTAssertTrue(h.alone, "four points only ever follow somebody going alone", file: file, line: line) }
        if !aloneAllowed { XCTAssertFalse(h.alone, "somebody went alone with going alone off", file: file, line: line) }
        XCTAssertEqual(h.scores, s.scores, file: file, line: line)

        if h.alone {
            XCTAssertEqual(h.sittingOut, EuchreGame.partnerOf(h.maker!), file: file, line: line)
            for t in h.tricks {
                XCTAssertEqual(t.plays.count, 3, file: file, line: line)
                XCTAssertFalse(t.plays.contains { $0.player == h.sittingOut }, "a seat sitting out played a card", file: file, line: line)
            }
            XCTAssertEqual(s.players[h.sittingOut!].hand.count, 5, "the seat sitting out keeps its five cards", file: file, line: line)
        } else {
            XCTAssertNil(h.sittingOut, file: file, line: line)
            for t in h.tricks { XCTAssertEqual(t.plays.count, 4, file: file, line: line) }
        }
        for i in 0..<4 where i != h.sittingOut {
            XCTAssertTrue(s.players[i].hand.isEmpty, "seat \(i) finished the hand holding cards", file: file, line: line)
        }
        // The dealer always ends up with a discard when the upcard was taken.
        if !h.turnedDown {
            XCTAssertNotNil(h.discard, "the upcard was taken but nothing was put back", file: file, line: line)
        } else {
            XCTAssertNil(h.discard, file: file, line: line)
        }
    }

    func testHundredsOfHandsOnEveryDifficultyAndSetting() {
        var seed: UInt64 = 1000
        var handsPlayed = 0
        var gamesPlayed = 0
        for difficulty in Difficulty.allCases {
            for stick in [false, true] {
                for aloneAllowed in [true, false] {
                    for _ in 0..<6 {
                        seed += 1
                        var rng = RandomSource(seed: seed)
                        var s = EuchreGame.createGame(Support.config(difficulty: difficulty, stick: stick, alone: aloneAllowed))
                        XCTAssertEqual(s.phase, .idle)
                        XCTAssertNil(EuchreGame.seatToAct(s))
                        var hands = 0
                        while s.phase != .gameOver && hands < 200 {
                            Support.playHand(&s, rng: &rng)
                            hands += 1
                            checkHand(s, stick: stick, aloneAllowed: aloneAllowed)
                        }
                        XCTAssertEqual(s.phase, .gameOver, "a game never ended (seed \(seed))")
                        guard let win = s.gameWinner else { XCTFail("no winner"); continue }
                        XCTAssertGreaterThanOrEqual(s.scores[win], 10)
                        XCTAssertGreaterThan(s.scores[win], s.scores[1 - win])
                        XCTAssertEqual(s.gamesWon.reduce(0, +), 1)
                        XCTAssertEqual(s.history.count, hands)
                        XCTAssertFalse(EuchreGame.canDeal(s))
                        handsPlayed += hands
                        gamesPlayed += 1
                    }
                }
            }
        }
        XCTAssertGreaterThan(handsPlayed, 300)
        XCTAssertEqual(gamesPlayed, 72)
    }

    func testOtherTargetsEndTheGame() {
        for points in [5, 11, 15] {
            var rng = RandomSource(seed: UInt64(points) * 31)
            var s = EuchreGame.createGame(Support.config(points: points))
            var hands = 0
            while s.phase != .gameOver && hands < 300 {
                Support.playHand(&s, rng: &rng)
                hands += 1
            }
            XCTAssertEqual(s.phase, .gameOver)
            XCTAssertGreaterThanOrEqual(s.scores[s.gameWinner ?? 0], points)
        }
    }

    func testSeededGamesReplayIdentically() {
        func play(_ seed: UInt64) -> EuchreState {
            var rng = RandomSource(seed: seed)
            var s = EuchreGame.createGame(Support.config(difficulty: .easy))
            while s.phase != .gameOver { Support.playHand(&s, rng: &rng) }
            return s
        }
        let a = play(77), b = play(77), c = play(78)
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.log.events.map(\.text), b.log.events.map(\.text))
        XCTAssertNotEqual(a.log.events.map(\.text), c.log.events.map(\.text))
    }

    /// The dealer takes the upcard whoever ordered it — even when the dealer is
    /// sitting out because their partner went alone. The rule most often got
    /// wrong.
    func testDealerStillDiscardsWhenSittingOut() {
        var rng = RandomSource(seed: 5)
        var s = EuchreGame.createGame(Support.config(names: ["Kim", "Ruth", "Dale", "Marta"]))
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        let dealer = s.dealer!
        let partner = EuchreGame.partnerOf(dealer)
        // Pass round to the dealer's partner.
        while s.turn != partner {
            XCTAssertTrue(EuchreGame.applyAction(&s, seat: s.turn, action: .pass, rng: &rng).ok)
        }
        let r = EuchreGame.applyAction(&s, seat: partner, action: .orderUp(alone: true), rng: &rng)
        XCTAssertTrue(r.ok)
        XCTAssertEqual(s.phase, .discard)
        XCTAssertEqual(s.maker, partner)
        XCTAssertTrue(s.alone)
        XCTAssertEqual(s.sittingOut, dealer)
        XCTAssertEqual(EuchreGame.seatToAct(s), dealer, "the discard belongs to the dealer even while sitting out")
        XCTAssertEqual(s.players[dealer].hand.count, 6)
        XCTAssertTrue(s.players[dealer].hand.contains(s.upcard!))
        XCTAssertEqual(s.log.events.last(where: { $0.kind == .bid })?.text,
                       "\(s.players[partner].name) orders it up for \(s.players[dealer].name). " +
                       "\(s.upcard!.suit.name) are trump. \(s.players[partner].name) is going alone, so " +
                       "\(s.players[dealer].name) sits out this hand.")

        // A non-dealer may not discard; the dealer may.
        XCTAssertEqual(EuchreGame.applyAction(&s, seat: partner, action: .discard(s.players[dealer].hand[0]), rng: &rng).reason,
                       "only the dealer discards")
        let d = EuchreAI.decide(s, seat: dealer, rng: &rng)!
        guard case .discard(let put) = d else { return XCTFail("the dealer should discard, not \(d)") }
        XCTAssertFalse(EuchreCards.isTrump(put, trump: s.trump), "the computer never puts trump back")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: dealer, action: d, rng: &rng).ok)
        XCTAssertEqual(s.phase, .play)
        XCTAssertEqual(s.players[dealer].hand.count, 5)
        XCTAssertNotEqual(s.leader, dealer)
        XCTAssertEqual(EuchreGame.legalPlays(s, seat: dealer), [])

        Support.drive(&s, rng: &rng, until: Support.handIsOver)
        let h = s.history.last!
        XCTAssertEqual(h.problems, [])
        for t in h.tricks {
            XCTAssertEqual(t.plays.count, 3)
            XCTAssertFalse(t.plays.contains { $0.player == dealer })
        }
    }

    func testGoingAloneIsIgnoredWhenTheRuleIsOff() {
        var rng = RandomSource(seed: 9)
        var s = EuchreGame.createGame(Support.config(alone: false))
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        let r = EuchreGame.applyAction(&s, seat: s.turn, action: .orderUp(alone: true), rng: &rng)
        XCTAssertTrue(r.ok)
        XCTAssertFalse(s.alone)
        XCTAssertNil(s.sittingOut)
        XCTAssertEqual(EuchreGame.activeCount(s), 4)
    }

    func testStickTheDealerForcesTheDealerToName() {
        var rng = RandomSource(seed: 11)
        var s = EuchreGame.createGame(Support.config(stick: true))
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        for _ in 0..<7 { XCTAssertTrue(EuchreGame.applyAction(&s, seat: s.turn, action: .pass, rng: &rng).ok) }
        XCTAssertEqual(s.phase, .bid2)
        XCTAssertEqual(s.turn, s.dealer)
        let before = s
        let r = EuchreGame.applyAction(&s, seat: s.dealer!, action: .pass, rng: &rng)
        XCTAssertEqual(r.reason, "stick the dealer is on, so you must name a suit")
        XCTAssertEqual(s, before)
        let d = EuchreAI.decide(s, seat: s.dealer!, rng: &rng)!
        guard case .callSuit(let suit, _) = d else { return XCTFail("the stuck dealer must name a suit, not \(d)") }
        XCTAssertNotEqual(suit, s.deniedSuit)
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: s.dealer!, action: d, rng: &rng).ok)
        XCTAssertEqual(s.phase, .play)
    }

    func testEverybodyPassingTwiceThrowsTheHandIn() {
        var rng = RandomSource(seed: 12)
        var s = EuchreGame.createGame(Support.config(stick: false))
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        let dealer = s.dealer!
        for _ in 0..<8 { XCTAssertTrue(EuchreGame.applyAction(&s, seat: s.turn, action: .pass, rng: &rng).ok) }
        XCTAssertEqual(s.phase, .handOver)
        XCTAssertTrue(s.result?.thrownIn ?? false)
        XCTAssertEqual(s.scores, [0, 0])
        XCTAssertTrue(EuchreGame.canDeal(s))
        XCTAssertEqual(s.log.events.last?.text,
                       "Everybody passed twice. The hand is thrown in and nobody scores. " +
                       "\(s.players[(dealer + 1) % 4].name) deals the next one.")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).ok)
        XCTAssertEqual(s.dealer, (dealer + 1) % 4)
        XCTAssertEqual(s.handNumber, 2)
    }

    func testNewGameKeepsTheMatchRecord() {
        var rng = RandomSource(seed: 21)
        var s = EuchreGame.createGame(Support.config(points: 5))
        while s.phase != .gameOver { Support.playHand(&s, rng: &rng) }
        let won = s.gamesWon
        let games = s.gameNumber
        let dealer = s.dealer
        XCTAssertEqual(EuchreGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).reason,
                       "the game is over — start a new game")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .newGame, rng: &rng).ok)
        XCTAssertEqual(s.phase, .idle)
        XCTAssertEqual(s.scores, [0, 0])
        XCTAssertEqual(s.gamesWon, won)
        XCTAssertEqual(s.gameNumber, games + 1)
        XCTAssertEqual(s.handNumber, 0)
        XCTAssertEqual(s.dealer, dealer)
        XCTAssertNil(s.gameWinner)
        XCTAssertEqual(s.players.map(\.name), Support.names)
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertEqual(s.phase, .bid1)
        XCTAssertEqual(s.handNumber, 1)
    }

    func testEventWordingOnTheDeal() {
        var rng = RandomSource(seed: 3)
        var s = EuchreGame.createGame(Support.config())
        XCTAssertEqual(s.log.events(for: 0).map(\.text),
                       ["Euchre to 10 points. You are in seat 1; Dale is your partner, across the table. Ruth and Marta are against you."])
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        let dealer = s.dealer!, first = (dealer + 1) % 4
        let dealLine = s.log.events.first { $0.kind == .deal }!
        XCTAssertEqual(dealLine.text,
                       "Hand 1. \(s.players[dealer].name)\(dealer == 0 ? " deal" : " deals"). " +
                       "The upcard is the \(s.upcard!.name). \(s.players[first].name)\(first == 0 ? " bid" : " bids") first.")
        XCTAssertEqual(dealLine.cards, [s.upcard!])
        let privateHands = s.log.events.filter { $0.kind == .you }
        XCTAssertEqual(privateHands.count, 4)
        for e in privateHands {
            XCTAssertNotNil(e.audience)
            XCTAssertEqual(e.text, "Your hand: " + EuchreCards.sortHand(s.players[e.audience!].hand, trump: nil)
                .map(\.name).joined(separator: ", ") + ".")
        }
        // Seat 0 hears only its own hand.
        XCTAssertEqual(s.log.events(for: 0).filter { $0.kind == .you }.count, 1)

        // Ordering up names both bowers for the whole table.
        let up = s.upcard!
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: first, action: .orderUp(alone: false), rng: &rng).ok)
        XCTAssertTrue(s.log.events.contains { $0.text ==
            "The right bower is the Jack of \(up.suit.name); the left bower is the Jack of \(up.suit.sameColour.name), " +
            "which counts as \(up.suit.lowerName) for this hand." })
        XCTAssertTrue(s.log.events.contains { $0.text ==
            "\(s.players[dealer].name)\(dealer == 0 ? " take" : " takes") the \(up.name) and must discard." })
        XCTAssertTrue(s.log.events.contains { $0.audience == dealer && $0.text ==
            "You took the \(up.name). Choose a card to put back — you have six and may keep only five." })
    }

    func testPlayAndTrickEventsNameTheBowers() {
        var s = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades,
                                 hands: [["JC", "9H"], ["JS", "TH"], ["AS", "KH"], ["9S", "QH"]],
                                 upcard: "TS", upcardStatus: .taken, maker: 0)
        var rng = RandomSource(seed: 1)
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .play(Support.card("JC")), rng: &rng).ok)
        XCTAssertEqual(s.log.events.last?.text,
                       "You play the Jack of Clubs, left bower, second highest trump, counts as spades.")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 1, action: .play(Support.card("JS")), rng: &rng).ok)
        XCTAssertEqual(s.log.events.last?.text, "Ruth plays the Jack of Spades, right bower, the highest trump.")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 2, action: .play(Support.card("AS")), rng: &rng).ok)
        XCTAssertEqual(s.log.events.last?.text, "Dale plays the Ace of Spades, trump.")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 3, action: .play(Support.card("9S")), rng: &rng).ok)
        XCTAssertEqual(s.log.events.last?.text, "Ruth takes trick 1 with the Jack of Spades, right bower, the highest trump.")
        XCTAssertEqual(s.turn, 1)
        XCTAssertEqual(s.lastTrick?.winner, 1)
        XCTAssertEqual(s.players[1].tricksWon, 1)
    }
}
