import XCTest
import CardCore
@testable import HeartsEngine

/// The rules of hearts written out as literal data, and the engine checked
/// against them. Nothing here calls the function under test to build its own
/// expectation. The second half mirrors hearts/tests/rules-oracle.js: legal
/// plays re-derived by elimination and compared after every move of many
/// hands played at random.
final class RulesOracleTests: XCTestCase {

    // MARK: - Literal tables

    /// Every card worth anything, and what it is worth. Everything else is nothing.
    static let scoringTable: [String: Int] = [
        "2H": 1, "3H": 1, "4H": 1, "5H": 1, "6H": 1, "7H": 1, "8H": 1,
        "9H": 1, "TH": 1, "JH": 1, "QH": 1, "KH": 1, "AH": 1,
        "QS": 13,
    ]

    func testEveryCardIsWorthWhatTheTableSays() {
        var total = 0
        for c in Card.fullDeck {
            let want = Self.scoringTable[c.id] ?? 0
            XCTAssertEqual(HeartsGame.pointsOf([c]), want, c.id)
            XCTAssertEqual(HeartsGame.isScoring(c), want > 0, c.id)
            total += HeartsGame.pointsOf([c])
        }
        XCTAssertEqual(total, 26, "the pack holds twenty-six points")
        XCTAssertEqual(HeartsGame.pointsOf(Card.fullDeck), 26)
        XCTAssertEqual(HeartsGame.moon, 26)
    }

    /// Trick rows: four plays in order, and the position of the winner.
    /// Highest of the suit led; nothing else can win, because there is no trump.
    static let trickTable: [(plays: [(Int, String)], winner: Int, points: Int)] = [
        (plays: [(0, "2C"), (1, "AC"), (2, "5C"), (3, "9C")], winner: 1, points: 0),
        (plays: [(0, "2C"), (1, "AH"), (2, "QS"), (3, "3C")], winner: 3, points: 14),
        (plays: [(2, "TD"), (3, "JD"), (0, "2H"), (1, "QD")], winner: 1, points: 1),
        (plays: [(1, "KH"), (2, "AH"), (3, "2H"), (0, "3H")], winner: 2, points: 4),
        (plays: [(3, "9S"), (0, "QS"), (1, "KS"), (2, "2S")], winner: 1, points: 13),
        (plays: [(0, "AS"), (1, "KS"), (2, "QS"), (3, "JS")], winner: 0, points: 13),
        (plays: [(1, "3D"), (2, "AC"), (3, "AS"), (0, "AH")], winner: 1, points: 1),
    ]

    func testTrickWinnerAndPointsMatchTheTable() {
        for row in Self.trickTable {
            var hands: [[String]] = [[], [], [], []]
            for (seat, id) in row.plays { hands[seat].append(id) }
            var s = Support.playState(hands: hands, turn: row.plays[0].0, tricksPlayed: 5, heartsBroken: true)
            var rng = RandomSource(seed: 1)
            for (seat, id) in row.plays {
                let r = HeartsGame.applyAction(&s, seat: seat, action: .play(Support.card(id)), rng: &rng)
                XCTAssertTrue(r.ok, "\(id) refused: \(r.reason ?? "")")
            }
            let ids = row.plays.map(\.1).joined(separator: " ")
            XCTAssertEqual(s.lastTrick?.winner, row.winner, ids)
            XCTAssertEqual(s.lastTrick?.points, row.points, ids)
            XCTAssertEqual(s.turn, row.winner, "the winner leads next: \(ids)")
            XCTAssertEqual(s.leader, row.winner, ids)
            XCTAssertEqual(s.players[row.winner].taken.count, 4, ids)
            XCTAssertEqual(s.tricksPlayed, 6, ids)
        }
    }

    /// Deal number, direction, and how many seats to the left the cards go.
    static let passTable: [(deal: Int, dir: HeartsPassDirection, offset: Int)] = [
        (1, .left, 1), (2, .right, 3), (3, .across, 2), (4, .hold, 0),
        (5, .left, 1), (6, .right, 3), (7, .across, 2), (8, .hold, 0),
    ]

    func testPassDirectionRotatesAsTheTableSays() {
        var rng = RandomSource(seed: 7)
        var s = HeartsGame.createGame(Support.config())
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        for row in Self.passTable {
            XCTAssertEqual(s.dealNumber, row.deal)
            XCTAssertEqual(s.passDirection, row.dir, "deal \(row.deal)")
            XCTAssertEqual(s.passDirection.offset, row.offset, "deal \(row.deal)")
            XCTAssertEqual(s.phase, row.dir == .hold ? .play : .passing, "deal \(row.deal)")
            if row.dir != .hold {
                // The cards themselves move to the seat the table names, and
                // nobody keeps what they gave.
                let gave = s.players.map { Array($0.hand.prefix(3)) }
                for seat in 0..<4 {
                    XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: .pass(gave[seat]), rng: &rng).ok)
                    if seat < 3 {
                        XCTAssertEqual(s.phase, .passing, "the swap happened before everybody chose")
                        XCTAssertTrue(s.players.allSatisfy { $0.hand.count == 13 }, "a hand changed size mid-pass")
                    }
                }
                XCTAssertEqual(s.phase, .play)
                for from in 0..<4 {
                    let to = (from + row.offset) % 4
                    for c in gave[from] {
                        XCTAssertTrue(s.players[to].hand.contains(c), "\(row.dir): seat \(to) never received \(c.id) from \(from)")
                        XCTAssertFalse(s.players[from].hand.contains(c), "\(row.dir): seat \(from) still holds \(c.id)")
                    }
                    XCTAssertEqual(s.received[to], gave[from], "\(row.dir): received row for seat \(to)")
                }
                XCTAssertTrue(s.players.allSatisfy { $0.hand.count == 13 })
            }
            // Re-deal rather than play the hand out; the direction is a
            // function of the deal number.
            s.phase = .handOver
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).ok)
        }
    }

    /// The moon, as literal rows: raw points from the cards, and what each
    /// seat is charged.
    static let moonTable: [(raw: [Int], charged: [Int], shooter: Int?)] = [
        (raw: [26, 0, 0, 0], charged: [0, 26, 26, 26], shooter: 0),
        (raw: [0, 0, 26, 0], charged: [26, 26, 0, 26], shooter: 2),
        (raw: [13, 13, 0, 0], charged: [13, 13, 0, 0], shooter: nil),
        (raw: [25, 1, 0, 0], charged: [25, 1, 0, 0], shooter: nil),
        (raw: [0, 14, 7, 5], charged: [0, 14, 7, 5], shooter: nil),
    ]

    func testMoonScoringMatchesTheTable() {
        let hearts = Card.deck(ranks: Rank.allCases, suits: [.hearts])
        let queen = HeartsCards.queenOfSpades
        for row in Self.moonTable {
            // Build twelve finished tricks so that each seat's pile is worth
            // exactly the raw points, then play a pointless last trick.
            var taken: [[Card]] = [[], [], [], []]
            var pool = hearts
            var queenUsed = false
            for seat in 0..<4 {
                var need = row.raw[seat]
                if need >= 13 && !queenUsed { taken[seat].append(queen); need -= 13; queenUsed = true }
                for _ in 0..<need { taken[seat].append(pool.removeFirst()) }
            }
            XCTAssertTrue(pool.isEmpty && queenUsed, "row \(row.raw) does not use every point card")
            let last = ["2C", "3C", "4C", "5C"]
            // The other thirty-four cards, dealt round the table so that every
            // card is in exactly one pile. Pile sizes do not matter to the rule.
            let filler = Card.fullDeck.filter { $0.suit != .hearts && $0 != queen && !last.contains($0.id) }
            for (i, c) in filler.enumerated() { taken[i % 4].append(c) }
            XCTAssertEqual(taken.reduce(0) { $0 + $1.count }, 48)
            var s = Support.playState(hands: last.map { [$0] }, turn: 0, tricksPlayed: 12, heartsBroken: true,
                                      taken: taken.map { $0.ids })
            s.players[0].score = 10
            var rng = RandomSource(seed: 3)
            for seat in 0..<4 {
                XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: .play(Support.card(last[seat])), rng: &rng).ok)
            }
            XCTAssertEqual(s.phase, .handOver, "\(row.raw)")
            XCTAssertEqual(s.players.map(\.handPoints), row.charged, "\(row.raw)")
            XCTAssertEqual(s.players.map(\.score), [10 + row.charged[0], row.charged[1], row.charged[2], row.charged[3]])
            XCTAssertEqual(s.history.last?.shooter, row.shooter, "\(row.raw)")
            XCTAssertEqual(s.history.last?.points, row.charged)
            let moonEvents = s.log.events.filter { $0.kind == .moon }
            XCTAssertEqual(moonEvents.count, row.shooter == nil ? 0 : 1, "\(row.raw)")
            if let sh = row.shooter {
                XCTAssertEqual(moonEvents.first?.text, "\(Support.names[sh]) shot the moon — everybody else takes 26.")
            }
        }
    }

    func testSortOrderIsClubsDiamondsSpadesHeartsHighToLow() {
        let hand = Support.cards(["2H", "AS", "TD", "QS", "3C", "KH", "AC", "9D", "2S", "JC"])
        let want = ["AC", "JC", "3C", "TD", "9D", "AS", "QS", "2S", "KH", "2H"]
        XCTAssertEqual(HeartsCards.sortHand(hand).ids, want)
        XCTAssertEqual(HeartsCards.sortHand(Card.fullDeck).prefix(3).map(\.id), ["AC", "KC", "QC"])
        XCTAssertEqual(HeartsCards.sortHand(Card.fullDeck).suffix(2).map(\.id), ["3H", "2H"])
    }

    func testCardTextIsTheNameAndNothingElse() {
        XCTAssertEqual(HeartsCards.describe(HeartsCards.queenOfSpades), "Queen of Spades")
        XCTAssertEqual(HeartsCards.role(HeartsCards.queenOfSpades), "")
        XCTAssertEqual(HeartsCards.describe(Support.card("TH")), "Ten of Hearts")
        XCTAssertTrue(HeartsCards.beats(Support.card("AC"), Support.card("KC")))
        XCTAssertFalse(HeartsCards.beats(Support.card("AH"), Support.card("2C")), "no suit beats a suit it is not")
        XCTAssertFalse(HeartsCards.beats(Support.card("KC"), Support.card("AC")))
    }

    // MARK: - Legal plays, as literal positions

    func testTheTwoOfClubsLeadsTheFirstTrickAndIsNotAChoice() {
        let s = Support.playState(hands: [["2C", "AC", "AH", "QS"], ["3C"], ["4C"], ["5C"]], turn: 0)
        XCTAssertEqual(HeartsGame.legalPlays(s, seat: 0).ids, ["2C"])
        XCTAssertEqual(HeartsGame.whyNot(s, seat: 0, card: Support.card("AC")), "the two of clubs must be led first")
        XCTAssertNil(HeartsGame.whyNot(s, seat: 0, card: Support.card("2C")))
        XCTAssertEqual(HeartsGame.holderOfTwoOfClubs(s), 0)
    }

    func testYouMustFollowSuit() {
        let s = Support.playState(hands: [["2C"], ["9C", "AH", "3D"], ["4C"], ["5C"]], turn: 1,
                                  trick: [(0, "2C")])
        XCTAssertEqual(HeartsGame.legalPlays(s, seat: 1).ids, ["9C"])
        XCTAssertEqual(HeartsGame.whyNot(s, seat: 1, card: Support.card("3D")), "you must follow clubs")
        XCTAssertEqual(HeartsGame.whyNot(s, seat: 1, card: Support.card("AH")), "you must follow clubs")
    }

    func testNoPointsOnTheFirstTrickUnlessThatIsAllYouHold() {
        let s = Support.playState(hands: [["2C"], ["QS", "AH", "3D", "KS"], ["4C"], ["5C"]], turn: 1,
                                  trick: [(0, "2C")])
        XCTAssertEqual(Set(HeartsGame.legalPlays(s, seat: 1).ids), ["3D", "KS"])
        XCTAssertEqual(HeartsGame.whyNot(s, seat: 1, card: Support.card("QS")), "no points on the first trick")
        XCTAssertEqual(HeartsGame.whyNot(s, seat: 1, card: Support.card("AH")), "no points on the first trick")

        let all = Support.playState(hands: [["2C"], ["QS", "AH", "2H"], ["4C"], ["5C"]], turn: 1, trick: [(0, "2C")])
        XCTAssertEqual(Set(HeartsGame.legalPlays(all, seat: 1).ids), ["QS", "AH", "2H"], "the rule yields")
    }

    func testHeartsMustBeBrokenBeforeTheyAreLedUnlessThatIsAllYouHold() {
        let s = Support.playState(hands: [["AH", "2H", "3D", "KS"], ["9C"], ["4C"], ["5C"]], turn: 0, tricksPlayed: 3)
        XCTAssertEqual(Set(HeartsGame.legalPlays(s, seat: 0).ids), ["3D", "KS"])
        XCTAssertEqual(HeartsGame.whyNot(s, seat: 0, card: Support.card("AH")), "hearts have not been broken")

        var broken = s
        broken.heartsBroken = true
        XCTAssertEqual(Set(HeartsGame.legalPlays(broken, seat: 0).ids), ["AH", "2H", "3D", "KS"])
        XCTAssertNil(HeartsGame.whyNot(broken, seat: 0, card: Support.card("AH")))

        let only = Support.playState(hands: [["AH", "2H"], ["9C"], ["4C"], ["5C"]], turn: 0, tricksPlayed: 3)
        XCTAssertEqual(Set(HeartsGame.legalPlays(only, seat: 0).ids), ["AH", "2H"], "the rule yields")

        // The queen of spades may be led any time after the first trick.
        let queen = Support.playState(hands: [["QS", "2H"], ["9C"], ["4C"], ["5C"]], turn: 0, tricksPlayed: 3)
        XCTAssertEqual(HeartsGame.legalPlays(queen, seat: 0).ids, ["QS"])
    }

    func testDiscardingAHeartBreaksThem() {
        var s = Support.playState(hands: [["2C", "3D"], ["9C", "AH"], ["4C", "2D"], ["5C", "4D"]], turn: 0)
        var rng = RandomSource(seed: 1)
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .play(Support.card("2C")), rng: &rng).ok)
        // First trick: seat 1 cannot follow and may not discard the heart.
        XCTAssertEqual(HeartsGame.legalPlays(s, seat: 1).ids, ["9C"])
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 1, action: .play(Support.card("9C")), rng: &rng).ok)
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 2, action: .play(Support.card("4C")), rng: &rng).ok)
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 3, action: .play(Support.card("5C")), rng: &rng).ok)
        XCTAssertEqual(s.turn, 1)
        XCTAssertFalse(s.heartsBroken)
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 1, action: .play(Support.card("AH")), rng: &rng).ok,
                      "nothing but a heart: the lead rule yields")
        XCTAssertTrue(s.heartsBroken)
        XCTAssertTrue(s.log.events.contains { $0.kind == .info && $0.text == "Hearts are broken." })
    }

    func testTheGameEndsOnTheHandSomebodyReachesTheTarget() {
        for target in [50, 100] {
            for seed: UInt64 in [11, 12, 13] {
                let end = Support.playGame(seed: seed, config: Support.config(pointsToWin: target))
                XCTAssertTrue(end.players.contains { $0.score >= target }, "target \(target), seed \(seed)")
                for h in end.history.dropLast() {
                    XCTAssertTrue(h.scores.allSatisfy { $0 < target },
                                  "hand \(h.deal) left somebody at or past \(target) and the game carried on")
                }
                let low = end.players.map(\.score).min()!
                let winners = end.players.filter { $0.score == low }
                XCTAssertEqual(end.winner, winners.count == 1 ? winners[0].index : nil, "lowest score wins")
            }
        }
    }

    // MARK: - The oracle, by elimination, over random legal play

    /// Start from the whole hand and remove what the rules forbid, then put
    /// everything back if nothing survives. The engine does it the other way.
    static func oracleLegal(_ s: HeartsState, seat: Int) -> Set<Card> {
        let hand = s.players[seat].hand
        let leading = s.trick.isEmpty
        let first = s.tricksPlayed == 0
        if leading && first, hand.contains(HeartsCards.twoOfClubs) { return [HeartsCards.twoOfClubs] }
        var allowed = hand
        if !leading {
            let led = s.trick[0].card.suit
            if hand.contains(where: { $0.suit == led }) { allowed = allowed.filter { $0.suit == led } }
        }
        if leading && !first && !Support.heartEverPlayed(s) {
            let notHearts = allowed.filter { $0.suit != .hearts }
            if !notHearts.isEmpty { allowed = notHearts }
        }
        if first {
            let safe = allowed.filter { HeartsGame.pointsOf([$0]) == 0 }
            if !safe.isEmpty { allowed = safe }
        }
        if allowed.isEmpty { allowed = hand }
        return Set(allowed)
    }

    /// Two low, ace high, written out rather than asked of the engine.
    static let literalRankOrder: [Rank] = [.two, .three, .four, .five, .six, .seven, .eight, .nine, .ten, .jack, .queen, .king, .ace]

    static func oracleWinner(_ plays: [HeartsTrickPlay]) -> Int {
        let led = plays[0].card.suit
        var best = plays[0]
        for p in plays.dropFirst() where p.card.suit == led
            && literalRankOrder.firstIndex(of: p.card.rank)! > literalRankOrder.firstIndex(of: best.card.rank)! { best = p }
        return best.seat
    }

    func testEngineAgreesWithTheOracleOverRandomLegalPlay() {
        var moons = 0, heartsLed = 0, firstTrickDiscards = 0, hands = 0, tricks = 0, queens = 0
        var dirs = Set<HeartsPassDirection>()
        var rng = RandomSource(seed: 20260821)
        for (games, target) in [(24, 100), (10, 50)] {
            for _ in 0..<games {
                var s = HeartsGame.createGame(Support.config(pointsToWin: target))
                XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
                var guard_ = 0
                while s.phase != .gameOver && guard_ < 6000 {
                    guard_ += 1
                    switch s.phase {
                    case .passing:
                        guard let seat = HeartsGame.seatToAct(s) else { XCTFail("passing with nobody to act"); return }
                        let chosen = Array(s.players[seat].hand.prefix(3))
                        let r = HeartsGame.applyAction(&s, seat: seat, action: .pass(chosen), rng: &rng)
                        XCTAssertTrue(r.ok, r.reason ?? "")
                        if s.phase == .passing { XCTAssertTrue(s.players.allSatisfy { $0.hand.count == 13 }) }
                    case .play:
                        let seat = s.turn
                        let mine = Set(HeartsGame.legalPlays(s, seat: seat))
                        let theirs = Self.oracleLegal(s, seat: seat)
                        XCTAssertEqual(mine, theirs, "legal plays differ at trick \(s.tricksPlayed), \(s.trick.count) played")
                        XCTAssertEqual(s.heartsBroken, Support.heartEverPlayed(s), "heartsBroken drifted from the cards")
                        let all = Support.allCards(s)
                        XCTAssertEqual(all.count, 52)
                        XCTAssertEqual(Set(all).count, 52, "a card is in two places at once")
                        if s.tricksPlayed == 0 && s.trick.isEmpty { XCTAssertEqual(s.turn, HeartsGame.holderOfTwoOfClubs(s)) }
                        if s.trick.isEmpty && s.tricksPlayed > 0 && s.heartsBroken && mine.contains(where: { $0.suit == .hearts }) { heartsLed += 1 }
                        if s.tricksPlayed == 0 && !s.trick.isEmpty && !s.players[seat].hand.contains(where: { $0.suit == s.trick[0].card.suit }) { firstTrickDiscards += 1 }

                        let legal = Array(theirs).sorted { $0.id < $1.id }
                        let pick = legal[rng.nextInt(below: legal.count)]
                        let before = s.trick
                        let r = HeartsGame.applyAction(&s, seat: seat, action: .play(pick), rng: &rng)
                        XCTAssertTrue(r.ok, "legal play refused: \(pick.id) — \(r.reason ?? "")")
                        if before.count == 3 {
                            tricks += 1
                            let plays = before + [HeartsTrickPlay(seat: seat, card: pick)]
                            XCTAssertEqual(s.lastTrick?.winner, Self.oracleWinner(plays))
                            XCTAssertEqual(s.lastTrick?.points, plays.reduce(0) { $0 + HeartsGame.pointsOf([$1.card]) })
                        }
                    case .handOver, .gameOver:
                        hands += 1
                        dirs.insert(s.passDirection)
                        let raw = s.players.map { $0.taken.reduce(0) { $0 + HeartsGame.pointsOf([$1]) } }
                        XCTAssertEqual(raw.reduce(0, +), 26)
                        XCTAssertEqual(s.players.reduce(0) { $0 + $1.taken.count }, 52)
                        let qs = s.players.filter(\.hasQueen)
                        XCTAssertEqual(qs.count, 1)
                        queens += qs.count
                        guard let last = s.history.last else { XCTFail("no history row"); return }
                        if let shot = raw.firstIndex(of: 26) {
                            moons += 1
                            XCTAssertEqual(last.shooter, shot)
                            XCTAssertEqual(last.points, (0..<4).map { $0 == shot ? 0 : 26 })
                        } else {
                            XCTAssertNil(last.shooter)
                            XCTAssertEqual(last.points, raw)
                        }
                        var sums = [0, 0, 0, 0]
                        for h in s.history { for i in 0..<4 { sums[i] += h.points[i] } }
                        XCTAssertEqual(s.players.map(\.score), sums)
                        if s.phase == .handOver {
                            XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).ok)
                        }
                    case .idle:
                        XCTFail("back to idle mid-game")
                        return
                    }
                }
                XCTAssertEqual(s.phase, .gameOver, "game did not finish")
            }
        }
        XCTAssertGreaterThan(hands, 0)
        XCTAssertGreaterThan(tricks, 100)
        XCTAssertGreaterThan(queens, 0, "the queen of spades was never taken")
        XCTAssertGreaterThan(heartsLed, 0, "a heart was never led, so the broken-hearts rule went untested")
        XCTAssertGreaterThan(firstTrickDiscards, 0, "nobody failed to follow on the first trick")
        XCTAssertEqual(dirs.count, 4, "not every passing direction came up")
        _ = moons  // random play rarely shoots; reported by the AI invariants instead
    }
}
