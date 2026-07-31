import { describe, expect, it } from "vitest";
import { analyzeSwiftFile } from "../swift/parser.js";
import {
  collectAccessibilityIdentifiers,
  collectSymbols,
  detectAnalyticsEvents,
  detectApiEndpoints,
  detectArchitecture,
  detectDataModels,
  detectDependencies,
  detectPermissions,
  detectPersistenceEntities,
  detectTestCases,
  featureResolver,
  frameworksByFeature,
} from "./entities.js";
import { parsePlist, plistFacts } from "../ios/plist.js";
import type { AnalyzedSource } from "./features.js";

function analyze(path: string, content: string): AnalyzedSource {
  return { path, analysis: analyzeSwiftFile(path, content) };
}

const viewSource = analyze(
  "Sources/Alarm/AlarmView.swift",
  `import SwiftUI

struct AlarmView: View {
  var body: some View {
    List(items) { item in
      Text(item.label).accessibilityIdentifier("alarm-row-\\(item.id)")
    }
    .accessibilityIdentifier("alarm-list")
  }
}
`,
);

const modelSource = analyze(
  "Sources/Alarm/AlarmModel.swift",
  `import Foundation

struct Alarm: Codable, Identifiable {
  let id: UUID
}

struct Internal {
  let value: Int
}
`,
);

const storeSource = analyze(
  "Sources/Alarm/AlarmStore.swift",
  `import CoreData

final class AlarmRecord: NSManagedObject {
  @NSManaged var label: String
}
`,
);

const serviceSource = analyze(
  "Sources/Alarm/AlarmService.swift",
  `import Foundation

final class AlarmService {
  // See https://developer.apple.com/documentation for background.
  let endpoint = URL(string: "https://api.example.com/v1/alarms")!

  func sync() {
    Analytics.logEvent("alarm_synced")
  }
}
`,
);

const testSource = analyze(
  "Tests/AlarmTests/AlarmServiceTests.swift",
  `import XCTest

final class AlarmServiceTests: XCTestCase {
  func testSyncSendsRequest() {}
  func helperNotATest() {}
}
`,
);

const sources = [
  viewSource,
  modelSource,
  storeSource,
  serviceSource,
  testSource,
];
const features = [
  {
    id: "alarm",
    source_files: sources
      .filter((s) => !s.path.startsWith("Tests"))
      .map((s) => s.path),
  },
];
const featureOf = featureResolver([
  ...features,
  { id: "alarm", source_files: [testSource.path] },
]);

describe("detectDataModels", () => {
  it("recognizes types by their conformances", () => {
    const models = detectDataModels(sources, featureOf);
    const alarm = models.find((m) => m.name === "Alarm");
    expect(alarm?.conformances.sort()).toEqual(["Codable", "Identifiable"]);
    expect(alarm?.start_line).toBe(3);
    expect(alarm?.feature).toBe("alarm");
  });

  it("does not treat SwiftUI views or managed objects as data models", () => {
    const names = detectDataModels(sources, featureOf).map((m) => m.name);
    expect(names).not.toContain("AlarmView");
    expect(names).not.toContain("AlarmRecord");
  });
});

describe("detectPersistenceEntities", () => {
  it("names the mechanism behind each persisted type", () => {
    const entities = detectPersistenceEntities(sources, featureOf);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.name).toBe("AlarmRecord");
    expect(entities[0]?.mechanism).toBe("Core Data");
  });
});

describe("detectApiEndpoints", () => {
  it("extracts absolute URLs and filters documentation hosts", () => {
    const endpoints = detectApiEndpoints(sources, featureOf);
    expect(endpoints.map((e) => e.url)).toEqual([
      "https://api.example.com/v1/alarms",
    ]);
    expect(endpoints[0]?.host).toBe("api.example.com");
  });
});

describe("detectAnalyticsEvents", () => {
  it("captures event-name literals with their line", () => {
    const events = detectAnalyticsEvents(sources, featureOf);
    expect(events.map((e) => e.name)).toEqual(["alarm_synced"]);
    expect(events[0]?.start_line).toBeGreaterThan(0);
  });
});

describe("detectTestCases", () => {
  it("collects only test methods, tagged unit vs ui", () => {
    const cases = detectTestCases(sources, featureOf);
    expect(cases.map((c) => c.name)).toEqual(["testSyncSendsRequest"]);
    expect(cases[0]?.kind).toBe("unit");
  });
});

describe("detectArchitecture", () => {
  it("groups non-test files into layers by role", () => {
    const layers = detectArchitecture(sources, featureOf);
    const names = layers.map((l) => l.name);
    expect(names).toContain("Presentation — Views");
    expect(names).toContain("Domain — Services");
    expect(layers.every((l) => l.file_count > 0)).toBe(true);
    expect(layers.flatMap((l) => l.files)).not.toContain(testSource.path);
  });
});

describe("collectAccessibilityIdentifiers", () => {
  it("separates literal identifiers from dynamic expressions", () => {
    const ids = collectAccessibilityIdentifiers(sources, featureOf);
    const literals = ids.filter((i) => !i.dynamic).map((i) => i.value);
    const dynamics = ids.filter((i) => i.dynamic);
    expect(literals).toEqual(["alarm-list"]);
    expect(dynamics).toHaveLength(1);
    expect(dynamics[0]?.expression).toContain("alarm-row");
    expect(dynamics[0]?.value).toBeUndefined();
  });
});

describe("collectSymbols", () => {
  it("flattens declared types and functions with their file and line", () => {
    const symbols = collectSymbols(sources);
    expect(
      symbols.some((s) => s.name === "AlarmView" && s.kind === "struct"),
    ).toBe(true);
    expect(symbols.some((s) => s.name === "sync" && s.kind === "func")).toBe(
      true,
    );
    expect(symbols.every((s) => s.file.length > 0)).toBe(true);
  });
});

describe("frameworksByFeature", () => {
  it("unions the imports of a feature's files", () => {
    const map = frameworksByFeature(sources, features);
    expect(map.get("alarm")).toEqual(["CoreData", "Foundation", "SwiftUI"]);
  });
});

describe("detectDependencies", () => {
  it("reads Swift packages and CocoaPods with their requirement", () => {
    const deps = detectDependencies({
      packageSwift: `let package = Package(
  dependencies: [
    .package(url: "https://github.com/apple/swift-collections.git", from: "1.1.0"),
  ]
)`,
      packageSwiftPath: "Package.swift",
      podfile: `target 'App' do\n  pod 'Alamofire', '~> 5.8'\nend`,
      podfilePath: "Podfile",
    });
    expect(deps.map((d) => d.name).sort()).toEqual([
      "Alamofire",
      "swift-collections",
    ]);
    expect(deps.find((d) => d.name === "swift-collections")?.requirement).toBe(
      "1.1.0",
    );
    expect(deps.find((d) => d.name === "Alamofire")?.manager).toBe("cocoapods");
  });

  it("returns nothing when no manifest was read", () => {
    expect(detectDependencies({})).toEqual([]);
  });
});

describe("detectPermissions", () => {
  it("marks which services a simulator can pre-grant", () => {
    const facts = plistFacts(
      parsePlist(`<plist><dict>
<key>NSCameraUsageDescription</key><string>Camera</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Location</string>
</dict></plist>`),
    );
    const permissions = detectPermissions(facts, "Info.plist");
    const byService = new Map(
      permissions.map((p) => [p.service, p.simctl_grantable]),
    );
    expect(byService.get("camera")).toBe(false);
    expect(byService.get("location")).toBe(true);
    expect(permissions.every((p) => p.evidence.length > 0)).toBe(true);
  });
});
