import XCTest

/// The App Store screenshot of the hub. The game screenshots come from the
/// games' own UI tests, at the moments they already attach; see
/// scripts/take-screenshots.sh for which ones.
final class ScreenshotUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testHub() {
        let app = XCUIApplication.forTesting(game: "hearts")
        app.launch()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Sheephead")).firstMatch
        XCTAssert(row.waitForExistence(timeout: 5), "the hub lists the games")
        app.attachScreenshot("hub", to: self)
    }
}
