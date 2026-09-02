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
