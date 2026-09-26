// swift-tools-version:5.9
//
// MoonTask for macOS: a native SwiftUI app.
//
// - MoonTaskCore   pure Swift (models, process tree, sorting, formatting,
//                  the safety rules); builds and tests on any platform
// - CDarwin        a thin C layer over libproc, sysctl, Mach and IOKit
// - MoonTaskSystem reads the machine and acts on processes (macOS only)
// - MoonTask       the app itself (macOS only)
import PackageDescription

var targets: [Target] = [
    .target(name: "MoonTaskCore", path: "Sources/MoonTaskCore"),
    .testTarget(
        name: "MoonTaskCoreTests",
        dependencies: ["MoonTaskCore"],
        path: "Tests/MoonTaskCoreTests"
    ),
]
var products: [Product] = []

#if os(macOS)
targets += [
    .target(
        name: "CDarwin",
        path: "Sources/CDarwin",
        linkerSettings: [
            .linkedFramework("IOKit"),
            .linkedFramework("CoreFoundation"),
        ]
    ),
    .target(
        name: "MoonTaskSystem",
        dependencies: ["MoonTaskCore", "CDarwin"],
        path: "Sources/MoonTaskSystem"
    ),
    .executableTarget(
        name: "MoonTask",
        dependencies: ["MoonTaskCore", "MoonTaskSystem"],
        path: "Sources/MoonTask"
    ),
    .testTarget(
        name: "MoonTaskSystemTests",
        dependencies: ["MoonTaskSystem"],
        path: "Tests/MoonTaskSystemTests"
    ),
]
products.append(.executable(name: "MoonTask", targets: ["MoonTask"]))
#endif

let package = Package(
    name: "MoonTask",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
