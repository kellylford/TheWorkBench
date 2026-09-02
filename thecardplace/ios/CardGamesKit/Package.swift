// swift-tools-version:5.9
import PackageDescription

// The rules of five card games, and nothing else. No SwiftUI, no UIKit, no
// networking: every target here builds and tests on a Mac with `swift test`,
// which is why the engines live in a package rather than inside the app.
let engines = ["Hearts", "Euchre", "Spades", "Cribbage", "Sheephead"]

let package = Package(
    name: "CardGamesKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CardCore", targets: ["CardCore"])]
        + engines.map { .library(name: "\($0)Engine", targets: ["\($0)Engine"]) },
    targets: [
        .target(name: "CardCore"),
        .testTarget(name: "CardCoreTests", dependencies: ["CardCore"]),
    ]
    + engines.map { .target(name: "\($0)Engine", dependencies: ["CardCore"]) }
    + engines.map { .testTarget(name: "\($0)EngineTests", dependencies: [.target(name: "\($0)Engine")]) },
    swiftLanguageVersions: [.v5]
)
