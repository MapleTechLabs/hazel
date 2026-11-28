// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "HazelUI",
    platforms: [.iOS(.v26)],
    products: [
        .library(name: "HazelUI", targets: ["HazelUI"]),
    ],
    targets: [
        .target(
            name: "HazelUI",
            // The icons and illustrations (`scripts/export-icons.ts`), plain files read through `Bundle.module`.
            resources: [.copy("Resources/Icons"), .copy("Resources/Illustrations")]
        ),
        .testTarget(
            name: "HazelUITests",
            dependencies: ["HazelUI"],
            // The wire goldens are read from packages/ui (one source); see GoldenTests.
            resources: [.copy("JS")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
