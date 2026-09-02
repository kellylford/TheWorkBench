import XCTest

final class SpadesUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Deal, bid, and play the whole hand from the labels alone.
    func testBidsAndPlaysAHandByLabels() {
        let app = XCUIApplication.forTesting(game: "spades")
        app.launch()
        app.openGame("Spades")

        XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5), "the hand has a heading")
        XCTAssert(app.staticTexts["What you can do"].exists)
        XCTAssert(app.staticTexts["This trick"].exists)
        XCTAssert(app.staticTexts["Sides"].exists)
        XCTAssert(app.staticTexts["Players"].exists)
        XCTAssert(app.staticTexts["What has happened"].exists)

        // Thirteen cards, each saying where it sits, and readable while bidding.
        XCTAssertEqual(app.handCards.count, 13)
        XCTAssert(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "card 1 of 13")).firstMatch.exists)
        XCTAssertEqual(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "cannot be played")).count, 0,
                       "no card is marked unavailable while bidding")

        // Bid: at Immediate pace anybody ahead of us has already bid.
        XCTAssert(app.status(startsWith: "Your bid"), "it becomes our turn to bid")
        XCTAssert(app.buttons["Bid nil"].exists, "nil is its own button")
        let bidButton = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label != %@", "Bid ", "Bid nil")).firstMatch
        XCTAssert(bidButton.waitForExistence(timeout: 3), "there is a Bid button with a number on it")
        app.attachScreenshot("spades-bidding", to: self)
        bidButton.tap()

        // Play: thirteen tricks. At Immediate pace the computers have already
        // moved by the time the status says it is our turn.
        var sawARefusalReason = false
        var played = 0
        var waits = 0
        let dealButton = app.buttons["Deal the next hand"]
        while played < 13, waits < 13 {
            if dealButton.exists { break }
            guard app.status(startsWith: "Your turn") else {
                waits += 1
                continue
            }
            let labels = app.handCards.allElementsBoundByIndex.map(\.label)
            if labels.contains(where: { $0.contains("cannot be played, you must follow") || $0.contains("spades have not been broken") }) {
                sawARefusalReason = true
            }
            guard let card = app.firstPlayableCard() else {
                XCTFail("trick \(played + 1): no playable card among \(labels)")
                return
            }
            if played == 2 { app.attachScreenshot("spades-trick", to: self) }
            card.tap()
            played += 1
            // Wait for the play to land before reading the hand again.
            let expected = 13 - played
            let deadline = Date().addingTimeInterval(5)
            while app.handCards.count > expected, Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            }
        }

        XCTAssert(dealButton.waitForExistence(timeout: 10), "the hand ends with a deal button")
        XCTAssert(sawARefusalReason, "at some point a card said why it could not be played")
        XCTAssert(app.staticTexts["Hands played"].exists)
        XCTAssert(app.staticTexts["Last completed trick"].exists)
        app.attachScreenshot("spades-hand-over", to: self)

        // The review menu reads the contract.
        app.buttons["Review"].tap()
        let contract = app.buttons["Contract"]
        XCTAssert(contract.waitForExistence(timeout: 3))
        contract.tap()
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Last announcement")).firstMatch
        XCTAssert(last.waitForExistence(timeout: 3))
        XCTAssert(last.label.contains("bid"), "the announcement line shows the contract: \(last.label)")
    }
}
