import { describe, expect, it } from "vitest";
import { analyzeSwiftFile, inferRole } from "./parser.js";

describe("analyzeSwiftFile", () => {
  it("extracts imports, types with conformances, and functions", () => {
    const src = [
      "import SwiftUI",
      "import Foundation",
      "",
      "public struct AlarmView: View {",
      '  var body: some View { Text("a") }',
      "  func refresh() {}",
      "}",
      "",
      "final class AlarmViewModel: ObservableObject {",
      "  func add() {}",
      "}",
    ].join("\n");
    const a = analyzeSwiftFile("Sources/Alarm/AlarmView.swift", src);
    expect(a.imports).toEqual(["Foundation", "SwiftUI"]);
    expect(a.types.map((t) => t.name)).toContain("AlarmView");
    const view = a.types.find((t) => t.name === "AlarmView")!;
    expect(view.kind).toBe("struct");
    expect(view.inherits).toContain("View");
    expect(view.isPublic).toBe(true);
    expect(view.line).toBe(4);
    const vm = a.types.find((t) => t.name === "AlarmViewModel")!;
    expect(vm.inherits).toContain("ObservableObject");
    expect(a.functions.map((f) => f.name)).toEqual(
      expect.arrayContaining(["refresh", "add"]),
    );
  });

  it("captures @testable imports on test files", () => {
    const src = [
      "import XCTest",
      "@testable import CuckooAlarm",
      "final class AlarmTests: XCTestCase {",
      "  func testX() {}",
      "}",
    ].join("\n");
    const a = analyzeSwiftFile("Tests/AlarmTests/AlarmTests.swift", src);
    expect(a.testableImports).toEqual(["CuckooAlarm"]);
    expect(a.role).toBe("test");
  });

  it("ignores declarations inside comments", () => {
    const src = [
      "// class CommentedOut: View {}",
      "/* struct AlsoCommented: View {} */",
      "struct Real: View {}",
    ].join("\n");
    const a = analyzeSwiftFile("R.swift", src);
    expect(a.types.map((t) => t.name)).toEqual(["Real"]);
  });

  it("handles multi-line block comments", () => {
    const src = [
      "/*",
      "struct Hidden: View {}",
      "*/",
      "struct Visible: View {}",
    ].join("\n");
    const a = analyzeSwiftFile("R.swift", src);
    expect(a.types.map((t) => t.name)).toEqual(["Visible"]);
  });

  it("strips generic where-clauses from conformances", () => {
    const src = "extension Array: Foo where Element: Bar {}";
    const a = analyzeSwiftFile("R.swift", src);
    expect(a.types[0]!.inherits).toEqual(["Foo"]);
  });
});

describe("inferRole", () => {
  it.each([
    ["Sources/App/CuckooApp.swift", "app-entry"],
    ["Sources/Alarm/AlarmView.swift", "view"],
    ["Sources/Alarm/AlarmViewModel.swift", "view-model"],
    ["Sources/Alarm/AlarmRepository.swift", "repository"],
    ["Sources/Alarm/AlarmService.swift", "service"],
    ["Sources/Alarm/AlarmScheduler.swift", "scheduler"],
    ["Sources/Alarm/LoginViewController.swift", "view"],
    ["Tests/AlarmTests.swift", "test"],
  ] as const)("infers %s -> %s", (path, role) => {
    expect(inferRole(path, [], [])).toBe(role);
  });

  it("falls back to conformance hints when the filename is generic", () => {
    expect(
      inferRole("Sources/Thing.swift", [
        {
          name: "Thing",
          kind: "struct",
          inherits: ["View"],
          line: 1,
          isPublic: false,
        },
      ]),
    ).toBe("view");
  });
});
