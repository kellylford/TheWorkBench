import XCTest

final class HeartsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Deal, pass three, and play the whole hand from the labels alone.
    func testPlaysAHandByLabels() {
        let app = XCUIApplication.forTesting(game: "hearts")
        app.launch()
        app.openGame("Hearts")

        XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5), "the hand has a heading")
        XCTAssert(app.staticTexts["What you can do"].exists)
        XCTAssert(app.staticTexts["This trick"].exists)
        XCTAssert(app.staticTexts["What has happened"].exists)

        // Thirteen cards, each saying where it sits.
        XCTAssertEqual(app.handCards.count, 13)
        XCTAssert(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "card 1 of 13")).firstMatch.exists)
        XCTAssert(app.status(startsWith: "Choose three cards to pass"))
        app.attachScreenshot("hearts-passing", to: self)

        // Pass: choose three, then Pass.
        for i in 0..<3 { app.handCards.element(boundBy: i).tap() }
        XCTAssertEqual(app.handCards.allElementsBoundByIndex.filter(\.isSelected).count, 3, "three cards say selected")
        let pass = app.buttons["Pass 3 of 3"]
        XCTAssert(pass.waitForExistence(timeout: 3))
        pass.tap()

        // Play: thirteen tricks. At Immediate pace the computers have already
        // moved by the time the status says it is our turn.
        var sawARefusalReason = false
        for trick in 1...13 {
            XCTAssert(app.status(startsWith: "Your turn"), "trick \(trick): it becomes our turn")
            let labels = app.handCards.allElementsBoundByIndex.map(\.label)
            if labels.contains(where: { $0.contains("cannot be played, you must follow") }) { sawARefusalReason = true }
            guard let card = app.firstPlayableCard() else {
                XCTFail("trick \(trick): no playable card among \(labels)")
                return
            }
            if trick == 3 { app.attachScreenshot("hearts-trick", to: self) }
            card.tap()
        }

        XCTAssert(app.buttons["Deal the next hand"].waitForExistence(timeout: 10), "the hand ends with a deal button")
        XCTAssert(sawARefusalReason, "at some point a card said why it could not be played")
        XCTAssert(app.staticTexts["Hands played"].exists)
        app.attachScreenshot("hearts-hand-over", to: self)

        // The review menu reads the scores.
        app.buttons["Review"].tap()
        let scores = app.buttons["Scores"]
        XCTAssert(scores.waitForExistence(timeout: 3))
        scores.tap()
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Last announcement")).firstMatch
        XCTAssert(last.waitForExistence(timeout: 3))
        XCTAssert(last.label.contains("Lowest wins"), "the announcement line shows the scores: \(last.label)")
    }

    /// At the largest accessibility text size the table must still be usable:
    /// every card still says where it sits and nothing is lost off the side.
    func testLargestTextSizeStillDeals() {
        let app = XCUIApplication.forTesting(game: "hearts")
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        app.openGame("Hearts")
        XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.handCards.count, 13)
        app.attachScreenshot("hearts-largest-text", to: self)
        for i in 0..<3 { app.handCards.element(boundBy: i).tap() }
        XCTAssertEqual(app.handCards.allElementsBoundByIndex.filter(\.isSelected).count, 3)
        app.attachScreenshot("hearts-largest-text-selected", to: self)
    }
}
