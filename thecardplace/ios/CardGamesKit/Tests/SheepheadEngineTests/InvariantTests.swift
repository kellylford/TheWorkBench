import XCTest
import CardCore
@testable import SheepheadEngine

final class InvariantTests: XCTestCase {
    /// An independent reading of the follow-suit rule, so the check is not the
    /// engine validating its own legalPlays.
    private func suitKey(_ c: Card) -> String {
        (c.rank == .queen || c.rank == .jack || c.suit == .diamonds) ? "T" : c.suit.rawValue
    }

    private func checkHand(_ state: SheepheadState, n: Int) {
        let d = SheepheadGame.dealSpec(for: n)
        XCTAssertEqual(state.phase, .handOver)
        XCTAssertEqual(state.players.reduce(0) { $0 + $1.tricksWon }, d.hand, "trick count (\(n)p)")
        XCTAssertTrue(state.players.allSatisfy { $0.hand.isEmpty }, "cards left in hand")
        XCTAssertEqual(state.played.count, n * d.hand)
        XCTAssertEqual(Set(state.played).count, state.played.count, "duplicate card played")
        let taken = state.players.reduce(0) { $0 + $1.points }
        let buried = SheepheadCards.sumPoints(state.buried)
        XCTAssertEqual(taken + buried + SheepheadCards.sumPoints(state.blind), 120)
        let r = state.result!
        XCTAssertEqual(r.deltas.reduce(0, +), 0, "scoring is not zero-sum")
        XCTAssertEqual(state.history.last?.problems ?? ["missing"], [], "audit")
        if !state.isLeaster {
            XCTAssertNotNil(state.picker)
            XCTAssertEqual(state.buried.count, d.blind)
            if state.alone { XCTAssertNil(state.partner) } else { XCTAssertNotNil(state.partner) }
            XCTAssertTrue(state.partnerRevealed)
            let stake = 2 * r.multiplier * r.factor
            for s in 0..<n where SheepheadGame.team(state, seat: s) == .opponent {
                XCTAssertEqual(abs(r.deltas[s]), stake)
            }
        } else {
            XCTAssertTrue(state.blind.isEmpty, "the leaster blind must go with the last trick")
            XCTAssertEqual(r.winners.count, 1)
            XCTAssertGreaterThan(state.players[r.winners[0]].tricksWon, 0)
        }
    }

    func testCompleteHandsOnEveryTableSizeAndDifficulty() {
        var hands = 0, leasters = 0
        for n in 3...6 {
            for allPass in SheepheadConfig.AllPass.allCases {
                for difficulty in Difficulty.allCases {
                    for i in 0..<25 {
                        var (state, rng) = newGame(players: n, allPass: allPass, difficulty: difficulty,
                                                   seed: UInt64(n * 10_000 + i * 7 + (allPass == .leaster ? 0 : 1)))
                        playHand(&state, rng: &rng) { st, seat, action, _ in
                            guard case .play(let c) = action else { return }
                            let legal = SheepheadGame.legalPlays(st, seat: seat)
                            XCTAssertTrue(legal.contains(c), "AI chose an illegal card")
                            if let first = st.trick.first {
                                let led = self.suitKey(first.card)
                                if st.players[seat].hand.contains(where: { self.suitKey($0) == led }) {
                                    XCTAssertEqual(self.suitKey(c), led, "AI failed to follow suit")
                                }
                            }
                        }
                        checkHand(state, n: n)
                        hands += 1
                        if state.isLeaster { leasters += 1 }
                    }
                }
            }
        }
        XCTAssertEqual(hands, 4 * 2 * 3 * 25)
        XCTAssertGreaterThan(leasters, 0)
    }

    func testSeededGameReplaysIdentically() {
        func run() -> SheepheadState {
            var (state, rng) = newGame(players: 5, difficulty: .normal, doublers: true, seed: 99)
            for _ in 0..<4 {
                playHand(&state, rng: &rng)
                XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng), .ok)
            }
            playHand(&state, rng: &rng)
            return state
        }
        let a = run(), b = run()
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.log.events.map(\.text), b.log.events.map(\.text))
        XCTAssertEqual(a.handNumber, 5)
        XCTAssertEqual(a.history.count, 5)
    }

    func testDealRotatesAndScoresAccumulate() {
        var (state, rng) = newGame(players: 4, seed: 5)
        let first = state.dealer!
        var totals = Array(repeating: 0, count: 4)
        for h in 0..<6 {
            XCTAssertEqual(state.dealer, (first + h) % 4)
            XCTAssertEqual(state.leader, (state.dealer! + 1) % 4)
            playHand(&state, rng: &rng)
            for i in 0..<4 { totals[i] += state.result!.deltas[i] }
            XCTAssertEqual(state.players.map(\.score), totals)
            XCTAssertEqual(state.players.map(\.score).reduce(0, +), 0)
            XCTAssertTrue(SheepheadGame.canDeal(state))
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng), .ok)
            XCTAssertFalse(SheepheadGame.canDeal(state))
        }
    }

    func testQueenDoublersMultiplyTheHand() {
        var factors: Set<Int> = []
        for i in 0..<150 {
            var (state, rng) = newGame(players: 3, doublers: true, seed: UInt64(500 + i))
            playHand(&state, rng: &rng)
            let r = state.result!
            let expected = 1 << state.doublers.count
            XCTAssertEqual(r.factor, expected)
            factors.insert(r.factor)
            for dbl in state.doublers {
                let hand = state.dealt!.hands[dbl.player!]
                let pair = dbl.kind == .black ? cards("QC", "QS") : cards("QH", "QD")
                // The pair was in that player's final hand: dealt, or picked up and not buried.
                let finalHand = state.picker == dbl.player
                    ? (hand + state.dealt!.blind).filter { !state.buried.contains($0) }
                    : hand
                XCTAssertTrue(pair.allSatisfy { finalHand.contains($0) })
                let told = state.log.events.filter { $0.audience == dbl.player && $0.text.contains(dbl.text) }
                XCTAssertEqual(told.count, 1, "the holder is told once, privately")
            }
            if r.factor > 1 {
                XCTAssertTrue(r.summary.contains("Doubled by"))
                XCTAssertTrue(r.summary.contains("worth \(r.factor) times"))
            } else {
                XCTAssertFalse(r.summary.contains("Doubled"))
            }
        }
        XCTAssertTrue(factors.contains(2), "no doubled hand in 150 three-handed deals")
        XCTAssertTrue(factors.contains(4), "no quadrupled hand in 150 three-handed deals")
    }

    func testRedealDoublesTheNextHandOnly() {
        var (state, rng) = newGame(players: 4, allPass: .redeal, doublers: true, seed: 3)
        state.config.blackQueenDoubler = false
        state.config.redQueenDoubler = false
        let hand = state.handNumber
        for _ in 0..<4 {
            let seat = SheepheadGame.seatToAct(state)!
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: seat, action: .pass, rng: &rng), .ok)
        }
        XCTAssertEqual(state.handNumber, hand + 1)
        XCTAssertEqual(state.phase, .pick)
        XCTAssertTrue(state.redealDoubler)
        XCTAssertFalse(state.nextHandDoubler)
        XCTAssertTrue(state.log.events.contains { $0.text == "Everyone passed. Redealing. The next hand is a doubler, worth twice as much." })
        // A second redeal does not stack.
        for _ in 0..<4 {
            let seat = SheepheadGame.seatToAct(state)!
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: seat, action: .pass, rng: &rng), .ok)
        }
        XCTAssertEqual(SheepheadGame.doublerFactor(state), 2)
        playHand(&state, rng: &rng)
        XCTAssertEqual(state.result!.factor, 2)
        XCTAssertTrue(state.result!.summary.contains("Doubled by the redeal, so the hand is worth 2 times."))
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng), .ok)
        XCTAssertFalse(state.redealDoubler)
    }

    func testRedealWithoutTheDoublerRule() {
        var (state, rng) = newGame(players: 5, allPass: .redeal, seed: 8)
        for _ in 0..<5 {
            let seat = SheepheadGame.seatToAct(state)!
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: seat, action: .pass, rng: &rng), .ok)
        }
        XCTAssertEqual(state.handNumber, 2)
        XCTAssertFalse(state.redealDoubler)
        XCTAssertTrue(state.log.events.contains { $0.text == "Everyone passed. Redealing." })
    }

    func testLeasterBlindGoesWithTheLastTrick() {
        var (state, rng) = newGame(players: 5, seed: 11)
        let blind = state.blind
        for _ in 0..<5 {
            let seat = SheepheadGame.seatToAct(state)!
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: seat, action: .pass, rng: &rng), .ok)
        }
        XCTAssertTrue(state.isLeaster)
        XCTAssertEqual(state.phase, .play)
        playHand(&state, rng: &rng)
        let last = state.trickLog.last!
        XCTAssertEqual(last.fromBlind, SheepheadCards.sumPoints(blind))
        XCTAssertTrue(state.result!.summary.hasPrefix("Leaster result: "))
        XCTAssertTrue(state.result!.summary.contains("takes the fewest points and wins, 4 points."))
        if last.fromBlind > 0 {
            XCTAssertTrue(state.log.events.contains { $0.text.contains("That includes \(last.fromBlind) points from the blind.") })
        }
    }

    func testThreePlayersPickerIsAlwaysAlone() {
        for i in 0..<20 {
            var (state, rng) = newGame(players: 3, seed: UInt64(70 + i))
            playHand(&state, rng: &rng)
            guard !state.isLeaster else { continue }
            XCTAssertTrue(state.alone)
            XCTAssertNil(state.partner)
            let p = state.picker!
            XCTAssertTrue(state.log.events.contains { $0.text == "\(state.players[p].name) is the picker and plays alone." || $0.text == "You are the picker and play alone." })
        }
    }
}
