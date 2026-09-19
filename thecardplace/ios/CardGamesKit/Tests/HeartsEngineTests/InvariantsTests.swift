import XCTest
import CardCore
@testable import HeartsEngine

/// Whole games played by the AI on every difficulty with seeded randomness:
/// never an illegal play, every card accounted for once, points total what
/// they must, scoring is what the table says, the game always ends, and the
/// same seed replays identically.
final class InvariantsTests: XCTestCase {

    func testManyGamesOnEveryDifficultyKeepEveryInvariant() {
        var hands = 0, moons = 0, games = 0
        for difficulty in Difficulty.allCases {
            for seed: UInt64 in 1...30 {
                var lastHandChecked = 0
                let end = Support.playGame(seed: seed &* 7919 &+ UInt64(difficulty.rawValue.count), config: Support.config(difficulty),
                    inspect: { s in
                        // Every one of the fifty-two cards is in exactly one place.
                        let all = Support.allCards(s)
                        XCTAssertEqual(all.count, 52, "seed \(seed): the pack has \(all.count) cards")
                        XCTAssertEqual(Set(all).count, all.count, "seed \(seed): a card is in two places")
                        if s.phase == .play {
                            XCTAssertEqual(s.heartsBroken, Support.heartEverPlayed(s), "seed \(seed): heartsBroken drifted")
                            XCTAssertFalse(HeartsGame.legalPlays(s, seat: s.turn).isEmpty, "seed \(seed): no legal play on turn")
                            XCTAssertEqual(HeartsGame.seatToAct(s), s.turn)
                        }
                        if s.phase == .passing {
                            XCTAssertTrue(s.players.allSatisfy { $0.hand.count == 13 })
                            XCTAssertEqual(HeartsGame.seatToAct(s), s.passing.firstIndex { $0 == nil })
                        }
                        if s.phase == .handOver && s.dealNumber != lastHandChecked {
                            lastHandChecked = s.dealNumber
                            hands += 1
                            Self.checkFinishedHand(s, seed: seed)
                            XCTAssertTrue(HeartsGame.canDeal(s))
                        } else {
                            XCTAssertFalse(HeartsGame.canDeal(s))
                        }
                    },
                    afterMove: { s, seat, action in
                        if case .play(let c) = action {
                            // The card is on the table or in a pile, and never back in the hand.
                            XCTAssertFalse(s.players[seat].hand.contains(c))
                        }
                    })
                games += 1
                Self.checkFinishedHand(end, seed: seed)
                XCTAssertEqual(end.phase, .gameOver)
                let target = HeartsGame.target(of: end)
                XCTAssertTrue(end.players.contains { $0.score >= target })
                for h in end.history.dropLast() { XCTAssertTrue(h.scores.allSatisfy { $0 < target }) }
                moons += end.history.filter { $0.shooter != nil }.count
                XCTAssertTrue(end.log.events.contains { $0.kind == .game }, "the end of the game is announced")
                XCTAssertFalse(end.log.events.contains { $0.kind == .error }, "refusals are not events")
                XCTAssertNil(HeartsGame.seatToAct(end))
            }
        }
        XCTAssertEqual(games, 90)
        XCTAssertGreaterThan(hands, 200)
        // A note rather than a failure: the AI does not try to shoot, so moons are rare.
        print("hearts invariants: \(games) games, \(hands) hands, \(moons) moons")
    }

    static func checkFinishedHand(_ s: HeartsState, seed: UInt64) {
        let raw = s.players.map { HeartsGame.pointsOf($0.taken) }
        XCTAssertEqual(raw.reduce(0, +), 26, "seed \(seed): a finished hand is worth \(raw.reduce(0, +))")
        XCTAssertEqual(s.players.reduce(0) { $0 + $1.taken.count }, 52, "seed \(seed)")
        XCTAssertTrue(s.players.allSatisfy { $0.hand.isEmpty })
        XCTAssertEqual(s.players.filter(\.hasQueen).count, 1, "seed \(seed): the queen ended in the wrong number of piles")
        XCTAssertEqual(s.tricksPlayed, 13)
        guard let last = s.history.last else { XCTFail("seed \(seed): no history row"); return }
        XCTAssertEqual(last.deal, s.dealNumber)
        XCTAssertEqual(last.passDirection, s.passDirection)
        if let shot = raw.firstIndex(of: 26) {
            XCTAssertEqual(last.shooter, shot)
            XCTAssertEqual(last.points, (0..<4).map { $0 == shot ? 0 : 26 })
            XCTAssertTrue(s.log.events.contains { $0.kind == .moon && $0.seat == shot })
        } else {
            XCTAssertNil(last.shooter)
            XCTAssertEqual(last.points, raw)
        }
        XCTAssertEqual(s.players.map(\.handPoints), last.points)
        var sums = [0, 0, 0, 0]
        for h in s.history { for i in 0..<4 { sums[i] += h.points[i] } }
        XCTAssertEqual(s.players.map(\.score), sums, "seed \(seed): scores are not the sum of the hands")
        XCTAssertEqual(last.scores, s.players.map(\.score))
    }

    func testTheSameSeedReplaysIdentically() {
        for seed: UInt64 in [5, 99, 4242] {
            let a = Support.playGame(seed: seed, config: Support.config(.normal))
            let b = Support.playGame(seed: seed, config: Support.config(.normal))
            XCTAssertEqual(a, b, "seed \(seed) did not replay identically")
            XCTAssertEqual(a.log.events.map(\.text), b.log.events.map(\.text))
        }
        let c = Support.playGame(seed: 5, config: Support.config(.normal))
        let d = Support.playGame(seed: 6, config: Support.config(.normal))
        XCTAssertNotEqual(c.log.events.map(\.text), d.log.events.map(\.text), "different seeds should differ")
    }

    func testCanDealIsExactlyWhenNextHandIsAccepted() {
        var rng = RandomSource(seed: 31)
        var s = HeartsGame.createGame(Support.config(pointsToWin: 50))
        var phases = Set<HeartsPhase>()
        var steps = 0
        while steps < 4000 {
            steps += 1
            phases.insert(s.phase)
            var copy = s
            var probeRng = rng
            let accepted = HeartsGame.applyAction(&copy, seat: 0, action: .nextHand, rng: &probeRng).ok
            XCTAssertEqual(HeartsGame.canDeal(s), accepted, "phase \(s.phase): canDeal says \(HeartsGame.canDeal(s)) but nextHand \(accepted ? "is accepted" : "is refused")")
            if s.phase == .gameOver { break }
            switch s.phase {
            case .idle:
                XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
            case .passing, .play:
                let seat = HeartsGame.seatToAct(s)!
                let action = HeartsAI.decide(s, seat: seat, rng: &rng)!
                XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: action, rng: &rng).ok)
            case .handOver:
                XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).ok)
            case .gameOver:
                break
            }
        }
        XCTAssertEqual(phases, [.idle, .passing, .play, .handOver, .gameOver])
    }

    func testNewGameGoesBackToIdleWithScoresResetAndConfigKept() {
        var rng = RandomSource(seed: 8)
        let cfg = HeartsConfig(names: ["Ruth", "East", "South", "West"], difficulty: .easy, pointsToWin: 50)
        var s = Support.playGame(seed: 8, config: cfg)
        XCTAssertEqual(s.phase, .gameOver)
        XCTAssertTrue(s.players.contains { $0.score > 0 })
        let r = HeartsGame.applyAction(&s, seat: 0, action: .newGame, rng: &rng)
        XCTAssertTrue(r.ok)
        XCTAssertEqual(s.phase, .idle)
        XCTAssertEqual(s.config, cfg)
        XCTAssertEqual(s.players.map(\.score), [0, 0, 0, 0])
        XCTAssertEqual(s.players.map(\.name), cfg.names)
        XCTAssertEqual(s.dealNumber, 0)
        XCTAssertTrue(s.history.isEmpty)
        XCTAssertNil(s.winner)
        XCTAssertEqual(s.log.events.last?.text, "New game. Every score is back to nothing.")
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertEqual(s.dealNumber, 1)
        XCTAssertEqual(s.passDirection, .left)
    }

    func testEventsSayWhatHappened() {
        var rng = RandomSource(seed: 21)
        var s = HeartsGame.createGame(Support.config())
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertEqual(s.log.events.map(\.text), ["Hand 1 dealt.", "Pass three cards to the left."])
        XCTAssertEqual(s.log.events[0].kind, .deal)

        let mine = Array(s.players[0].hand.prefix(3))
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .pass(mine), rng: &rng).ok)
        let you = s.log.events.last { $0.kind == .you }!
        XCTAssertEqual(you.text, "You passed \(mine.spokenList).")
        XCTAssertEqual(you.audience, 0)
        XCTAssertEqual(you.cards, mine)
        XCTAssertEqual(s.log.events.last?.text, "North has passed.")
        XCTAssertNil(s.log.events.last?.audience)
        // Nobody but seat 0 hears what seat 0 passed.
        XCTAssertFalse(s.log.events(for: 1).contains { $0.text.hasPrefix("You passed") })

        for seat in 1...3 {
            let a = HeartsAI.decide(s, seat: seat, rng: &rng)!
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: a, rng: &rng).ok)
        }
        XCTAssertEqual(s.phase, .play)
        let got = s.log.events.first { $0.audience == 1 && $0.text.contains("passed you") }!
        XCTAssertEqual(got.text, "North passed you \(mine.spokenList).")
        XCTAssertEqual(s.received[1], mine)
        let leader = HeartsGame.holderOfTwoOfClubs(s)
        XCTAssertEqual(s.log.events.last?.text, "\(Support.names[leader]) has the two of clubs and leads.")

        var lastPlay: Card? = nil
        while s.tricksPlayed == 0 {
            let seat = s.turn
            let c = HeartsAI.chooseCard(s, seat: seat)!
            lastPlay = c
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: .play(c), rng: &rng).ok)
            if s.tricksPlayed == 0 {
                XCTAssertEqual(s.log.events.last?.text, "\(Support.names[seat]) played the \(c.name).")
                XCTAssertEqual(s.log.events.last?.cards, [c])
                XCTAssertEqual(s.log.events.last?.seat, seat)
            }
        }
        XCTAssertNotNil(lastPlay)
        let trick = s.log.events.last!
        XCTAssertEqual(trick.kind, .trick)
        XCTAssertEqual(trick.text, "\(Support.names[s.lastTrick!.winner]) took the trick, no points.")
        XCTAssertEqual(trick.cards.count, 4)
    }

    func testHandOverAndGameEventsWording() {
        let end = Support.playGame(seed: 77, config: Support.config(pointsToWin: 50))
        let handEvents = end.log.events.filter { $0.kind == .hand }
        XCTAssertEqual(handEvents.count, end.history.count)
        let h = end.history[0]
        XCTAssertEqual(handEvents[0].text, "Hand 1 over. North \(h.points[0]), East \(h.points[1]), South \(h.points[2]), West \(h.points[3]).")
        let game = end.log.events.last { $0.kind == .game }!
        if let w = end.winner {
            XCTAssertEqual(game.text, "\(Support.names[w]) wins with \(end.players[w].score). Lowest score wins.")
        } else {
            XCTAssertTrue(game.text.hasPrefix("Tied on "))
        }
    }
}
