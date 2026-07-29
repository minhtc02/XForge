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
