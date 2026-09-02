import XCTest
import CardCore
@testable import CribbageEngine

final class InvariantsTests: XCTestCase {
    func testEveryGameFinishesWithNothingRefused() {
        XCTAssertEqual(Sim.games.count, Sim.perCombination * Difficulty.allCases.count * CribbageConfig.targets.count)
        for g in Sim.games {
            XCTAssertTrue(g.refusals.isEmpty, "seed \(g.seed): \(g.refusals)")
            XCTAssertTrue(g.state.gameOver, "seed \(g.seed) never finished in \(g.steps) steps")
            XCTAssertEqual(g.state.phase, .gameOver)
            guard let w = g.state.gameWinner else { XCTFail("no winner"); continue }
            let loser = 1 - w
            XCTAssertGreaterThanOrEqual(g.state.players[w].score, g.target)
            XCTAssertLessThan(g.state.players[loser].score, g.target)
            XCTAssertEqual(g.state.gamesWon[w], 1)
            XCTAssertEqual(g.state.gamesWon[loser], 0)
            XCTAssertFalse(g.state.history.isEmpty)
            // The skunk line, from the literal thresholds.
            let theirs = g.state.players[loser].score
            let expect: CribbageSkunk? = theirs < g.target / 2 + 1 ? (theirs < g.target / 4 + 1 ? .doubleSkunk : .skunk) : nil
            XCTAssertEqual(g.state.result?.skunk, expect)
            // The deal passed after the last hand, however it ended.
            XCTAssertEqual(g.state.dealer, 1 - g.state.history.last!.dealer)
        }
    }

    func testEveryCardAccountedForOnce() {
        for h in Sim.hands {
            XCTAssertTrue(h.problems.isEmpty, "hand \(h.handNumber): \(h.problems)")
            guard let dealt = h.dealt else { XCTFail("no deal recorded"); continue }
            XCTAssertEqual(dealt.hands.count, 2)
            let all = dealt.hands.flatMap { $0 } + (h.starter.map { [$0] } ?? [])
            XCTAssertEqual(Set(all).count, all.count, "a card was dealt twice")
            for hand in dealt.hands { XCTAssertEqual(hand.count, 6) }
            for i in 0..<2 {
                guard let thrown = h.discarded[i] else { continue }
                XCTAssertEqual(Set(h.kept[i] + thrown), Set(dealt.hands[i]), "kept plus thrown is not what was dealt")
                XCTAssertEqual(h.kept[i].count, 4)
            }
            if let a = h.discarded[0], let b = h.discarded[1] {
                XCTAssertEqual(Set(h.crib), Set(a + b))
                XCTAssertEqual(h.crib.count, 4)
            }
            let played = h.pile.map(\.card)
            XCTAssertEqual(Set(played).count, played.count, "a card was played twice")
            for e in h.pile { XCTAssertTrue(h.kept[e.player].contains(e.card)) }
            for s in h.scores { XCTAssertGreaterThanOrEqual(s, 0) }
        }
    }

    func testScoresOnlyRiseAndBreakdownsAddUp() {
        for g in Sim.games {
            var prev = [0, 0]
            for h in g.state.history {
                XCTAssertGreaterThanOrEqual(h.scores[0], prev[0])
                XCTAssertGreaterThanOrEqual(h.scores[1], prev[1])
                prev = h.scores
                for c in h.counts {
                    XCTAssertEqual(c.result.items.reduce(0) { $0 + $1.points }, c.result.total)
                    // The order of the count: non-dealer's hand, dealer's hand, crib.
                }
                let kinds = h.counts.map { ($0.who, $0.kind) }
                let expected: [(Int, CribbageCountKind)] = [(1 - h.dealer, .hand), (h.dealer, .hand), (h.dealer, .crib)]
                for (i, k) in kinds.enumerated() {
                    XCTAssertEqual(k.0, expected[i].0)
                    XCTAssertEqual(k.1, expected[i].1)
                }
            }
            XCTAssertEqual(prev, [g.state.players[0].score, g.state.players[1].score])
        }
    }

    func testAverageHandAndCribScores() {
        var handTotal = 0, handN = 0, cribTotal = 0, cribN = 0
        for h in Sim.hands {
            for c in h.counts {
                if c.kind == .hand { handTotal += c.result.total; handN += 1 }
                else { cribTotal += c.result.total; cribN += 1 }
            }
        }
        let hand = Double(handTotal) / Double(max(1, handN))
        let crib = Double(cribTotal) / Double(max(1, cribN))
        print("cribbage invariants: \(Sim.hands.count) hands over \(Sim.games.count) games; average hand \(String(format: "%.2f", hand)) over \(handN), average crib \(String(format: "%.2f", crib)) over \(cribN)")
        XCTAssertGreaterThan(handN, 400)
        XCTAssertGreaterThan(hand, 6.5, "the average hand is far below the published figure")
        XCTAssertLessThan(hand, 9.5, "the average hand is far above the published figure")
        XCTAssertGreaterThan(crib, 3.5)
        XCTAssertLessThan(crib, 6.0)
    }

    func testPrivateEventsHaveAnAudienceAndPublicOnesDoNot() {
        for g in Sim.games.prefix(6) {
            for e in g.state.log.events {
                if e.text.hasPrefix("Your six cards") || e.text.hasPrefix("You threw") {
                    XCTAssertNotNil(e.audience, e.text)
                    XCTAssertEqual(e.kind, .you)
                } else {
                    XCTAssertNil(e.audience, e.text)
                }
                XCTAssertNotEqual(e.kind, .error)
            }
            // Seat 1 never receives seat 0's private lines.
            XCTAssertFalse(g.state.log.events(for: 1).contains { $0.audience == 0 })
        }
    }

    func testTheSameSeedReplaysIdentically() {
        let a = Sim.play(seed: 77, difficulty: .easy, target: 61)
        let b = Sim.play(seed: 77, difficulty: .easy, target: 61)
        XCTAssertEqual(a.state, b.state)
        XCTAssertEqual(a.state.hashValue, b.state.hashValue)
        let c = Sim.play(seed: 78, difficulty: .easy, target: 61)
        XCTAssertNotEqual(a.state.log.events.map(\.text), c.state.log.events.map(\.text))
    }

    func testAnotherGameFollowsAGameOver() {
        var rng = RandomSource(seed: 5)
        var state = CribbageGame.createGame(Sim.config(.normal, 61))
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .gameOver })
        let dealerAfter = state.dealer
        XCTAssertTrue(CribbageGame.canDeal(state))
        XCTAssertNil(CribbageGame.seatToAct(state))
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng), .ok)
        XCTAssertEqual(state.phase, .discard)
        XCTAssertEqual(state.gameNumber, 2)
        XCTAssertEqual(state.handNumber, 1)
        XCTAssertEqual(state.dealer, dealerAfter)
        XCTAssertEqual(state.players.map(\.score), [0, 0])
        XCTAssertTrue(state.log.events.contains { $0.text.hasPrefix("A new game. Both scores back to nothing, and") })

        // And the other road: newGame back to idle, keeping what was won.
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .gameOver })
        let won = state.gamesWon
        XCTAssertEqual(won.reduce(0, +), 2)
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .newGame, rng: &rng), .ok)
        XCTAssertEqual(state.phase, .idle)
        XCTAssertNil(state.dealer)
        XCTAssertEqual(state.gamesWon, won)
        XCTAssertEqual(state.players.map(\.score), [0, 0])
        XCTAssertEqual(state.config.names, ["You", "Ruth"])
        XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng), .ok)
        XCTAssertEqual(state.phase, .cutForDeal)
    }

    func testTheCutDecidesTheDealerByRunOrder() {
        // Find a seed where the first cut is not a tie, and check the lower
        // ORDER dealt — a ten below a jack, not equal to it.
        var ties = 0, decided = 0
        for seed in 1...60 {
            var rng = RandomSource(seed: UInt64(seed))
            var state = CribbageGame.createGame(Sim.config(.hard, 121))
            _ = CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
            XCTAssertEqual(CribbageGame.applyAction(&state, seat: 0, action: .cut, rng: &rng), .ok)
            guard let cut = state.cutForDeal else { XCTFail(); continue }
            if cut.tie {
                ties += 1
                XCTAssertEqual(state.phase, .cutForDeal)
                XCTAssertEqual(CribbageCards.order(cut.cuts[0]), CribbageCards.order(cut.cuts[1]))
                continue
            }
            decided += 1
            XCTAssertEqual(state.phase, .discard)
            let lower = CribbageCards.order(cut.cuts[0]) < CribbageCards.order(cut.cuts[1]) ? 0 : 1
            XCTAssertEqual(state.dealer, lower)
            XCTAssertEqual(state.handNumber, 1)
            XCTAssertEqual(state.players[0].hand.count, 6)
            XCTAssertEqual(state.players[1].hand.count, 6)
            XCTAssertEqual(state.deck.count, 40)
        }
        XCTAssertGreaterThan(decided, 40)
    }
}
