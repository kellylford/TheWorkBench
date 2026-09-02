import XCTest

final class SheepheadUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Deal, pick or pass, bury if we picked, and play the hand out from the
    /// labels alone. Which way the picking goes depends on the deal, so the
    /// test takes whatever comes: a hand we pick, a hand somebody else picks,
    /// or everybody passing into a leaster or a redeal.
    func testPlaysAHandByLabels() {
        let app = XCUIApplication.forTesting(game: "sheephead")
        app.launch()
        app.openGame("Sheephead")

        XCTAssert(app.staticTexts["Your hand"].waitForExistence(timeout: 5), "the hand has a heading")
        XCTAssert(app.staticTexts["What you can do"].exists)
        XCTAssert(app.staticTexts["This trick"].exists)
        XCTAssert(app.staticTexts["Players"].exists)
        XCTAssert(app.staticTexts["What has happened"].exists)

        // Five players: six cards each, every one saying where it sits.
        XCTAssert(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "of 6")).firstMatch.waitForExistence(timeout: 5),
                  "six cards in hand, each saying where it sits")
        app.attachScreenshot("sheephead-dealt", to: self)

        let deal = app.buttons["Deal the next hand"]
        let pickUp = app.buttons["Pick up the blind"]
        let pass = app.buttons["Pass"]
        let myPlay = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Status. Trick", "your turn")).firstMatch

        var pickedOnce = false
        var buried = false
        var sawTrump = false
        var plays = 0
        var steps = 0

        // Bounded: a hand is at most six plays from us plus the pick round, and a
        // redeal or a couple of hands passed round is a few dozen more.
        while !deal.exists, steps < 80 {
            steps += 1
            let labels = app.handCards.allElementsBoundByIndex.map(\.label)
            if labels.contains(where: { $0.contains("trump") }) { sawTrump = true }

            if pickUp.exists {
                if !pickedOnce {
                    // The first time it is offered, take the blind and bury two.
                    pickedOnce = true
                    pickUp.tap()
                    let bury = app.buttons["Bury 0 of 2"]
                    XCTAssert(bury.waitForExistence(timeout: 5), "after picking, a Bury button says nothing is chosen yet")
                    XCTAssert(app.handCards.count == 8, "the blind joined the hand: \(app.handCards.count) cards")
                    XCTAssert(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", "from the blind")).count == 2,
                              "two cards say they came from the blind")
                    app.attachScreenshot("sheephead-bury", to: self)
                    app.handCards.element(boundBy: 0).tap()
                    app.handCards.element(boundBy: 1).tap()
                    XCTAssertEqual(app.handCards.matching(NSPredicate(format: "label CONTAINS %@", ", selected")).count, 2, "two cards say selected")
                    let buryTwo = app.buttons["Bury 2 of 2"]
                    XCTAssert(buryTwo.waitForExistence(timeout: 3))
                    buryTwo.tap()
                    buried = true
                } else {
                    pass.tap()
                }
                continue
            }

            if myPlay.exists {
                guard let card = app.firstPlayableCard() else {
                    XCTFail("no playable card among \(labels)")
                    return
                }
                plays += 1
                if plays == 2 { app.attachScreenshot("sheephead-trick", to: self) }
                card.tap()
                continue
            }

            // A computer is thinking, or the screen is between states.
            _ = deal.waitForExistence(timeout: 1)
        }

        XCTAssert(deal.waitForExistence(timeout: 10), "the hand ends with a deal button (after \(steps) steps, \(plays) plays)")
        XCTAssert(sawTrump, "at some point a card in hand said it was trump")
        XCTAssert(app.staticTexts["The blind and the bury"].exists, "the blind is shown once the hand is over")
        XCTAssert(app.staticTexts["Hands played"].exists)
        if pickedOnce { XCTAssert(buried, "having picked, we buried") }
        app.attachScreenshot("sheephead-hand-over", to: self)

        // The review menu reads the scores.
        app.buttons["Review"].tap()
        let scores = app.buttons["Scores"]
        XCTAssert(scores.waitForExistence(timeout: 3))
        scores.tap()
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Last announcement")).firstMatch
        XCTAssert(last.waitForExistence(timeout: 3))
        XCTAssert(last.label.contains("Running score"), "the announcement line shows the scores: \(last.label)")
    }
}
