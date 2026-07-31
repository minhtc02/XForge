import type { Feature, ProjectModel } from "@xforge/core";
import type { TestabilityIssue } from "../models/plan.js";
import type { TestabilityMode } from "../models/enums.js";
import type { TestCase } from "../models/test-case.js";
import type { ReconcileResult } from "./reconcile.js";

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
  /** Generated cases, for assertion + locator checks. */
  cases?: TestCase[];
  /** Static locator reconciliation against the Project Model's inventory. */
  reconcile?: ReconcileResult;
  /** Declared permissions a simulator cannot pre-grant (from Info.plist). */
  ungrantablePermissions?: Array<{ key: string; service: string }>;
  /** Features the navigation graph could not reach at the confidence gate. */
  unreachableFeatures?: string[];
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

  // Permissions Apple exposes no simulator switch for must be handled in-test;
  // discovering this mid-run would violate §4.1.
  for (const permission of input.ungrantablePermissions ?? []) {
    issues.push({
      id: nextId("permission-grant"),
      kind: "permission-not-simctl-grantable",
      description: `"${permission.service}" (${permission.key}) is declared but \`xcrun simctl privacy grant\` cannot pre-authorize it; the system alert will appear during the run.`,
      severity: "major",
      affected_cases: [],
      remediation:
        "Generate an addUIInterruptionMonitor for the alert, or gate the state behind a test-support hook.",
      blocks_automation: false,
    });
  }

  // Locators that do not exist in source will time out on every case that uses
  // them — catch it here instead of after a build (§4.1).
  const reconcile = input.reconcile;
  if (reconcile && !reconcile.skipped) {
    const missing = reconcile.deviations.filter((d) => d.kind === "missing");
    const unresolvable = reconcile.deviations.filter(
      (d) => d.kind === "unresolvable",
    );
    if (missing.length > 0) {
      const byLocator = [...new Set(missing.map((d) => d.locator))].sort();
      issues.push({
        id: nextId("locator-missing"),
        kind: "locator-not-found-in-source",
        description: `DEVIATION: ${byLocator.length} locator(s) are not declared as an accessibilityIdentifier anywhere in source: ${byLocator.join(", ")}. Tests using them can only fail by timeout.`,
        severity: "critical",
        affected_cases: [...new Set(missing.map((d) => d.case_id))].sort(),
        remediation:
          "Add the missing accessibilityIdentifier values to the views (test-support mode can patch them DEBUG-only), or correct the plan's targets.",
        blocks_automation: readOnly,
      });
    }
    if (unresolvable.length > 0) {
      const byLocator = [...new Set(unresolvable.map((d) => d.locator))].sort();
      issues.push({
        id: nextId("locator-dynamic"),
        kind: "locator-not-statically-resolvable",
        description: `${byLocator.length} locator(s) could not be verified statically because the source builds identifiers dynamically: ${byLocator.join(", ")}. A live probe is required to confirm them.`,
        severity: "minor",
        affected_cases: [...new Set(unresolvable.map((d) => d.case_id))].sort(),
        remediation:
          "Confirm against a booted simulator, or use a stable literal identifier for the elements under test.",
        blocks_automation: false,
      });
    }
  }

  // A screen no confident path reaches cannot be tested. Reported rather than
  // navigated to by guesswork — a wrong prefix fails in a way that looks like a
  // product bug (§6, never invent).
  if ((input.unreachableFeatures ?? []).length > 0) {
    issues.push({
      id: nextId("navigation"),
      kind: "no-navigation-path",
      description: `No navigation path above the confidence threshold reaches: ${input.unreachableFeatures!.join(", ")}. No cases were generated for them.`,
      severity: "major",
      affected_cases: [],
      remediation:
        "Add the missing edges to .xforge/test/navigation.yaml (scaffold one with `xforge test navigation --init`), or raise the edge's provenance to `explicit` once confirmed.",
      blocks_automation: false,
    });
  }

  // A case that asserts nothing cannot fail on behaviour — the "exit-0 trap".
  const unverifiable = (input.cases ?? []).filter(
    (c) => c.expected_results.length > 0 && c.assertions.length === 0,
  );
  if (unverifiable.length > 0) {
    issues.push({
      id: nextId("unverifiable-expectation"),
      kind: "unverifiable-expectation",
      description: `${unverifiable.length} case(s) declare expected results with no machine-checkable assertion; they would report a pass without verifying behaviour.`,
      severity: "major",
      affected_cases: unverifiable.map((c) => c.id).sort(),
      remediation:
        "Add assertions to the case, or accept that the expectation is recorded as skipped (never as a pass).",
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
