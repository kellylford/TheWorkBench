// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ParallelsManager",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "ParallelsManager",
            path: "Sources/ParallelsManager",
            resources: [.copy("Resources")]
        )
    ]
)
