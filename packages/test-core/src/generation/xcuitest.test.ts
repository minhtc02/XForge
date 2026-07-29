import { describe, expect, it } from "vitest";
import {
  generateTestSupportFile,
  generateXcuiTestFile,
  renderStep,
} from "./xcuitest.js";
import type { TestCase } from "../models/test-case.js";

const sampleCase: TestCase = {
  id: "TC-ALARM-001",
  title: "Launch and open Alarm",
  feature: "alarm",
  types: ["functional"],
  priority: "P0",
  risk_score: 9,
  requirements: ["PRD-ALARM-001"],
  code_references: [{ file: "AlarmView.swift" }],
  design_references: [],
  preconditions: ["App freshly launched"],
  steps: [
    { id: "s1", action: "launch-app" },
    { id: "s2", action: "open", target: "alarm-screen" },
    { id: "s3", action: "capture-screenshot" },
  ],
  expected_results: ["Alarm screen is visible"],
  automation: { framework: "xcuitest", blocked: false },
  confidence: 0.7,
  provenance: ["prd", "source"],
};

describe("renderStep", () => {
  it("uses --xforge-test launch argument (test-support opt-in)", () => {
    expect(renderStep({ id: "s", action: "launch-app" }).join("\n")).toContain(
      '"--xforge-test"',
    );
  });

  it("uses accessibility-identifier locators, never coordinates", () => {
    const lines = renderStep({ id: "s", action: "tap", target: "save-button" });
    expect(lines.join("\n")).toContain('app.buttons["save-button"]');
    expect(lines.join("\n")).not.toMatch(/coordinate|tap\(withOffset|CGVector/);
  });

  it("emits a screenshot attachment for capture-screenshot", () => {
    expect(
      renderStep({ id: "s", action: "capture-screenshot" }).join("\n"),
    ).toContain("XCTAttachment");
  });

  it("comments unmapped actions rather than emitting bad Swift", () => {
    expect(renderStep({ id: "s", action: "teleport" }).join("\n")).toContain(
      "// unmapped action: teleport",
    );
  });
});

describe("generateXcuiTestFile", () => {
  it("produces a compilable-looking XCTestCase class with one method per case", () => {
    const src = generateXcuiTestFile([sampleCase], {
      className: "AlarmUITests",
    });
    expect(src).toContain("import XCTest");
    expect(src).toContain("final class AlarmUITests: XCTestCase");
    expect(src).toContain("func test_TC_ALARM_001() throws");
    expect(src).toContain("// EXPECT: Alarm screen is visible");
    expect(src).toContain("continueAfterFailure = false");
  });
});

describe("generateTestSupportFile", () => {
  it("is DEBUG-guarded and opt-in via launch argument", () => {
    const src = generateTestSupportFile();
    expect(src).toContain("#if DEBUG");
    expect(src).toContain("--xforge-test");
    expect(src).toContain("enum XForgeTestSupport");
    expect(src.trimEnd().endsWith("#endif")).toBe(true);
  });
});
