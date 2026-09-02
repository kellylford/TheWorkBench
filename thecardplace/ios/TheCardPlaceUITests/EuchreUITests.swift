import XCTest

final class EuchreUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// In round one every card of the upcard's suit says what it would become.
    /// Redeal until a hand holds one, then keep the picture.
    func testRoundOneProspectsAreLabelled() {
        let app = XCUIApplication.forTesting(game: "euchre")
        for attempt in 1...6 {
            if attempt > 1 { app.terminate() }
            app.launch()
            app.openGame("Euchre")
            XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5))
            let prospects = app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "would be"))
            if prospects.count > 0 {
                let label = prospects.firstMatch.label
                XCTAssert(label.contains("would be trump") || label.contains("bower"), "a prospect says what it would become: \(label)")
                app.attachScreenshot("euchre-prospects", to: self)
                return
            }
        }
        XCTFail("six deals in a row held no card of the upcard's suit")
    }

    /// Deal, bid, discard if we are the dealer, and play the whole hand from
    /// the labels alone. Euchre deals are short and the computers may call
    /// before we do, may send us out of a hand, or may throw one in, so the
    /// test reads the status and does whatever it asks for, hand after hand,
    /// until a hand has been played to the end and a card has said it is
    /// trump or a bower.
    func testPlaysAHandByLabels() {
        let app = XCUIApplication.forTesting(game: "euchre")
        app.launch()
        app.openGame("Euchre")

        XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5), "the hand has a heading")
        XCTAssert(app.staticTexts["What you can do"].exists)
        XCTAssert(app.staticTexts["This trick"].exists)
        XCTAssert(app.staticTexts["Scores"].exists)
        XCTAssert(app.staticTexts["Players"].exists)
        XCTAssert(app.staticTexts["What has happened"].exists)

        // Five cards, each saying where it sits, and the bidding under way.
        XCTAssertEqual(app.handCards.count, 5)
        XCTAssert(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "card 1 of 5")).firstMatch.exists)
        XCTAssert(app.status(startsWith: "Bidding"))
        app.attachScreenshot("euchre-bidding", to: self)

        let dealButton = app.buttons["Deal the next hand"]
        let newGameButton = app.buttons["Start a new game"]
        var sawTrumpLabel = false
        var handsFinished = 0
        var tookAScreenshotOfPlay = false

        outer: for hand in 1...3 {
            // At Immediate pace the computers have moved by the time the
            // status says it is our turn; otherwise we wait a moment and look
            // again. Two hundred looks is far more than a hand needs.
            for _ in 0..<200 {
                if dealButton.exists || newGameButton.exists { break }
                let status = app.currentStatus
                if status.hasPrefix("Bidding"), status.contains("Your turn") {
                    if labelsMentionTrump(app) { sawTrumpLabel = true }
                    let pass = app.buttons["Pass"]
                    if pass.exists, pass.isEnabled {
                        pass.tap()
                    } else {
                        let call = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Call ")).firstMatch
                        XCTAssert(call.exists, "hand \(hand): the dealer must call, so a Call button is offered")
                        call.tap()
                    }
                } else if status.hasPrefix("You took the upcard") {
                    XCTAssertEqual(app.handCards.count, 6, "the dealer holds six while choosing what to put back")
                    app.handCards.element(boundBy: 0).tap()
                } else if status.contains("your turn to play") {
                    if labelsMentionTrump(app) { sawTrumpLabel = true }
                    guard let card = app.firstPlayableCard() else {
                        XCTFail("hand \(hand): no playable card among \(app.handCards.allElementsBoundByIndex.map(\.label))")
                        return
                    }
                    if !tookAScreenshotOfPlay {
                        app.attachScreenshot("euchre-play", to: self)
                        tookAScreenshotOfPlay = true
                    }
                    card.tap()
                } else {
                    // Waiting on the computers, or sitting out while somebody plays alone.
                    _ = dealButton.waitForExistence(timeout: 0.3)
                }
            }
            XCTAssert(dealButton.exists || newGameButton.exists, "hand \(hand) ends with a deal or new game button")
            handsFinished += 1
            XCTAssert(app.staticTexts["The dealer's discard"].exists, "the face-down cards are shown once the hand is over")
            if sawTrumpLabel || newGameButton.exists { break outer }
            dealButton.tap()
            XCTAssert(app.status(startsWith: "Bidding"), "the next hand is dealt")
        }

        XCTAssertGreaterThanOrEqual(handsFinished, 1)
        XCTAssert(sawTrumpLabel, "at some point a card in the hand said it was trump or a bower")
        XCTAssert(app.staticTexts["Hands played"].exists)
        app.attachScreenshot("euchre-hand-over", to: self)

        // The review menu reads the scores, with numbers in them.
        app.buttons["Review"].tap()
        let scores = app.buttons["Scores"]
        XCTAssert(scores.waitForExistence(timeout: 3))
        scores.tap()
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Last announcement")).firstMatch
        XCTAssert(last.waitForExistence(timeout: 3))
        XCTAssert(last.label.contains("Tricks this hand"), "the announcement line shows the scores: \(last.label)")
        XCTAssertNotNil(last.label.rangeOfCharacter(from: .decimalDigits), "the scores contain a number: \(last.label)")
    }

    private func labelsMentionTrump(_ app: XCUIApplication) -> Bool {
        app.handCards.allElementsBoundByIndex.map(\.label).contains { $0.contains("bower") || $0.contains("trump") }
    }
}

private extension XCUIApplication {
    /// The status line's words, without the "Status. " prefix, or "" if the
    /// line is not on screen.
    var currentStatus: String {
        let line = staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Status. ")).firstMatch
        guard line.exists else { return "" }
        return String(line.label.dropFirst("Status. ".count))
    }
}
