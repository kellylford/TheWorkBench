// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ParallelsManager",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "ParallelsManager",
            path: "Sources/ParallelsManager"
        )
    ]
)
