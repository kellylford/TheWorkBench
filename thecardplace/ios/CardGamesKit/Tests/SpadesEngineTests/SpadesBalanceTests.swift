import XCTest
import CardCore
import SpadesEngine

/// Is this a game, or is it four bots agreeing with each other? The port of
/// `spades/tests/balance.js`: the same measured bands, on two seeds, so a
/// drift in the bidding is caught rather than a crash.
final class SpadesBalanceTests: XCTestCase {

    struct Stats {
        var games = 0, hands = 0, tableBid = 0, set = 0, made = 0, bagPens = 0
        var nils = 0, nilsMade = 0, wins = [0, 0], blowouts = 0
        var bidCounts = Set<Int>()
        var openers = [0, 0, 0, 0]
    }

    func run(seed: UInt64, games: Int) -> Stats {
        var s = Stats()
        for g in 0..<games {
            var (state, rng) = Drive.newGame(seed: seed &+ UInt64(g) &* 7919)
            s.openers[state.dealer!] += 1
            var guardCount = 0
            while state.phase != .gameOver && guardCount < 40_000 {
                guardCount += 1
                guard let r = Drive.step(&state, rng: &rng), r.ok else { XCTFail("a move was refused"); return s }
            }
            guard state.phase == .gameOver else { XCTFail("a game never finished"); return s }

            s.games += 1
            s.hands += state.dealNumber
            s.wins[state.winner!] += 1
            if abs(state.scores[0] - state.scores[1]) > 400 { s.blowouts += 1 }

            var prevBags = [0, 0]
            for h in state.history {
                s.tableBid += h.bids.reduce(0, +)
                for (i, b) in h.bids.enumerated() {
                    s.bidCounts.insert(b)
                    if b == 0 { s.nils += 1; if h.tricks[i] == 0 { s.nilsMade += 1 } }
                }
                for t in 0..<2 {
                    let bid = h.bids[t] + h.bids[t + 2]
                    let took = h.tricks[t] + h.tricks[t + 2]
                    if took >= bid { s.made += 1 } else { s.set += 1 }
                    if h.bags[t] < prevBags[t] { s.bagPens += 1 }
                }
                prevBags = h.bags
            }
        }
        return s
    }

    func band(_ name: String, _ value: Double, _ lo: Double, _ hi: Double, _ why: String,
              file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(value >= lo && value <= hi,
                      "\(name) is \((value * 100).rounded() / 100), outside \(lo)–\(hi). \(why)",
                      file: file, line: line)
    }

    func testTheBiddingIsADecisionAndTheContractsAreAtRisk() {
        for seed in [UInt64(20260825), UInt64(991)] {
            let s = run(seed: seed, games: 120)
            guard s.games > 0 else { continue }
            let games = Double(s.games), hands = Double(s.hands)

            band("table bid (of 13)", Double(s.tableBid) / hands, 11.0, 12.8,
                 "Under 11 the bots leave tricks on the table and win on bag penalties; over 12.8 they bid more than exists.")
            band("contracts set (%)", 100 * Double(s.set) / Double(s.set + s.made), 10, 30,
                 "This is the tension in the game.")
            band("hands per game", hands / games, 7, 16,
                 "Too few and the game is over before it starts; too many and it outstays its welcome.")
            band("bag penalties per game", Double(s.bagPens) / games, 0.15, 2.0,
                 "Zero means the bag rule is decoration; more than two a game means the game is decided by sandbagging.")
            band("hands with a nil (%)", 100 * Double(s.nils) / hands, 2, 25,
                 "Never bidding nil wastes a rule; bidding it constantly means nilWorthy is not strict enough.")
            if s.nils > 0 {
                band("nils made (%)", 100 * Double(s.nilsMade) / Double(s.nils), 70, 100,
                     "nilWorthy is deliberately strict.")
            }
            band("seats 1+3 win rate (%)", 100 * Double(s.wins[1]) / games, 33, 67,
                 "The two sides run identical code; a lean means something depends on seat order.")
            band("rarest opening dealer (%)", 100 * Double(s.openers.min()!) / games, 8, 25,
                 "Seats \(s.openers) dealt the opening hand; a seat that never does means the first dealer is fixed.")
            band("distinct bids used", Double(s.bidCounts.count), 5, 14,
                 "If the bots only ever bid two or three, the count is not reading the hand.")
            band("blowouts (%)", 100 * Double(s.blowouts) / games, 0, 45,
                 "A game where one side is never in it. Some are expected; mostly is not.")
        }
    }
}
