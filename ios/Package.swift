// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WarrantyVaultKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "WarrantyVaultKit", targets: ["WarrantyVaultKit"]),
    ],
    targets: [
        .target(
            name: "WarrantyVaultKit",
            path: "Sources/WarrantyVaultKit",
            // `Localizable.xcstrings` is the app's String Catalog. It is declared
            // as a resource because a file inside a SwiftPM target that is not
            // declared here is SILENTLY not copied into `Bundle.module` — the
            // catalog would parse to nothing and every string would fall back to
            // its Vietnamese source text with no error anywhere.
            //
            // `.copy` (not `.process`) on purpose: `.process` hands the file to
            // Xcode's String Catalog compiler, which would replace it with
            // `.lproj/Localizable.strings`, and `StringCatalog` would then have
            // nothing to read. The catalog stays byte-identical in the bundle.
            resources: [.copy("Resources/Localizable.xcstrings")]
        ),
        .testTarget(
            name: "WarrantyVaultKitTests",
            dependencies: ["WarrantyVaultKit"],
            path: "Tests/WarrantyVaultKitTests"
        ),
    ]
)
