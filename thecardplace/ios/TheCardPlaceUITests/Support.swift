import XCTest

/// The games are driven the way a VoiceOver user drives them: by the labels
/// on the controls. Nothing here taps a coordinate.
extension XCUIApplication {
    /// A fresh app with the pace set to Immediate for the game under test so
    /// the computer players do not make the test wait, and a fixed name.
    static func forTesting(game: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-pace.\(game)", "0", "-playerName", "Tester", "-autofocus", "1"]
        return app
    }

    func openGame(_ title: String) {
        let row = descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssert(row.waitForExistence(timeout: 5), "the \(title) row is on the hub")
        row.tap()
        let deal = buttons["Deal"]
        if !(deal.waitForExistence(timeout: 5) || scrollUntilExists(deal)) {
            let shot = XCTAttachment(screenshot: screenshot())
            shot.name = "no-deal-button"
            shot.lifetime = .keepAlways
            XCTContext.runActivity(named: "no Deal button") { $0.add(shot) }
            XCTFail("the setup screen has a Deal button; visible buttons: \(buttons.allElementsBoundByIndex.map(\.label))")
            return
        }
        deal.tap()
    }

    /// Lists are lazy, so at the largest text sizes a control further down is
    /// not in the hierarchy until it is scrolled to.
    @discardableResult
    func scrollUntilExists(_ element: XCUIElement, tries: Int = 8) -> Bool {
        for _ in 0..<tries {
            if element.exists { return true }
            swipeUp()
        }
        return element.exists
    }

    /// Every card button in the hand, in order: their labels end "card N of M".
    var handCards: XCUIElementQuery {
        buttons.matching(NSPredicate(format: "label MATCHES %@", ".*card [0-9]+ of [0-9]+.*"))
    }

    /// The first card whose label does not say it cannot be played.
    func firstPlayableCard() -> XCUIElement? {
        let cards = handCards.allElementsBoundByIndex
        return cards.first { !$0.label.contains("cannot be played") }
    }

    /// The status line's words, without the "Status. " prefix, or "" if the
    /// line is not on screen.
    var currentStatus: String {
        let line = staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Status. ")).firstMatch
        guard line.exists else { return "" }
        return String(line.label.dropFirst("Status. ".count))
    }

    /// The Log button in the control bar. It is a menu with a primary action,
    /// which the accessibility tree may report as a button or as a menu.
    var logControl: XCUIElement {
        let byButton = buttons["Log"]
        if byButton.exists { return byButton }
        return descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Log")).firstMatch
    }

    /// The controls every game shares are on screen: the Controls heading,
    /// the Log button and Repeat, with the primary action beside them.
    func assertControlBar(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssert(staticTexts["Controls"].waitForExistence(timeout: 5), "the controls have a heading", file: file, line: line)
        XCTAssert(logControl.exists, "the log is a button", file: file, line: line)
        XCTAssert(buttons["Repeat the last announcement"].exists, "repeat is a button", file: file, line: line)
        XCTAssertFalse(staticTexts["What has happened"].exists, "the log is not on the table", file: file, line: line)
        XCTAssertFalse(staticTexts["What you can do"].exists, "no instructions on the table", file: file, line: line)
    }

    /// Open the full log from the Log button, check it lists something, and
    /// close it again.
    func openAndCloseLog(file: StaticString = #filePath, line: UInt = #line) {
        logControl.tap()
        XCTAssert(navigationBars["Log"].waitForExistence(timeout: 3), "Log opens the full log", file: file, line: line)
        XCTAssert(staticTexts["Newest first"].exists, "the log says which way round it is", file: file, line: line)
        let done = buttons["Done"]
        XCTAssert(done.waitForExistence(timeout: 3), file: file, line: line)
        done.tap()
        XCTAssert(navigationBars["Log"].waitForNonExistence(timeout: 3), "Done closes the log", file: file, line: line)
    }

    func status(startsWith prefix: String, timeout: TimeInterval = 10) -> Bool {
        let q = staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Status. " + prefix)).firstMatch
        return q.waitForExistence(timeout: timeout)
    }

    func attachScreenshot(_ name: String, to test: XCTestCase) {
        let a = XCTAttachment(screenshot: screenshot())
        a.name = name
        a.lifetime = .keepAlways
        test.add(a)
    }
}
