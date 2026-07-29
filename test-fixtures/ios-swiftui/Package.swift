// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "CuckooAlarm",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "CuckooAlarm", targets: ["CuckooAlarm"]),
  ],
  targets: [
    .target(name: "CuckooAlarm", path: "Sources/CuckooAlarm"),
    .testTarget(
      name: "CuckooAlarmTests",
      dependencies: ["CuckooAlarm"],
      path: "Tests/CuckooAlarmTests"
    ),
  ]
)
