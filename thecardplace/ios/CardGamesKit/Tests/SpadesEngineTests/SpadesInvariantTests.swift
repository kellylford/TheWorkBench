import XCTest
import CardCore
import SpadesEngine

/// A few hundred complete hands played by the computer on every difficulty
/// with seeded randomness: never an illegal play, every card accounted for
/// once, tricks total thirteen, the score is the sum of the hands, and the
/// game always reaches an end.
final class SpadesInvariantTests: XCTestCase {

    func testHundredsOfHandsOnEveryDifficulty() {
        var hands = 0
        var plays = 0
        for (d, difficulty) in Difficulty.allCases.enumerated() {
            for g in 0..<12 {
                let config = SpadesConfig(names: testNames, difficulty: difficulty,
                                          pointsToWin: g % 2 == 0 ? 500 : 250)
                var (state, rng) = Drive.newGame(config, seed: UInt64(1000 * (d + 1) + g))
                var guardCount = 0
                var handsThisGame = 0
                while state.phase != .gameOver && guardCount < 40_000 {
                    guardCount += 1
                    let phaseBefore = state.phase
                    if state.phase == .play {
                        let seat = state.turn
                        let legal = SpadesGame.legalPlays(state, seat: seat)
                        XCTAssertFalse(legal.isEmpty, "no legal play")
                        guard let action = SpadesAI.decide(state, seat: seat, rng: &rng) else { XCTFail("no decision"); return }
                        guard case .play(let c) = action else { XCTFail("the computer did not play a card during play"); return }
                        XCTAssertTrue(legal.contains(c), "illegal play \(c.id) chosen")
                        XCTAssertNil(SpadesGame.whyNot(state, seat: seat, card: c))
                        let r = SpadesGame.applyAction(&state, seat: seat, action: action, rng: &rng)
                        XCTAssertTrue(r.ok, r.reason ?? "")
                        plays += 1

                        // Every card is somewhere exactly once: in a hand, on
                        // the table, or already played this hand.
                        var all = state.players.flatMap { $0.hand }
                        all += state.playedThisHand
                        XCTAssertEqual(all.count, 52, "cards went missing or doubled")
                        XCTAssertEqual(Set(all).count, 52, "a card exists twice")
                        // The table is a prefix of what was played.
                        XCTAssertEqual(state.trick.map { $0.card }, Array(state.playedThisHand.suffix(state.trick.count)))
                        XCTAssertEqual(state.players.map { $0.tricks }.reduce(0, +), state.tricksPlayed)
                    } else {
                        let r = Drive.step(&state, rng: &rng)
                        XCTAssertTrue(r?.ok ?? false, r?.reason ?? "no step")
                    }
                    if phaseBefore == .play && (state.phase == .handOver || state.phase == .gameOver) {
                        handsThisGame += 1
                        let h = state.history.last!
                        XCTAssertEqual(h.tricks.reduce(0, +), 13)
                        XCTAssertEqual(state.playedThisHand.count, 52)
                        XCTAssertTrue(state.players.allSatisfy { $0.hand.isEmpty })
                        for t in 0..<2 {
                            XCTAssertEqual(state.scores[t], state.history.reduce(0) { $0 + $1.delta[t] })
                            XCTAssertEqual(state.bags[t], h.bags[t])
                            XCTAssertGreaterThanOrEqual(state.bags[t], 0)
                            XCTAssertLessThan(state.bags[t], SpadesGame.bagLimit(of: state))
                        }
                    }
                }
                XCTAssertEqual(state.phase, .gameOver, "a game never finished (\(difficulty), game \(g))")
                XCTAssertEqual(state.history.count, state.dealNumber)
                XCTAssertEqual(handsThisGame, state.dealNumber)
                hands += handsThisGame
            }
        }
        XCTAssertGreaterThan(hands, 200, "only \(hands) hands were played")
        XCTAssertEqual(plays, hands * 52)
    }

    func testTheDealRotatesAndTheFirstDealerIsDrawn() {
        var openers = [0, 0, 0, 0]
        for g in 0..<40 {
            var (state, rng) = Drive.newGame(seed: UInt64(500 + g))
            openers[state.dealer!] += 1
            var last = state.dealer!
            var guardCount = 0
            while state.phase != .gameOver && guardCount < 40_000 && state.dealNumber < 4 {
                guardCount += 1
                let before = state.dealNumber
                Drive.step(&state, rng: &rng)
                if state.dealNumber == before + 1 {
                    XCTAssertEqual(state.dealer, (last + 1) % 4, "the deal did not rotate")
                    XCTAssertEqual(state.turn, (state.dealer! + 1) % 4, "bidding does not start left of the dealer")
                    last = state.dealer!
                }
            }
        }
        XCTAssertTrue(openers.allSatisfy { $0 > 0 }, "the opening dealer is fixed: \(openers)")
    }

    func testSameSeedReplaysIdentically() {
        let a = Drive.playGame(SpadesConfig(names: testNames, pointsToWin: 250), seed: 31337)
        let b = Drive.playGame(SpadesConfig(names: testNames, pointsToWin: 250), seed: 31337)
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.log.events.map { $0.text }, b.log.events.map { $0.text })
        let c = Drive.playGame(SpadesConfig(names: testNames, pointsToWin: 250), seed: 31338)
        XCTAssertNotEqual(a.history, c.history, "two seeds produced the same game")
    }

    func testDifficultyDoesNotChangeTheDecision() {
        // ai.js never reads the difficulty; the port is faithful to that.
        for seed in 1...6 {
            var states: [SpadesState] = []
            for d in Difficulty.allCases {
                let (s, _) = Drive.toPlay(SpadesConfig(names: testNames, difficulty: d), seed: UInt64(seed))
                states.append(s)
            }
            for s in states.dropFirst() {
                XCTAssertEqual(s.players.map { $0.bid }, states[0].players.map { $0.bid })
                var rng = RandomSource(seed: 1)
                XCTAssertEqual(SpadesAI.decide(s, seat: s.turn, rng: &rng), SpadesAI.decide(states[0], seat: states[0].turn, rng: &rng))
            }
        }
    }

    func testTheBiddingHeuristicsOnLiteralHands() {
        // No trump honours, three low spades, nothing above a queen with cover:
        // nil-worthy.
        XCTAssertTrue(SpadesAI.nilWorthy(cards("2S 5S 8S 3C 4C 7C 9C 2D 6D TD 3H 8H JH")))
        // A bare king is a trick you cannot avoid.
        XCTAssertFalse(SpadesAI.nilWorthy(cards("2S 5S 8S KC 4C 7C 9C 2D 6D TD 3H 8H JH")))
        // Any spade above the nine says no.
        XCTAssertFalse(SpadesAI.nilWorthy(cards("2S 5S TS 3C 4C 7C 9C 2D 6D TD 3H 8H JH")))
        // Ace, king of spades (2 + 2), five spades (two past the third: 4),
        // ace of hearts (2), king of clubs with cover (2), a void in
        // diamonds with five trumps (2): fourteen halves, seven tricks.
        XCTAssertEqual(SpadesAI.handStrength(cards("AS KS 7S 5S 2S AH 4H 3H KC 9C 2C 8H 6H")), 7)
        // Nothing at all: 2C 3C 4C 5C 2D 3D 4D 2H 3H 4H 2S 3S 4S — three
        // spades and no honours, and no void.
        XCTAssertEqual(SpadesAI.handStrength(cards("2C 3C 4C 5C 2D 3D 4D 2H 3H 4H 2S 3S 4S")), 0)
    }

    func testChooseBidShadesDownWhenTheTableIsOverAndForAPartnerOnNil() {
        var state = SpadesGame.createGame(SpadesConfig(names: testNames))
        state.phase = .bidding
        state.dealer = 3
        state.turn = 2
        let hand = cards("AS KS 7S 5S 2S AH 4H 3H KC 9C 2C 8H 6H")   // worth seven
        state.players[2].hand = hand
        XCTAssertEqual(SpadesAI.chooseBid(state, seat: 2), 7)
        // Somebody has spoken and the table would be 8 + 7 = 15, over 14:
        // shade by one.
        state.players[0].bid = 4
        state.players[1].bid = 4
        XCTAssertEqual(SpadesAI.chooseBid(state, seat: 2), 6)
        // The partner is on nil: one less again.
        state.players[0].bid = 0
        state.players[1].bid = 4
        XCTAssertEqual(SpadesAI.chooseBid(state, seat: 2), 6)
        state.players[1].bid = 8
        XCTAssertEqual(SpadesAI.chooseBid(state, seat: 2), 5)
    }
}
