import { describe, expect, it } from "vitest";
import {
  blockedCaseIds,
  locatorsForCase,
  reconcileLocators,
  type IdentifierInventoryEntry,
} from "./reconcile.js";
import type { TestCase } from "../models/test-case.js";

function caseWith(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "TC-ALARM-001",
    title: "Open Alarm",
    feature: "alarm",
    types: ["functional"],
    priority: "P0",
    risk_score: 8,
    requirements: [],
    code_references: [],
    design_references: [],
    preconditions: [],
    steps: [
      { id: "s1", action: "launch-app" },
      { id: "s2", action: "open", target: "alarm-list" },
    ],
    expected_results: [],
    assertions: [{ id: "a1", kind: "screen-is", target: "alarm-list" }],
    automation: { framework: "xcuitest", blocked: false },
    confidence: 0.7,
    provenance: ["source"],
    ...overrides,
  };
}

const literal = (
  value: string,
  feature = "alarm",
): IdentifierInventoryEntry => ({
  value,
  expression: `"${value}"`,
  file: "Sources/Alarm/AlarmView.swift",
  start_line: 10,
  dynamic: false,
  feature,
});

const dynamic = (
  expression: string,
  feature = "alarm",
): IdentifierInventoryEntry => ({
  expression,
  file: "Sources/Alarm/AlarmView.swift",
  start_line: 12,
  dynamic: true,
  feature,
});

describe("locatorsForCase", () => {
  it("collects locators from locating steps and assertions", () => {
    const found = locatorsForCase(caseWith());
    expect(found.map((f) => f.locator)).toEqual(["alarm-list", "alarm-list"]);
    expect(found.map((f) => f.origin)).toEqual(["step", "assertion"]);
  });

  it("ignores steps that do not locate an element", () => {
    const found = locatorsForCase(
      caseWith({
        steps: [
          { id: "s1", action: "launch-app" },
          { id: "s2", action: "relaunch-app" },
          { id: "s3", action: "capture-screenshot", target: "alarm-list" },
        ],
        assertions: [],
      }),
    );
    expect(found).toHaveLength(0);
  });
});

describe("reconcileLocators", () => {
  it("matches locators that exist as literals in source", () => {
    const result = reconcileLocators({
      cases: [caseWith()],
      inventory: [literal("alarm-list")],
    });
    expect(result.skipped).toBe(false);
    expect(result.matched).toBe(2);
    expect(result.deviations).toHaveLength(0);
  });

  it("reports a locator absent from source as MISSING", () => {
    const result = reconcileLocators({
      cases: [caseWith()],
      inventory: [literal("something-else")],
    });
    expect(result.deviations.every((d) => d.kind === "missing")).toBe(true);
    expect(result.deviations[0]?.locator).toBe("alarm-list");
    expect(blockedCaseIds(result)).toEqual(["TC-ALARM-001"]);
  });

  it("reports UNRESOLVABLE, not MISSING, when source builds ids dynamically", () => {
    const result = reconcileLocators({
      cases: [caseWith()],
      inventory: [literal("other"), dynamic('"alarm-row-\\(alarm.id)"')],
    });
    expect(result.deviations.every((d) => d.kind === "unresolvable")).toBe(
      true,
    );
    expect(result.deviations[0]?.candidates).toContain(
      '"alarm-row-\\(alarm.id)"',
    );
    // Unresolvable is never a blocker — we cannot prove the locator is wrong.
    expect(blockedCaseIds(result)).toEqual([]);
  });

  it("skips entirely when there is no inventory, rather than claiming failure", () => {
    const result = reconcileLocators({ cases: [caseWith()], inventory: [] });
    expect(result.skipped).toBe(true);
    expect(result.deviations).toHaveLength(0);
    expect(result.checked).toBe(0);
  });

  it("scopes dynamic candidates to the case's own feature", () => {
    const result = reconcileLocators({
      cases: [caseWith()],
      inventory: [
        literal("unrelated", "settings"),
        dynamic('"settings-row-\\(i)"', "settings"),
      ],
    });
    // The dynamics belong to another feature, so alarm's locator is missing.
    expect(result.deviations.every((d) => d.kind === "missing")).toBe(true);
  });

  it("counts each distinct locator origin once", () => {
    const result = reconcileLocators({
      cases: [caseWith(), caseWith({ id: "TC-ALARM-002" })],
      inventory: [literal("alarm-list")],
    });
    expect(result.checked).toBe(4);
    expect(result.matched).toBe(4);
  });
});
