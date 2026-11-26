// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "HazelUI",
    platforms: [.iOS(.v26)],
    products: [
        .library(name: "HazelUI", targets: ["HazelUI"]),
    ],
    targets: [
        .target(name: "HazelUI"),
        .testTarget(
            name: "HazelUITests",
            dependencies: ["HazelUI"],
            resources: [.copy("Goldens")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
