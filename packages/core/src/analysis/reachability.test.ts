import { describe, expect, it } from "vitest";
import { analyzeScreenReachability } from "./reachability.js";
import { analyzeSwiftFile } from "../swift/parser.js";
import type { AnalyzedSource } from "./features.js";

/**
 * Reachability exists because of one concrete failure: the planner generated a
 * whole test plan against a screen no code path could reach, and the plan looked
 * perfect. These lock in the two directions of error that matter — a live screen
 * must never be called orphaned (that would hide real coverage), and a mention
 * inside a string must never count as a use (that would hide dead code).
 */

function source(path: string, content: string): AnalyzedSource {
  return { path, analysis: analyzeSwiftFile(path, content) };
}

describe("analyzeScreenReachability", () => {
  it("reports a screen nothing else refers to", () => {
    const sources = [
      source(
        "App/CategoryDetailScreen.swift",
        'import SwiftUI\nstruct CategoryDetailScreen: View {\n  var body: some View { Text("x") }\n}\n',
      ),
      source(
        "App/HomeScreen.swift",
        "import SwiftUI\nstruct HomeScreen: View {\n  var body: some View { LessonList() }\n}\n",
      ),
    ];

    const result = analyzeScreenReachability(sources);
    const orphan = result.find((r) => r.type === "CategoryDetailScreen");
    expect(orphan?.orphaned).toBe(true);
    expect(orphan?.referenced_by).toEqual([]);
  });

  it("does not call a screen orphaned when another file constructs it", () => {
    const sources = [
      source(
        "App/HomeScreen.swift",
        'import SwiftUI\nstruct HomeScreen: View {\n  var body: some View { Text("x") }\n}\n',
      ),
      source(
        "App/Router.swift",
        "import SwiftUI\nstruct Router {\n  func start() -> some View { HomeScreen() }\n}\n",
      ),
    ];

    const result = analyzeScreenReachability(sources);
    const home = result.find((r) => r.type === "HomeScreen");
    expect(home?.orphaned).toBe(false);
    expect(home?.referenced_by).toEqual(["App/Router.swift"]);
  });

  it("ignores a name that only appears inside a string literal", () => {
    // The exact trap: a log line mentioning the type would make dead code look
    // reachable, which is the failure this analysis exists to prevent.
    const sources = [
      source(
        "App/DeadScreen.swift",
        'import SwiftUI\nstruct DeadScreen: View {\n  var body: some View { Text("x") }\n}\n',
      ),
      source(
        "App/Logger.swift",
        'import Foundation\nstruct AppLogger {\n  func log() { print("navigating to DeadScreen") }\n}\n',
      ),
    ];

    const result = analyzeScreenReachability(sources);
    expect(result.find((r) => r.type === "DeadScreen")?.orphaned).toBe(true);
  });

  it("still sees a reference inside string interpolation", () => {
    const sources = [
      source(
        "App/LiveScreen.swift",
        'import SwiftUI\nstruct LiveScreen: View {\n  var body: some View { Text("x") }\n}\n',
      ),
      source(
        "App/Describe.swift",
        'import Foundation\nstruct D {\n  func f() { print("view: \\(LiveScreen.self)") }\n}\n',
      ),
    ];

    const result = analyzeScreenReachability(sources);
    expect(result.find((r) => r.type === "LiveScreen")?.orphaned).toBe(false);
  });

  it("does not count a test file as a use of a screen", () => {
    // A screen only its test refers to is still unreachable in the app; counting
    // the test would hide exactly that.
    const sources = [
      source(
        "App/OrphanScreen.swift",
        'import SwiftUI\nstruct OrphanScreen: View {\n  var body: some View { Text("x") }\n}\n',
      ),
      source(
        "Tests/OrphanScreenTests.swift",
        "import XCTest\nfinal class OrphanScreenTests: XCTestCase {\n  func testIt() { _ = OrphanScreen() }\n}\n",
      ),
    ];

    const result = analyzeScreenReachability(sources);
    expect(result.find((r) => r.type === "OrphanScreen")?.orphaned).toBe(true);
  });

  it("recognizes a UIKit controller by its superclass, not just its name", () => {
    const sources = [
      source(
        "App/Legacy.swift",
        "import UIKit\nfinal class Legacy: UIViewController {}\n",
      ),
    ];
    const result = analyzeScreenReachability(sources);
    expect(result.map((r) => r.type)).toContain("Legacy");
  });

  it("ignores non-screen types entirely", () => {
    const sources = [
      source(
        "App/Model.swift",
        "import Foundation\nstruct Lesson: Codable { let id: String }\n",
      ),
    ];
    expect(analyzeScreenReachability(sources)).toEqual([]);
  });

  it("attributes a screen to its feature so planning can scope the question", () => {
    const sources = [
      source(
        "App/Features/Alarm/AlarmScreen.swift",
        'import SwiftUI\nstruct AlarmScreen: View {\n  var body: some View { Text("x") }\n}\n',
      ),
    ];
    const result = analyzeScreenReachability(sources, [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.9,
        entry_points: [],
        source_files: ["App/Features/Alarm/AlarmScreen.swift"],
        requirements: [],
        frameworks: [],
        evidence: [],
      },
    ]);
    expect(result[0]?.feature).toBe("alarm");
  });
});
