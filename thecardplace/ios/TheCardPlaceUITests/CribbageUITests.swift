import XCTest

final class CribbageUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Cut for deal, throw two to the crib, and play and count a whole hand
    /// from the labels alone.
    func testPlaysAHandByLabels() {
        let app = XCUIApplication.forTesting(game: "cribbage")
        app.launch()
        app.openGame("Cribbage")

        XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5), "the hand has a heading")
        XCTAssert(app.staticTexts["The play"].exists)
        XCTAssert(app.staticTexts["The starter"].exists)
        XCTAssert(app.staticTexts["The crib"].exists)
        XCTAssert(app.staticTexts["Scores"].exists)
        app.assertControlBar()
        XCTAssert(app.status(startsWith: "Cut for deal"))
        app.attachScreenshot("cribbage-cut", to: self)

        // Cut, and cut again while the status still says to.
        let cut = app.buttons["Cut for deal"]
        XCTAssert(cut.waitForExistence(timeout: 3))
        for _ in 0..<12 {
            cut.tap()
            if app.status(startsWith: "Throw two cards", timeout: 2) { break }
            XCTAssert(cut.waitForExistence(timeout: 2), "a tie leaves the cut button on screen")
        }
        XCTAssert(app.status(startsWith: "Throw two cards"), "the cut decided a dealer and dealt")

        // Six cards, each saying where it sits. Throw is dimmed until two are
        // chosen, and says so. Choose two, then Throw.
        XCTAssertEqual(app.handCards.count, 6)
        XCTAssert(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "card 1 of 6")).firstMatch.exists)
        XCTAssert(app.buttons["Throw 0 of 2 to the crib"].exists, "the primary button counts the chosen cards")
        app.handCards.element(boundBy: 0).tap()
        app.handCards.element(boundBy: 1).tap()
        XCTAssertEqual(app.handCards.allElementsBoundByIndex.filter(\.isSelected).count, 2, "two cards say selected")
        let throwButton = app.buttons["Throw 2 of 2 to the crib"]
        XCTAssert(throwButton.waitForExistence(timeout: 3))
        throwButton.tap()
        app.attachScreenshot("cribbage-play", to: self)

        // The play and the count: on our turn play a card that can be played,
        // say Go when none can, press Next through the count, until the hand
        // or the game is over. A card says only what it is, and on our turn
        // whether it can be played — never what the count would become.
        var sawNoArithmetic = true
        var done = false
        for _ in 0..<80 {
            if app.buttons["Deal the next hand"].exists || app.buttons["Deal another game"].exists {
                done = true
                break
            }
            let status = app.currentStatus
            let labels = app.handCards.allElementsBoundByIndex.map(\.label)
            if labels.contains(where: { $0.contains("makes") || $0.contains("worth") }) { sawNoArithmetic = false }
            if status.hasPrefix("The count is"), status.contains("your turn"), let card = app.firstPlayableCard() {
                card.tap()
            } else if app.buttons["Go"].exists {
                app.buttons["Go"].tap()
            } else if app.buttons["Next"].exists {
                app.buttons["Next"].tap()
            } else {
                _ = app.buttons["Next"].waitForExistence(timeout: 0.4)
            }
        }
        XCTAssert(done, "the hand ends with a deal button")
        XCTAssert(sawNoArithmetic, "no card in the hand did the count for the player")
        app.attachScreenshot("cribbage-hand-over", to: self)

        if app.buttons["Deal the next hand"].exists {
            XCTAssert(app.staticTexts["Hands played"].exists, "a completed hand is in the table")
        }

        // The review menu reads the scores, naming both players.
        app.buttons["Review"].tap()
        let scores = app.buttons["Scores"]
        XCTAssert(scores.waitForExistence(timeout: 3))
        scores.tap()
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Last announcement")).firstMatch
        XCTAssert(last.waitForExistence(timeout: 3))
        XCTAssert(last.label.contains("You") && last.label.contains("Ruth"), "the announcement names both players: \(last.label)")
    }
}
