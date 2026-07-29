import { describe, expect, it } from "vitest";
import { parseProjectModel, type ProjectModel } from "@xforge/core";
import { analyzeTestability } from "./testability.js";

function model(
  overrides: Partial<Parameters<typeof parseProjectModel>[0]> = {},
): ProjectModel {
  return parseProjectModel({
    project: { id: "app", name: "App", type: "ios-application" },
    technologies: [],
    features: [],
    metadata: { generator_version: "0.1.0" },
    ...overrides,
  });
}

describe("analyzeTestability", () => {
  it("flags a missing UI test target as a blocker", () => {
    const issues = analyzeTestability({
      model: model(),
      features: [],
      mode: "test-support",
      hasUiTestTarget: false,
      hasAccessibilityIdentifiers: true,
    });
    const blocker = issues.find((i) => i.kind === "missing-ui-test-target");
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe("blocker");
    expect(blocker!.blocks_automation).toBe(true);
  });

  it("in read-only mode, missing a11y identifiers blocks automation", () => {
    const issues = analyzeTestability({
      model: model(),
      features: [],
      mode: "read-only",
      hasUiTestTarget: true,
      hasAccessibilityIdentifiers: false,
    });
    const a11y = issues.find(
      (i) => i.kind === "missing-accessibility-identifiers",
    )!;
    expect(a11y.blocks_automation).toBe(true);
    expect(a11y.severity).toBe("major");
  });

  it("in test-support mode, missing a11y identifiers is a non-blocking minor", () => {
    const issues = analyzeTestability({
      model: model(),
      features: [],
      mode: "test-support",
      hasUiTestTarget: true,
      hasAccessibilityIdentifiers: false,
    });
    const a11y = issues.find(
      (i) => i.kind === "missing-accessibility-identifiers",
    )!;
    expect(a11y.blocks_automation).toBe(false);
    expect(a11y.severity).toBe("minor");
  });

  it("flags uncontrolled permission dialogs when notifications are used", () => {
    const issues = analyzeTestability({
      model: model({
        technologies: [
          {
            name: "UserNotifications",
            category: "notifications",
            confidence: 0.9,
            evidence: [],
          },
        ],
      }),
      features: [],
      mode: "test-support",
      hasUiTestTarget: true,
      hasAccessibilityIdentifiers: true,
    });
    expect(
      issues.some((i) => i.kind === "uncontrolled-permission-dialog"),
    ).toBe(true);
  });

  it("orders blockers before minor issues", () => {
    const issues = analyzeTestability({
      model: model(),
      features: [],
      mode: "test-support",
      hasUiTestTarget: false,
      hasAccessibilityIdentifiers: false,
    });
    expect(issues[0]!.severity).toBe("blocker");
  });
});
