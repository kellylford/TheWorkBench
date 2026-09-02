import XCTest
import CardCore
import SpadesEngine

/// The scoring against worked examples with the arithmetic written out by
/// hand — the port of `spades/tests/scoring.js`. Seats are 0..3; teams are 0
/// (seats 0 and 2) and 1 (seats 1 and 3).
final class SpadesScoringTests: XCTestCase {

    struct Rules { let bagLimit: Int, bagPenalty: Int, nilValue: Int }
    static let std = Rules(bagLimit: 10, bagPenalty: 100, nilValue: 100)

    struct Row {
        let name: String
        let bids: [Int], tricks: [Int], bagsIn: [Int]
        var rules: Rules = SpadesScoringTests.std
        let delta: [Int], bags: [Int]
        let why: String
    }

    static let rows: [Row] = [
        Row(name: "the ordinary made contract",
            bids: [3, 4, 2, 4], tricks: [3, 4, 2, 4], bagsIn: [0, 0],
            delta: [50, 80], bags: [0, 0],
            why: "team 0 bid 5 took 5 = +50; team 1 bid 8 took 8 = +80"),
        Row(name: "overtricks are worth one point and one bag each",
            bids: [3, 3, 2, 3], tricks: [4, 3, 3, 3], bagsIn: [0, 0],
            delta: [52, 60], bags: [2, 0],
            why: "team 0 bid 5 took 7 = 50 + 2 overtricks; two bags banked"),
        Row(name: "missing by one loses the whole bid, not the difference",
            bids: [4, 3, 3, 3], tricks: [3, 4, 3, 3], bagsIn: [0, 0],
            delta: [-70, 61], bags: [0, 1],
            why: "team 0 bid 7 took 6 — minus ten a trick for all seven, not for the one; team 1 bid 6 took 7 = 60 + 1 overtrick, and banks the bag that came with it"),
        Row(name: "a set hand banks no bags, because there was no contract to be over",
            bids: [6, 2, 5, 0], tricks: [2, 5, 3, 3], bagsIn: [4, 0],
            delta: [-110, -74], bags: [4, 6],
            why: "team 0 bid 11 took 5 = -110 and its bags are untouched; team 1 bid 2 took 8 = 20 + 6 overtricks = 26, then the nil at seat 3 went down on 3 = -100, so -74, and it banks all six bags"),
        Row(name: "the tenth bag costs a hundred and the count carries the remainder",
            bids: [3, 4, 3, 3], tricks: [5, 4, 4, 0], bagsIn: [7, 0],
            delta: [-37, -70], bags: [0, 0],
            why: "team 0 bid 6 took 9 = 60 + 3 overtricks = 63, but 7 + 3 fills the bin: 63 - 100 = -37, and 10 - 10 leaves 0. Team 1 bid 7 and took 4, so it is set"),
        Row(name: "a hand can fill the bin and leave bags over",
            bids: [2, 5, 2, 4], tricks: [5, 5, 3, 0], bagsIn: [8, 0],
            delta: [-56, -90], bags: [2, 0],
            why: "team 0 bid 4 took 8 = 40 + 4 = 44; 8 + 4 = 12 bags fills one bin, 44 - 100 = -56, and 12 - 10 leaves 2"),
        Row(name: "a nil that comes in is a hundred, on top of the partner's contract",
            bids: [0, 4, 4, 4], tricks: [0, 4, 5, 4], bagsIn: [0, 0],
            delta: [141, 80], bags: [1, 0],
            why: "team 0 contract is 0 + 4 = 4, took 5 = 40 + 1 over = 41, plus 100 for the nil"),
        Row(name: "a nil that goes down is minus a hundred, and its tricks still count",
            bids: [0, 4, 4, 4], tricks: [2, 4, 3, 4], bagsIn: [0, 0],
            delta: [-59, 80], bags: [1, 0],
            why: "team 0 contract 4, took 2 + 3 = 5 — the broken nil's two tricks count, so the contract is MADE: 40 + 1 over = 41, then -100 for the nil = -59"),
        Row(name: "a broken nil can carry the contract home on its own tricks",
            bids: [0, 5, 3, 5], tricks: [3, 5, 0, 5], bagsIn: [0, 0],
            delta: [-70, 100], bags: [0, 0],
            why: "team 0 contract 3, took 3 + 0 = 3 — made exactly, +30, then -100 = -70"),
        Row(name: "both partners nil, both in",
            bids: [0, 7, 0, 6], tricks: [0, 7, 0, 6], bagsIn: [0, 0],
            delta: [200, 130], bags: [0, 0],
            why: "a contract of zero is made by definition — 10 x 0 = 0 — and the two nils are worth a hundred each"),
        Row(name: "both partners nil, one down",
            bids: [0, 6, 0, 5], tricks: [0, 6, 2, 5], bagsIn: [0, 0],
            delta: [2, 110], bags: [2, 0],
            why: "contract 0, took 2, so it is made with two overtricks = +2; one nil in (+100) and one down (-100) cancel"),
        Row(name: "thirteen tricks, one partnership, everything",
            bids: [6, 0, 7, 0], tricks: [6, 0, 7, 0], bagsIn: [0, 0],
            delta: [130, 200], bags: [0, 0],
            why: "team 0 bid 13 took 13 = +130; team 1 both nil and both in = +200"),
        Row(name: "a zero-bag-penalty table counts bags and does not punish them",
            bids: [2, 3, 2, 3], tricks: [5, 3, 2, 3], bagsIn: [9, 0],
            rules: Rules(bagLimit: 10, bagPenalty: 0, nilValue: 100),
            delta: [43, 60], bags: [2, 0],
            why: "bid 4 took 7 = 40 + 3 = 43; 9 + 3 = 12 crosses the limit but costs nothing, and the remainder is still 2"),
        Row(name: "a five-bag table fills its bin twice as often",
            bids: [2, 3, 2, 3], tricks: [4, 3, 3, 3], bagsIn: [3, 0],
            rules: Rules(bagLimit: 5, bagPenalty: 50, nilValue: 100),
            delta: [-7, 60], bags: [1, 0],
            why: "bid 4 took 7 = 40 + 3 = 43; 3 + 3 = 6 fills a bin of five, so 43 - 50 = -7, and 6 - 5 leaves one bag behind rather than none"),
    ]

    func testWorkedExamples() {
        XCTAssertEqual(SpadesScoringTests.rows.count, 14)
        for row in SpadesScoringTests.rows {
            XCTAssertEqual(row.tricks.reduce(0, +), 13, "\(row.name): the case itself deals the wrong number of tricks")
            let r = SpadesGame.scoreHand(bids: row.bids, tricks: row.tricks, bagsIn: row.bagsIn,
                                         bagLimit: row.rules.bagLimit, bagPenalty: row.rules.bagPenalty,
                                         nilValue: row.rules.nilValue)
            XCTAssertEqual(r.delta, row.delta, "\(row.name): \(row.why)")
            XCTAssertEqual(r.bags, row.bags, "\(row.name): bags — \(row.why)")
        }
    }

    func testScoreHandIsPureAndRepeatable() {
        let bagsIn = [7, 3]
        let bids = [3, 3, 3, 3]
        let a = SpadesGame.scoreHand(bids: bids, tricks: [4, 3, 3, 3], bagsIn: bagsIn, bagLimit: 10, bagPenalty: 100, nilValue: 100)
        let b = SpadesGame.scoreHand(bids: bids, tricks: [4, 3, 3, 3], bagsIn: bagsIn, bagLimit: 10, bagPenalty: 100, nilValue: 100)
        XCTAssertEqual(a, b)
        XCTAssertEqual(bagsIn, [7, 3])
        XCTAssertEqual(a.bags, [8, 3])
        XCTAssertEqual(a.delta, [61, 60])
        XCTAssertEqual(a.detail[0].overtricks, 1)
        XCTAssertEqual(a.detail[0].base, 60)
        XCTAssertTrue(a.detail[0].made)
    }

    /// Every split of thirteen tricks against every plausible contract: peel
    /// the nils and the bag penalty off the total and what is left must be
    /// exactly the contract.
    func testEveryBidAndTrickCombinationHasTheRightShape() {
        var cases = 0
        for b0 in 0...7 {
            for b1 in 0...7 {
                for t0 in 0...13 {
                    let bids = [b0, b1, 0, 0]
                    let tricks = [t0, 13 - t0, 0, 0]
                    let r = SpadesGame.scoreHand(bids: bids, tricks: tricks, bagsIn: [0, 0], bagLimit: 10, bagPenalty: 100, nilValue: 100)
                    cases += 1
                    for team in 0..<2 {
                        let contract = bids[team] + bids[team + 2]
                        let took = tricks[team] + tricks[team + 2]
                        let nilSeats = [team, team + 2].filter { bids[$0] == 0 }
                        let nilsMade = nilSeats.filter { tricks[$0] == 0 }.count
                        let nilPart = nilsMade * 100 - (nilSeats.count - nilsMade) * 100
                        let over = took >= contract ? took - contract : 0
                        let penalty = (over / 10) * 100
                        let rest = r.delta[team] - nilPart + penalty
                        if took >= contract {
                            XCTAssertEqual(rest, 10 * contract + over, "made: bid \(contract) took \(took)")
                            XCTAssertEqual(r.bags[team], over % 10)
                        } else {
                            XCTAssertEqual(rest, -10 * contract, "set: bid \(contract) took \(took)")
                            XCTAssertEqual(r.bags[team], 0, "a set hand banked bags")
                        }
                    }
                }
            }
        }
        XCTAssertEqual(cases, 8 * 8 * 14)
    }
}
