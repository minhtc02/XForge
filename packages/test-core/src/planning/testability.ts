import type { Feature, ProjectModel } from "@xforge/core";
import type { TestabilityIssue } from "../models/plan.js";
import type { TestabilityMode } from "../models/enums.js";

/**
 * Testability analysis (blueprint §13). Deterministically inspects the Project
 * Model + source roles to find automation blockers before a run, so nothing is
 * discovered mid-run (blueprint §4.1). It never reads production source content
 * here — it reasons over the structured model that XForge Core already built.
 */

export interface TestabilityInput {
  model: ProjectModel;
  features: Feature[];
  mode: TestabilityMode;
  /** Whether a UI test target was detected in the repo. */
  hasUiTestTarget: boolean;
  /** Whether any accessibility identifiers were detected (heuristic). */
  hasAccessibilityIdentifiers: boolean;
}

let counter = 0;
function nextId(kind: string): string {
  counter += 1;
  return `TI-${kind.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${String(counter).padStart(3, "0")}`;
}

/** Analyze testability, returning issues ordered by severity. */
export function analyzeTestability(
  input: TestabilityInput,
): TestabilityIssue[] {
  counter = 0;
  const issues: TestabilityIssue[] = [];
  const readOnly = input.mode === "read-only";

  if (!input.hasUiTestTarget) {
    issues.push({
      id: nextId("ui-test-target"),
      kind: "missing-ui-test-target",
      description:
        "No UI test target detected. XCUITest cases cannot run until a UI test target/scheme exists.",
      severity: "blocker",
      affected_cases: [],
      remediation:
        "Add a UI test target and a shared scheme (test-support mode can scaffold this on approval).",
      blocks_automation: true,
    });
  }

  if (!input.hasAccessibilityIdentifiers) {
    issues.push({
      id: nextId("a11y-identifiers"),
      kind: "missing-accessibility-identifiers",
      description:
        "No accessibility identifiers detected on interactive views; locators will be brittle.",
      severity: readOnly ? "major" : "minor",
      affected_cases: [],
      remediation: readOnly
        ? "Read-only mode cannot add identifiers; affected cases will be BLOCKED."
        : "Add DEBUG-only accessibilityIdentifier values via a test-support patch.",
      blocks_automation: readOnly,
    });
  }

  // Feature-level heuristics from roles/technologies in the model.
  const techNames = new Set(input.model.technologies.map((t) => t.name));
  const usesNotifications = techNames.has("UserNotifications");
  const usesNetworking = input.model.technologies.some(
    (t) => t.category === "networking" || t.category === "backend",
  );

  if (usesNotifications) {
    issues.push({
      id: nextId("permission-dialog"),
      kind: "uncontrolled-permission-dialog",
      description:
        "App uses UserNotifications; the system permission dialog must be controlled or pre-granted for deterministic runs.",
      severity: "major",
      affected_cases: [],
      remediation:
        "Pre-grant notification permission via simulator setup or a launch-argument-driven mock permission state.",
      blocks_automation: false,
    });
  }

  if (usesNetworking) {
    issues.push({
      id: nextId("network-mock"),
      kind: "network-not-mockable",
      description:
        "Networking detected; without a mock layer, tests may be flaky or hit real endpoints.",
      severity: "major",
      affected_cases: [],
      remediation:
        "Enable a launch-environment-selected mock networking scenario (test-support mode).",
      blocks_automation: false,
    });
  }

  // A feature with no test evidence is a coverage risk (not a hard blocker).
  for (const f of input.features) {
    if (!f.evidence.some((e) => e.kind === "test")) {
      issues.push({
        id: nextId("coverage"),
        kind: "no-existing-coverage",
        description: `Feature "${f.id}" has no existing test evidence; automation locators are unverified.`,
        severity: "minor",
        affected_cases: [],
        remediation:
          "Generate XCUITest coverage; verify locators against a booted simulator.",
        blocks_automation: false,
      });
    }
  }

  const order = { blocker: 0, critical: 1, major: 2, minor: 3, info: 4 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
