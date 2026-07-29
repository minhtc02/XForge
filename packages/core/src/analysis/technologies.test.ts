import { describe, expect, it } from "vitest";
import { analyzeSwiftFile } from "../swift/parser.js";
import {
  detectTechnologies,
  mergeTechnologies,
  type AnalyzedSource,
} from "./index.js";

function src(path: string, content: string): AnalyzedSource {
  return { path, analysis: analyzeSwiftFile(path, content) };
}

describe("detectTechnologies", () => {
  it("maps recognized imports to categorized technologies with evidence", () => {
    const sources = [
      src(
        "Sources/AlarmView.swift",
        "import SwiftUI\nstruct AlarmView: View {}",
      ),
      src(
        "Sources/AlarmScheduler.swift",
        "import Foundation\nimport UserNotifications\nfinal class AlarmScheduler {}",
      ),
      src("Sources/Store.swift", "import CoreData\nfinal class Store {}"),
    ];
    const techs = detectTechnologies(sources);
    const byName = Object.fromEntries(techs.map((t) => [t.name, t]));
    expect(byName["SwiftUI"]?.category).toBe("ui");
    expect(byName["UserNotifications"]?.category).toBe("notifications");
    expect(byName["Core Data"]?.category).toBe("persistence");
    expect(byName["SwiftUI"]?.evidence[0]?.file).toBe(
      "Sources/AlarmView.swift",
    );
  });

  it("ignores unknown imports", () => {
    const sources = [
      src("A.swift", "import TotallyMadeUpFramework\nstruct A {}"),
    ];
    expect(detectTechnologies(sources)).toHaveLength(0);
  });

  it("detects Swift actors as a concurrency technology", () => {
    const sources = [src("A.swift", "actor Counter {}")];
    const techs = detectTechnologies(sources);
    expect(
      techs.some(
        (t) => t.name === "Swift actors" && t.category === "concurrency",
      ),
    ).toBe(true);
  });

  it("caps evidence at 5 entries", () => {
    const sources = Array.from({ length: 8 }, (_, i) =>
      src(`V${i}.swift`, "import SwiftUI\nstruct V: View {}"),
    );
    const swiftui = detectTechnologies(sources).find(
      (t) => t.name === "SwiftUI",
    )!;
    expect(swiftui.evidence.length).toBeLessThanOrEqual(5);
  });
});

describe("mergeTechnologies", () => {
  it("merges by name without duplicates and keeps max confidence", () => {
    const a = [
      { name: "XCTest", category: "testing", confidence: 0.9, evidence: [] },
    ];
    const b = [
      { name: "XCTest", category: "testing", confidence: 0.95, evidence: [] },
      {
        name: "CocoaPods",
        category: "dependency-manager",
        confidence: 0.95,
        evidence: [],
      },
    ];
    const merged = mergeTechnologies(a, b);
    expect(merged).toHaveLength(2);
    expect(merged.find((t) => t.name === "XCTest")!.confidence).toBe(0.95);
  });
});
