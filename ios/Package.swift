// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WarrantyVaultKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "WarrantyVaultKit", targets: ["WarrantyVaultKit"]),
    ],
    targets: [
        .target(name: "WarrantyVaultKit", path: "Sources/WarrantyVaultKit"),
        .testTarget(
            name: "WarrantyVaultKitTests",
            dependencies: ["WarrantyVaultKit"],
            path: "Tests/WarrantyVaultKitTests"
        ),
    ]
)
