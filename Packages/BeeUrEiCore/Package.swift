// swift-tools-version: 5.9
import PackageDescription

// BeeUrEiCore：平台无关的核心逻辑（仅依赖 Foundation）。
// 把安全攸关的纯逻辑放这里，可用 `swift test` 在 Mac 本机直接跑（无需 iOS 模拟器）。
// iOS App 以本地包形式依赖它；iOS 专属的 I/O 适配层留在 App 里、由真机验证。
let package = Package(
    name: "BeeUrEiCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "BeeUrEiCore", targets: ["BeeUrEiCore"]),
    ],
    targets: [
        .target(name: "BeeUrEiCore"),
        .testTarget(name: "BeeUrEiCoreTests", dependencies: ["BeeUrEiCore"]),
    ]
)
