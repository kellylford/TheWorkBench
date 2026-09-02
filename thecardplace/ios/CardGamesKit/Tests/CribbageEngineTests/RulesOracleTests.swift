import XCTest
import CardCore
@testable import CribbageEngine

/// The only test that knows what cribbage IS. The rules are re-implemented
/// here from the How to Play text — AND DELIBERATELY BY DIFFERENT ALGORITHMS:
///
///   fifteens   the engine enumerates subsets with a bitmask. This recurses.
///   runs       the engine enumerates subsets and counts maximal ones. This
///              builds a rank histogram and multiplies the multiplicities.
///   pairs      the engine groups by rank and looks up 2/6/12. This uses the
///              combination formula.
///
/// This file may not call the engine's scoring to decide what it expects.
final class RulesOracleTests: XCTestCase {
    // MARK: The rules, written out

    /// "ace is one, and the ten, jack, queen and king are all ten"
    static let VALUE: [Character: Int] = ["A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
                                          "8": 8, "9": 9, "T": 10, "J": 10, "Q": 10, "K": 10]
    /// "ace is one and the king is thirteen, so a ten really is lower than a jack"
    static let ORDER: [Character: Int] = ["A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
                                          "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13]

    static let SUITS: [Character] = ["C", "S", "H", "D"]
    static let RANKS: [Character] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]
    static let DECK_IDS: [String] = SUITS.flatMap { s in RANKS.map { String($0) + String(s) } }

    static func v(_ id: String) -> Int { VALUE[id.first!]! }
    static func o(_ id: String) -> Int { ORDER[id.first!]! }
    static func suit(_ id: String) -> Character { id.last! }

    /// "2 for every combination adding to 15" — by recursion.
    static func oracleFifteens(_ ids: [String]) -> Int {
        var found = 0
        func walk(_ i: Int, _ sum: Int, _ used: Int) {
            if i == ids.count {
                if used >= 2 && sum == 15 { found += 1 }
                return
            }
            walk(i + 1, sum, used)
            walk(i + 1, sum + v(ids[i]), used + 1)
        }
        walk(0, 0, 0)
        return found * 2
    }

    /// "2 each. Three of a kind is three pairs, so 6; four is 12." — by the
    /// combination formula.
    static func oraclePairs(_ ids: [String]) -> Int {
        var byRank: [Character: Int] = [:]
        for id in ids { byRank[id.first!, default: 0] += 1 }
        return byRank.values.reduce(0) { $0 + ($1 * ($1 - 1) / 2) * 2 }
    }

    /// "one per card, scored once for every distinct set that makes it" — by
    /// histogram and multiplicity.
    static func oracleRuns(_ ids: [String]) -> Int {
        var count = [Int](repeating: 0, count: 15)
        for id in ids { count[o(id)] += 1 }
        var pts = 0
        var at = 1
        while at <= 13 {
            if count[at] == 0 { at += 1; continue }
            var end = at, mult = 1
            while end <= 13 && count[end] > 0 { mult *= count[end]; end += 1 }
            let len = end - at
            if len >= 3 { pts += len * mult }
            at = end
        }
        return pts
    }

    /// "4 for all four matching, 5 if the starter matches too. In the crib it
    /// must be all five or it scores nothing."
    static func oracleFlush(_ hand4: [String], _ starter: String?, _ isCrib: Bool) -> Int {
        let s = suit(hand4[0])
        if !hand4.allSatisfy({ suit($0) == s }) { return 0 }
        let withStarter = starter.map { suit($0) == s } ?? false
        if isCrib { return withStarter ? 5 : 0 }
        return withStarter ? 5 : 4
    }

    /// "the jack of the starter's suit, in your hand"
    static func oracleNob(_ hand4: [String], _ starter: String?) -> Int {
        guard let st = starter else { return 0 }
        return hand4.contains { $0.first == "J" && suit($0) == suit(st) } ? 1 : 0
    }

    static func oracleScore(_ hand4: [String], _ starter: String?, _ isCrib: Bool) -> Int {
        let all = starter.map { hand4 + [$0] } ?? hand4
        return oracleFifteens(all) + oraclePairs(all) + oracleRuns(all)
            + oracleFlush(hand4, starter, isCrib) + oracleNob(hand4, starter)
    }

    /// The play: fifteen 2, thirty-one 2, pairs by the formula, the longest
    /// run at the tail.
    static func oraclePlayPoints(_ seq: [String], _ count: Int) -> Int {
        var pts = 0
        if count == 15 { pts += 2 }
        if count == 31 { pts += 2 }
        let last = seq[seq.count - 1]
        var same = 0
        for id in seq.reversed() {
            if id.first == last.first { same += 1 } else { break }
        }
        if same >= 2 { pts += (same * (same - 1) / 2) * 2 }
        var len = seq.count
        while len >= 3 {
            let tail = seq.suffix(len).map(o).sorted()
            var run = true
            for i in 1..<tail.count where tail[i] != tail[i - 1] + 1 { run = false; break }
            if run { pts += len; break }
            len -= 1
        }
        return pts
    }

    static func shuffled(_ list: [String], _ rng: inout RandomSource) -> [String] {
        list.shuffled(with: &rng)
    }

    // MARK: 1. The deck and the two numbers

    func testTheDeckAndTheTwoNumbers() {
        XCTAssertEqual(Card.fullDeck.count, 52)
        XCTAssertEqual(Set(Card.fullDeck.map(\.id)), Set(Self.DECK_IDS))
        for id in Self.DECK_IDS {
            let c = card(id)
            XCTAssertEqual(CribbageCards.value(c), Self.v(id), "\(id) counts wrong")
            XCTAssertEqual(CribbageCards.order(c), Self.o(id), "\(id) sits wrong in a run")
        }
        XCTAssertLessThan(CribbageCards.order(card("TC")), CribbageCards.order(card("JC")),
                          "a ten must be lower than a jack when cutting for deal")
        XCTAssertEqual(CribbageCards.value(card("TC")), CribbageCards.value(card("JC")),
                       "a ten and a jack must count the same during the play")
    }

    // MARK: 2. Known hands

    static let fixtures: [(hand: [String], starter: String, crib: Bool, want: Int, label: String)] = [
        (["5C", "5S", "5H", "JD"], "5D", false, 29, "the perfect hand"),
        (["5C", "5S", "5H", "5D"], "JC", false, 28, "four fives and a jack cut"),
        (["4C", "5S", "6H", "6D"], "KC", false, 14, "a double run of three with a fifteen"),
        (["4C", "5S", "6H", "7D"], "8C", false, 9, "a run of five and two fifteens"),
        (["AC", "2S", "3H", "KD"], "5C", false, 7, "a run of three, and two fifteens with it"),
        (["AC", "3S", "7D", "JH"], "KS", false, 0, "a hand worth absolutely nothing"),
        (["4C", "6C", "8C", "KC"], "2C", false, 5, "a five-card flush"),
        (["4C", "6C", "8C", "KC"], "2H", false, 4, "a four-card flush in the hand"),
        (["4C", "6C", "8C", "KC"], "2H", true, 0, "a four-card flush in the CRIB scores nothing"),
        (["4C", "6C", "8C", "KC"], "2C", true, 5, "a five-card flush in the crib does score"),
        (["JC", "2S", "4H", "9D"], "KC", false, 3, "a fifteen and one for his nob"),
        (["JC", "2S", "4H", "9D"], "KH", false, 2, "the same hand, but the jack is the wrong suit for a nob"),
        (["7C", "8S", "7H", "8D"], "9C", false, 24, "the double-double run"),
        (["3C", "4S", "5H", "6D"], "3D", false, 14, "a double run of four with fifteens"),
    ]

    func testKnownHands() {
        for f in Self.fixtures {
            let oracle = Self.oracleScore(f.hand, f.starter, f.crib)
            XCTAssertEqual(oracle, f.want, "THE ORACLE ITSELF is wrong about \(f.label)")
            let got = CribbageScoring.scoreHand(f.hand.map(card), starter: card(f.starter), isCrib: f.crib)
            XCTAssertEqual(got.total, f.want, "\(f.label): \(got.spoken)")
            XCTAssertEqual(got.items.reduce(0) { $0 + $1.points }, got.total, "\(f.label): the breakdown does not add up")
        }
        // The breakdown, in words.
        let perfect = CribbageScoring.scoreHand(cards("5C", "5S", "5H", "JD"), starter: card("5D"), isCrib: false)
        XCTAssertEqual(perfect.spoken, "eight fifteens for sixteen, four fives for twelve, one for his nob — twenty-nine")
        let double = CribbageScoring.scoreHand(cards("4C", "5S", "6H", "6D"), starter: card("KC"), isCrib: false)
        XCTAssertEqual(double.spoken, "three fifteens for six, a pair of sixes for two, two runs of three for six — fourteen")
        let nothing = CribbageScoring.scoreHand(cards("AC", "3S", "7D", "JH"), starter: card("KS"), isCrib: false)
        XCTAssertEqual(nothing.spoken, "nothing")
        XCTAssertEqual(CribbageScoring.scoreHand(cards("JC", "2S", "4H", "9D"), starter: card("KC"), isCrib: false).spoken,
                       "fifteen for two, one for his nob — three")
    }

    // MARK: 3. Every hand, against the other algorithm

    func testRandomHandsAgainstTheOracle() {
        var rng = RandomSource(seed: 8675309)
        var reached = ["flush4": 0, "flush5": 0, "nob": 0, "doubleRun": 0, "tripleRun": 0, "big": 0, "zero": 0]
        var checked = 0

        for n in 0..<20000 {
            let picked = Array(Self.shuffled(Self.DECK_IDS, &rng).prefix(5))
            let hand = Array(picked.prefix(4)), starter = picked[4]
            let isCrib = n % 3 == 0
            let want = Self.oracleScore(hand, starter, isCrib)
            let got = CribbageScoring.scoreHand(hand.map(card), starter: card(starter), isCrib: isCrib)
            checked += 1
            if want != got.total {
                XCTFail("\(hand.joined(separator: " ")) + \(starter)\(isCrib ? " (crib)" : ""): engine \(got.total), rules \(want) — \(got.spoken)")
                return
            }
            XCTAssertEqual(got.items.reduce(0) { $0 + $1.points }, got.total)
            XCTAssertEqual(CribbageScoring.quickTotal(hand.map(card), starter: card(starter), isCrib: isCrib), want,
                           "the computer's quick total disagrees with the rules")
            if Self.oracleFlush(hand, starter, false) == 4 { reached["flush4"]! += 1 }
            if Self.oracleFlush(hand, starter, false) == 5 { reached["flush5"]! += 1 }
            if Self.oracleNob(hand, starter) > 0 { reached["nob"]! += 1 }
            let runPts = Self.oracleRuns(hand + [starter])
            if runPts == 6 || runPts == 8 { reached["doubleRun"]! += 1 }
            if runPts >= 9 { reached["tripleRun"]! += 1 }
            if want >= 20 { reached["big"]! += 1 }
            if want == 0 { reached["zero"]! += 1 }
        }

        // Deliberately weighted decks, because a uniform sample almost never
        // produces the hands where the scoring is hard.
        let nasty: [Character] = ["4", "5", "5", "5", "6", "6", "7", "7", "8", "J", "T", "5"]
        let pool = nasty.flatMap { r in Self.SUITS.map { String(r) + String($0) } }
        for n in 0..<8000 {
            var picked: [String] = []
            var seen = Set<String>()
            for id in Self.shuffled(pool, &rng) where seen.insert(id).inserted {
                picked.append(id)
                if picked.count == 5 { break }
            }
            let hand = Array(picked.prefix(4)), starter = picked[4]
            let isCrib = n % 4 == 0
            let want = Self.oracleScore(hand, starter, isCrib)
            let got = CribbageScoring.scoreHand(hand.map(card), starter: card(starter), isCrib: isCrib)
            checked += 1
            if want != got.total {
                XCTFail("weighted \(hand.joined(separator: " ")) + \(starter): engine \(got.total), rules \(want)")
                return
            }
            XCTAssertEqual(CribbageScoring.quickTotal(hand.map(card), starter: card(starter), isCrib: isCrib), want)
            let runPts = Self.oracleRuns(hand + [starter])
            if runPts == 6 || runPts == 8 { reached["doubleRun"]! += 1 }
            if runPts >= 9 { reached["tripleRun"]! += 1 }
            if want >= 20 { reached["big"]! += 1 }
        }

        for (name, min) in [("flush4", 10), ("flush5", 1), ("nob", 400), ("doubleRun", 200),
                            ("tripleRun", 20), ("big", 50), ("zero", 100)] {
            XCTAssertGreaterThanOrEqual(reached[name]!, min, "only \(reached[name]!) hands reached \(name)")
        }
        XCTAssertEqual(checked, 28000)
    }

    // MARK: 4. The play

    func testPlayPointsAgainstTheOracle() {
        var rng = RandomSource(seed: 4242)
        var reached = ["fifteen": 0, "thirtyone": 0, "pair": 0, "three": 0, "four": 0, "run": 0]
        var checks = 0

        for _ in 0..<10000 {
            let bag = Self.shuffled(Self.DECK_IDS, &rng)
            var seq: [String] = []
            var count = 0
            let wanted = 2 + rng.nextInt(below: 5)
            for id in bag {
                if count + Self.v(id) > 31 { continue }
                seq.append(id)
                count += Self.v(id)
                if seq.count >= wanted { break }
            }
            if seq.count < 2 { continue }
            let candidate = seq[seq.count - 1]
            let before = Array(seq.dropLast())
            let beforeCount = count - Self.v(candidate)

            let want = Self.oraclePlayPoints(seq, count)
            let pure = CribbageScoring.pointsForPlay(sequence: before.map(card), count: beforeCount, card: card(candidate))

            // And through a state the engine accepts, with the sequence down.
            var st = CribbageGame.createGame(Sim.config(.hard, 121))
            st.phase = .play
            st.count = beforeCount
            st.runStart = 0
            st.pile = before.enumerated().map { CribbagePilePlay(player: $0.offset % 2, card: card($0.element)) }
            let got = CribbageGame.pointsForPlay(st, card: card(candidate))

            checks += 1
            if want != got.total || want != pure.total {
                XCTFail("play \(before.joined(separator: " ")) then \(candidate) at \(beforeCount): engine \(got.total), rules \(want)")
                return
            }
            XCTAssertEqual(got.count, count)
            XCTAssertTrue(got.total == 0 || !got.breakdown.items.isEmpty)
            XCTAssertEqual(got.breakdown.items.reduce(0) { $0 + $1.points }, got.total)

            if count == 15 { reached["fifteen"]! += 1 }
            if count == 31 { reached["thirtyone"]! += 1 }
            var same = 0
            for id in seq.reversed() { if id.first == candidate.first { same += 1 } else { break } }
            if same == 2 { reached["pair"]! += 1 }
            if same == 3 { reached["three"]! += 1 }
            if same == 4 { reached["four"]! += 1 }
            if want > 0 && same < 2 && count != 15 && count != 31 { reached["run"]! += 1 }
        }
        for (name, min) in [("fifteen", 60), ("thirtyone", 30), ("pair", 60), ("run", 15)] {
            XCTAssertGreaterThanOrEqual(reached[name]!, min, "only \(reached[name]!) plays reached \(name)")
        }
        XCTAssertGreaterThan(checks, 9000)
    }

    // MARK: 5. The count reset

    func testTheCountReset() {
        var st = CribbageGame.createGame(Sim.config(.hard, 121))
        st.phase = .play
        // Kings, so the count cannot reach fifteen or thirty-one and confuse
        // the two points a pair is worth with the two a fifteen is.
        st.pile = [CribbagePilePlay(player: 0, card: card("KC")), CribbagePilePlay(player: 1, card: card("KS"))]
        st.runStart = 0
        st.count = 20
        XCTAssertEqual(CribbageGame.pointsForPlay(st, card: card("KH")).total, 6,
                       "three kings in one sequence must be three of a kind for six")
        st.runStart = 2
        st.count = 0
        XCTAssertEqual(CribbageGame.pointsForPlay(st, card: card("KH")).total, 0,
                       "a king laid after a count reset must NOT pair with kings from before it")

        st.pile = [CribbagePilePlay(player: 0, card: card("AC")), CribbagePilePlay(player: 1, card: card("AS")),
                   CribbagePilePlay(player: 0, card: card("AH"))]
        st.runStart = 0
        st.count = 3
        let four = CribbageGame.pointsForPlay(st, card: card("AD"))
        XCTAssertEqual(four.total, 12, "four of a kind during the play is twelve")
        XCTAssertEqual(four.phrase, "four of a kind for twelve")

        st.pile = [CribbagePilePlay(player: 0, card: card("KC")), CribbagePilePlay(player: 1, card: card("2S"))]
        st.runStart = 0
        st.count = 12
        XCTAssertEqual(CribbageGame.pointsForPlay(st, card: card("KH")).total, 0, "a king, then a two, then a king is not a pair")

        st.pile = [CribbagePilePlay(player: 0, card: card("3C")), CribbagePilePlay(player: 1, card: card("4S"))]
        st.runStart = 0
        st.count = 7
        XCTAssertEqual(CribbageGame.pointsForPlay(st, card: card("5H")).total, 3, "three, four, five is a run of three")
        st.runStart = 2
        st.count = 0
        XCTAssertEqual(CribbageGame.pointsForPlay(st, card: card("5H")).total, 0, "a run must not be built across a count reset")

        // Fifteen and a pair together, said the way a player says it.
        st.pile = [CribbagePilePlay(player: 0, card: card("5C")), CribbagePilePlay(player: 1, card: card("5S"))]
        st.runStart = 0
        st.count = 10
        let both = CribbageGame.pointsForPlay(st, card: card("5H"))
        XCTAssertEqual(both.total, 8)
        XCTAssertEqual(both.phrase, "fifteen for two and three of a kind for six")
    }

    // MARK: 6. Whole hands, re-scored by the oracle

    func testWholeHandsRescored() {
        var seen = ["heels": 0, "go": 0, "lastCard": 0, "thirtyOne": 0]
        for g in Sim.games {
            XCTAssertTrue(g.state.gameOver, "a game never finished (seed \(g.seed))")
            for h in g.state.history {
                guard let starter = h.starter else { continue }
                for c in h.counts {
                    let cs = c.kind == .crib ? h.crib : h.kept[c.who]
                    if cs.count != 4 { continue }
                    let want = Self.oracleScore(cs.map(\.id), starter.id, c.kind == .crib)
                    XCTAssertEqual(c.result.total, want,
                                   "hand \(h.handNumber): the \(c.kind) scored \(c.result.total), the rules give \(want)")
                }
                var running = 0
                for e in h.pile {
                    let v = Self.v(e.card.id)
                    if running + v > 31 { running = 0 }
                    running += v
                    XCTAssertLessThanOrEqual(running, 31)
                    if running == 31 { seen["thirtyOne"]! += 1 }
                }
                if starter.rank == .jack { seen["heels"]! += 1 }
            }
            for e in g.state.log.events {
                if e.text.contains("for the go") { seen["go"]! += 1 }
                if e.text.contains("for the last card") { seen["lastCard"]! += 1 }
            }
        }
        for (name, min) in [("heels", 5), ("go", 50), ("lastCard", 50), ("thirtyOne", 20)] {
            XCTAssertGreaterThanOrEqual(seen[name]!, min, "only \(seen[name]!) hands reached \(name)")
        }
    }

    // MARK: 7. The ledger

    /// Replay a completed hand from the permanent record and derive every
    /// point from the rules — his heels, every card of the pegging, the go,
    /// the last card, both hands and the crib — re-deriving WHOSE TURN it was
    /// from the cards each player still held.
    static func replayHand(_ h: CribbageHandRecord) -> (got: [Int], notes: [String]) {
        var got = [0, 0]
        var notes: [String] = []
        guard let starter = h.starter else { return (got, ["no starter"]) }
        if starter.rank == .jack { got[h.dealer] += 2 }

        var remaining = [Set(h.kept[0].map(\.id)), Set(h.kept[1].map(\.id))]
        var turn = 1 - h.dealer
        var count = 0
        var seq: [String] = []

        for (i, e) in h.pile.enumerated() {
            let id = e.card.id
            if e.player != turn {
                notes.append("card \(i + 1) was laid by seat \(e.player + 1), the rules say seat \(turn + 1)")
                return (got, notes)
            }
            if !remaining[e.player].contains(id) {
                notes.append("card \(i + 1) (\(id)) was not in seat \(e.player + 1)'s hand")
                return (got, notes)
            }
            let v = Self.v(id)
            if count + v > 31 {
                notes.append("card \(i + 1) (\(id)) took the count to \(count + v)")
                return (got, notes)
            }
            count += v
            seq.append(id)
            got[e.player] += oraclePlayPoints(seq, count)
            remaining[e.player].remove(id)

            if remaining[0].isEmpty && remaining[1].isEmpty {
                if count != 31 { got[e.player] += 1 }
                break
            }
            let opp = 1 - e.player
            func canPlay(_ s: Int) -> Bool { remaining[s].contains { count + Self.v($0) <= 31 } }
            func leadAfterReset() -> Int { remaining[opp].isEmpty ? e.player : opp }

            if count == 31 { count = 0; seq = []; turn = leadAfterReset(); continue }
            if canPlay(opp) { turn = opp; continue }
            if canPlay(e.player) { turn = e.player; continue }
            got[e.player] += 1
            count = 0; seq = []; turn = leadAfterReset()
        }

        for c in h.counts {
            let cs = c.kind == .crib ? h.crib : h.kept[c.who]
            if cs.count != 4 { continue }
            got[c.who] += oracleScore(cs.map(\.id), starter.id, c.kind == .crib)
        }
        return (got, notes)
    }

    func testTheLedger() {
        var ledgered = 0
        for g in Sim.games {
            var prev = [0, 0]
            for h in g.state.history {
                let complete = h.counts.count == 3 && !(h.result?.gameOver ?? false)
                if !complete { prev = h.scores; continue }
                let (got, notes) = Self.replayHand(h)
                ledgered += 1
                if !notes.isEmpty {
                    XCTFail("hand \(h.handNumber) (seed \(g.seed)): " + notes.joined(separator: "; "))
                    prev = h.scores
                    continue
                }
                let moved = [h.scores[0] - prev[0], h.scores[1] - prev[1]]
                XCTAssertEqual(got, moved, "hand \(h.handNumber) (seed \(g.seed)): the rules give \(got) but the scores moved \(moved)")
                prev = h.scores
            }
        }
        XCTAssertGreaterThan(ledgered, 300, "only \(ledgered) hands were put through the ledger")
    }
}
