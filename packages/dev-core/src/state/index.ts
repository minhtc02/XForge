import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * `.xforge/dev/` layout (blueprint §21, §14, §12). Plans, runs (delivery
 * packages), spec-staging journals, design snapshots and worktrees.
 */

export const DEV_DIR = ".xforge/dev";
export const WORKTREE_DIR = ".xforge/worktrees";

export function devRoot(projectRoot: string): string {
  return join(projectRoot, DEV_DIR);
}

export function worktreeRoot(projectRoot: string): string {
  return join(projectRoot, WORKTREE_DIR);
}

export function plansDir(projectRoot: string): string {
  return join(devRoot(projectRoot), "plans");
}

export function planDir(projectRoot: string, planId: string): string {
  return join(plansDir(projectRoot), planId);
}

export const PLAN_FILES = {
  plan: "plan.json",
  planMarkdown: "plan.md",
  effectiveSpec: "effective-spec.md",
  effectiveSpecJson: "effective-spec.json",
  traceability: "requirement-traceability.md",
  permissions: "permission-manifest.json",
  stagedSpec: "staged-spec.json",
} as const;

export function planFilePath(
  projectRoot: string,
  planId: string,
  file: keyof typeof PLAN_FILES,
): string {
  return join(planDir(projectRoot, planId), PLAN_FILES[file]);
}

export function runsDir(projectRoot: string, runsRoot: string): string {
  return join(projectRoot, runsRoot);
}

export function runDir(
  projectRoot: string,
  runsRoot: string,
  runId: string,
): string {
  return join(runsDir(projectRoot, runsRoot), runId);
}

export function specStagingDir(projectRoot: string, runId: string): string {
  return join(devRoot(projectRoot), "spec-staging", runId);
}

export function designSnapshotDir(projectRoot: string, planId: string): string {
  return join(devRoot(projectRoot), "design-snapshots", planId);
}

/** Create the `.xforge/dev/` skeleton. Idempotent. Never touches worktrees. */
export async function ensureDevDirs(projectRoot: string): Promise<string[]> {
  const created: string[] = [];
  for (const sub of ["plans", "runs", "spec-staging", "design-snapshots"]) {
    const p = join(devRoot(projectRoot), sub);
    await mkdir(p, { recursive: true });
    created.push(p);
  }
  return created;
}
