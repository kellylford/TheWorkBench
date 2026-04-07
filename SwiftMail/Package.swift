// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SwiftMail",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        .package(
            url: "https://github.com/apple/swift-nio.git",
            from: "2.65.0"
        ),
        .package(
            url: "https://github.com/apple/swift-nio-ssl.git",
            from: "2.26.0"
        ),
        .package(
            url: "https://github.com/apple/swift-log.git",
            from: "1.5.0"
        ),
    ],
    targets: [
        .target(
            name: "SwiftMailCore",
            dependencies: [
                .product(name: "NIO", package: "swift-nio"),
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
                .product(name: "NIOSSL", package: "swift-nio-ssl"),
                .product(name: "Logging", package: "swift-log"),
            ],
            path: "Sources/SwiftMailCore"
        ),
        .executableTarget(
            name: "SwiftMail",
            dependencies: [
                "SwiftMailCore",
                .product(name: "Logging", package: "swift-log"),
            ],
            path: "Sources/SwiftMail",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/SwiftMail/Info.plist"
                ])
            ]
        ),
    ]
)
