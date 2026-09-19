import XCTest
@testable import CardCore

final class CardCoreTests: XCTestCase {
    func testIdsRoundTrip() {
        for c in Card.fullDeck {
            XCTAssertEqual(Card(id: c.id), c)
        }
        XCTAssertEqual(Card(id: "QS")?.name, "Queen of Spades")
        XCTAssertEqual(Card(id: "TD")?.shortText, "10♦")
        XCTAssertNil(Card(id: "1S"))
        XCTAssertNil(Card(id: "QSX"))
    }

    func testFullDeckIsFiftyTwoDistinct() {
        XCTAssertEqual(Card.fullDeck.count, 52)
        XCTAssertEqual(Set(Card.fullDeck).count, 52)
        XCTAssertEqual(Card.deck(ranks: [.nine, .ten, .jack, .queen, .king, .ace]).count, 24)
    }

    func testSeededShuffleIsRepeatable() {
        var a = RandomSource(seed: 42), b = RandomSource(seed: 42)
        XCTAssertEqual(Card.fullDeck.shuffled(with: &a), Card.fullDeck.shuffled(with: &b))
        var c = RandomSource(seed: 43)
        XCTAssertNotEqual(Card.fullDeck.shuffled(with: &a), Card.fullDeck.shuffled(with: &c))
    }

    func testShuffleKeepsEveryCard() {
        var r = RandomSource(seed: 7)
        let s = Card.fullDeck.shuffled(with: &r)
        XCTAssertEqual(Set(s), Set(Card.fullDeck))
    }

    func testEventsFilterByAudience() {
        var log = EventLog()
        log.add(.info, "everyone")
        log.add(.you, "only seat 2", audience: 2)
        log.add(.info, "later")
        XCTAssertEqual(log.events(for: 0).map(\.text), ["everyone", "later"])
        XCTAssertEqual(log.events(for: 2).map(\.text), ["everyone", "only seat 2", "later"])
        XCTAssertEqual(log.events(for: 2, since: 2).map(\.text), ["later"])
    }

    func testProse() {
        XCTAssertEqual(Prose.list([]), "")
        XCTAssertEqual(Prose.list(["A"]), "A")
        XCTAssertEqual(Prose.list(["A", "B"]), "A and B")
        XCTAssertEqual(Prose.list(["A", "B", "C"]), "A, B and C")
        XCTAssertEqual(Prose.count(1, "point"), "1 point")
        XCTAssertEqual(Prose.count(2, "point"), "2 points")
        XCTAssertEqual(Prose.ordinal(2), "second")
        XCTAssertEqual(Prose.ordinal(22), "22nd")
        XCTAssertEqual(Prose.ordinal(11), "11th")
    }

    func testPaceLadder() {
        XCTAssertEqual(Pace(rawValue: 900), .brisk)
        XCTAssertNil(Pace.waitForMe.delay)
        XCTAssertEqual(Pace.relaxed.delay, .milliseconds(4000))
    }
}
