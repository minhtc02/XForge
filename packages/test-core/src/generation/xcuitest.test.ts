import { describe, expect, it } from "vitest";
import {
  generateTestSupportFile,
  generateXcuiTestFile,
  renderAssertion,
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
  assertions: [
    {
      id: "a1",
      kind: "screen-is",
      target: "alarm-screen",
      source_text: "Alarm screen is visible",
    },
  ],
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
    expect(lines.join("\n")).toContain('["save-button"]');
    expect(lines.join("\n")).not.toMatch(/coordinate|tap\(withOffset|CGVector/);
  });

  it("asserts an element exists and is hittable before interacting with it", () => {
    const lines = renderStep({
      id: "s",
      action: "tap",
      target: "save-button",
    }).join("\n");
    expect(lines).toContain("XCTAssertTrue");
    expect(lines).toContain("waitForExistence");
    expect(lines).toContain("isHittable");
    // The assertion must come before the interaction, or a missing element
    // would surface as a crash instead of a readable failure.
    expect(lines.indexOf("XCTAssertTrue")).toBeLessThan(
      lines.indexOf(".tap()"),
    );
  });

  it("emits a screenshot attachment for capture-screenshot", () => {
    expect(
      renderStep({ id: "s", action: "capture-screenshot" }).join("\n"),
    ).toContain("XCTAttachment");
  });

  it("fails loudly on an unmapped action instead of passing silently", () => {
    const lines = renderStep({ id: "s", action: "teleport" }).join("\n");
    expect(lines).toContain("XCTFail");
    expect(lines).toContain("teleport");
  });

  it("skips explicitly for steps with no automatable mapping", () => {
    for (const action of ["set-time", "select-weekdays", "create-item"]) {
      expect(renderStep({ id: "s", action }).join("\n")).toContain("XCTSkipIf");
    }
  });
});

describe("renderAssertion", () => {
  it("renders each kind as a real XCTAssert call", () => {
    const kinds = [
      "exists",
      "not-exists",
      "label-equals",
      "label-contains",
      "count-equals",
      "enabled",
      "selected",
      "screen-is",
    ] as const;
    for (const kind of kinds) {
      const src = renderAssertion({
        id: "a",
        kind,
        target: "alarm-list",
        value: kind === "count-equals" ? 3 : "Alarms",
      }).join("\n");
      expect(src, kind).toMatch(/XCTAssert(True|False|Equal)/);
      expect(src, kind).toContain("alarm-list");
    }
  });

  it("carries the originating expectation into the failure message", () => {
    const src = renderAssertion({
      id: "a",
      kind: "exists",
      target: "alarm-list",
      source_text: "Alarm list is visible",
    }).join("\n");
    expect(src).toContain('"Alarm list is visible"');
  });

  it("escapes values so generated Swift stays valid", () => {
    const src = renderAssertion({
      id: "a",
      kind: "label-equals",
      target: 'weird"id',
      value: 'say "hi"',
    }).join("\n");
    expect(src).toContain('\\"');
    expect(src).not.toMatch(/[^\\]"weird"id"/);
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
    expect(src).toContain("continueAfterFailure = false");
  });

  it("emits a real assertion for the expected result, not a comment", () => {
    const src = generateXcuiTestFile([sampleCase], {
      className: "AlarmUITests",
    });
    expect(src).toContain("XCTAssertTrue");
    expect(src).toContain("// EXPECT: Alarm screen is visible");
    // The expectation is asserted, so it must not also be reported unverified.
    expect(src).not.toContain("unverified expectation");
  });

  it("never lets an unasserted expectation look like a pass", () => {
    const unverified: TestCase = {
      ...sampleCase,
      assertions: [],
      expected_results: ["Something nobody checks"],
    };
    const skipped = generateXcuiTestFile([unverified], { className: "T" });
    expect(skipped).toContain("XCTSkipIf");
    expect(skipped).toContain(
      "unverified expectation: Something nobody checks",
    );

    const strict = generateXcuiTestFile([unverified], {
      className: "T",
      unverifiedExpectations: "fail",
    });
    expect(strict).toContain("XCTFail");
    expect(strict).toContain("unverified expectation: Something nobody checks");
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
