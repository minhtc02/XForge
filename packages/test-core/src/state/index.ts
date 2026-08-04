import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * `.xforge/test/` layout (blueprint §23). Plan artifacts live under
 * `plans/<plan-id>/`; snapshots, baselines, state and cache are siblings.
 */

export const TEST_DIR = ".xforge/test";

export function testRoot(projectRoot: string): string {
  return join(projectRoot, TEST_DIR);
}

export function plansDir(projectRoot: string): string {
  return join(testRoot(projectRoot), "plans");
}

export function planDir(projectRoot: string, planId: string): string {
  return join(plansDir(projectRoot), planId);
}

export const PLAN_FILES = {
  plan: "plan.json",
  planMarkdown: "plan.md",
  testCases: "test-cases.json",
  testabilityReport: "testability-report.md",
  permissions: "permissions.md",
  approval: "approval.json",
} as const;

export function planFilePath(
  projectRoot: string,
  planId: string,
  file: keyof typeof PLAN_FILES,
): string {
  return join(planDir(projectRoot, planId), PLAN_FILES[file]);
}

export function designSnapshotDir(projectRoot: string, planId: string): string {
  return join(testRoot(projectRoot), "design-snapshots", planId);
}

/** Generated XCUITest sources for a plan (`xforge test generate`). */
export function generatedTestsDir(projectRoot: string, planId: string): string {
  return join(testRoot(projectRoot), "generated-tests", planId);
}

export const GENERATED_FILES = {
  uiTests: "XForgeUITests.swift",
  testSupport: "XForgeTestSupport.swift",
  probe: "XForgeProbeTests.swift",
  readme: "README.md",
} as const;

export function generatedFilePath(
  projectRoot: string,
  planId: string,
  file: keyof typeof GENERATED_FILES,
): string {
  return join(generatedTestsDir(projectRoot, planId), GENERATED_FILES[file]);
}

/** The navigation graph a plan's BFS reads (blueprint §13, optimization §A). */
export function navigationGraphPath(
  projectRoot: string,
  relative = "navigation.yaml",
): string {
  return join(testRoot(projectRoot), relative);
}

/** qa-runs/<run-id>/ layout (blueprint §23). */
export function runDir(
  projectRoot: string,
  runsRoot: string,
  runId: string,
): string {
  return join(projectRoot, runsRoot, runId);
}

export const RUN_FILES = {
  summaryMarkdown: "summary.md",
  summaryJson: "summary.json",
  testResults: "test-results.json",
  bugsJson: "bugs.json",
  coverageMarkdown: "coverage.md",
} as const;

export function runFilePath(
  projectRoot: string,
  runsRoot: string,
  runId: string,
  file: keyof typeof RUN_FILES,
): string {
  return join(runDir(projectRoot, runsRoot, runId), RUN_FILES[file]);
}

/** Artifact sub-trees inside a run (screenshots, diffs, probe dumps, §23). */
export const RUN_ARTIFACT_DIRS = {
  screens: "artifacts/screens",
  diffs: "artifacts/diffs",
  probe: "artifacts/probe",
  xcresult: "xcresult",
} as const;

export function runArtifactDir(
  projectRoot: string,
  runsRoot: string,
  runId: string,
  kind: keyof typeof RUN_ARTIFACT_DIRS,
): string {
  return join(runDir(projectRoot, runsRoot, runId), RUN_ARTIFACT_DIRS[kind]);
}

/** Where a case's screenshot for a given step is stored. */
export function screenshotPath(
  projectRoot: string,
  runsRoot: string,
  runId: string,
  caseId: string,
  /** Shard the capture came from — the same case runs on several devices. */
  shardId: string,
  name: string,
): string {
  return join(
    runArtifactDir(projectRoot, runsRoot, runId, "screens"),
    caseId,
    shardId,
    `${name}.png`,
  );
}

/** Visual baselines live outside runs so they survive across them (§12). */
export function visualBaselinePath(
  projectRoot: string,
  feature: string,
  /** Shard id: a baseline is only comparable within the same device + state. */
  shardId: string,
  name: string,
): string {
  return join(
    testRoot(projectRoot),
    "baselines",
    feature,
    shardId,
    `${name}.png`,
  );
}

/** Where a diff image for one comparison is written. */
export function visualDiffPath(
  projectRoot: string,
  runsRoot: string,
  runId: string,
  caseId: string,
  shardId: string,
  name: string,
): string {
  return join(
    runArtifactDir(projectRoot, runsRoot, runId, "diffs"),
    caseId,
    shardId,
    `${name}.png`,
  );
}

/** Create the `.xforge/test/` skeleton. Idempotent. */
export async function ensureTestDirs(projectRoot: string): Promise<string[]> {
  const created: string[] = [];
  for (const sub of [
    "plans",
    "design-snapshots",
    "generated-tests",
    "baselines",
    "state",
    "cache",
  ]) {
    const p = join(testRoot(projectRoot), sub);
    await mkdir(p, { recursive: true });
    created.push(p);
  }
  return created;
}
