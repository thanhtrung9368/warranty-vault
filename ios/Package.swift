// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WarrlyKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "WarrlyKit", targets: ["WarrlyKit"]),
    ],
    targets: [
        .target(
            name: "WarrlyKit",
            path: "Sources/WarrlyKit",
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
            //
            // `PrivacyInfo.xcprivacy` is a SECOND manifest, separate from the
            // app's `App/PrivacyInfo.xcprivacy`. `AppLock.swift` reads and writes
            // `UserDefaults` (the lock switch), so the WarrlyKit resource bundle
            // (`WarrlyKit_WarrlyKit.bundle`) uses a required-reason API and must
            // carry its own manifest — Apple inspects every bundle, and the app's
            // manifest does not cover a library's own API use. `.copy` puts it at
            // the bundle root, which is where the OS looks for it.
            resources: [
                .copy("Resources/Localizable.xcstrings"),
                .copy("Resources/PrivacyInfo.xcprivacy"),
            ]
        ),
        .testTarget(
            name: "WarrlyKitTests",
            dependencies: ["WarrlyKit"],
            path: "Tests/WarrlyKitTests"
        ),
    ]
)
