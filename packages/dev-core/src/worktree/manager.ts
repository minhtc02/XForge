import { join } from "node:path";
import type { Worktree } from "../models/plan.js";
import type { CommandRunner, CommandSpec } from "../execution/runner.js";
import {
  isSafeToDelete,
  isSafeWorktreePath,
  isValidDevBranch,
  type WorktreeSafetyContext,
} from "./safety.js";

/**
 * Worktree manager (blueprint §10, Roadmap Phase 2). Turns a planned set of
 * {@link Worktree}s into git command-specs and executes them through a
 * {@link CommandRunner}. The main checkout is read-only: every path is
 * re-validated against the safety layer here (defence in depth — the planner
 * validates too), so a mutated plan can never make us `git worktree add` outside
 * `.xforge/worktrees/` or delete the main checkout.
 *
 * Nothing in this module ever runs a command itself — it builds specs and hands
 * them to the injected runner. With the DryRunCommandRunner that means the exact
 * git plan is recorded without touching the repo; with the SpawnCommandRunner
 * (only under `--execute`) the worktrees are actually created.
 */

export interface WorktreeManagerContext extends WorktreeSafetyContext {
  runner: CommandRunner;
}

export type WorktreeOp = "add" | "remove";

export interface WorktreeOpResult {
  worktree: Worktree;
  op: WorktreeOp;
  spec: CommandSpec;
  code: number;
  safe: boolean;
  skippedReason?: string;
}

/** Absolute path git needs; relative paths are resolved under the project root. */
function absPath(projectRoot: string, rel: string): string {
  return join(projectRoot, rel);
}

/** Build the `git worktree add -b <branch> <path> <base>` spec (never runs). */
export function worktreeAddSpec(
  ctx: WorktreeSafetyContext,
  wt: Worktree,
): CommandSpec {
  return {
    label: `git worktree add ${wt.path} (${wt.branch})`,
    command: "git",
    args: [
      "worktree",
      "add",
      "-b",
      wt.branch,
      absPath(ctx.projectRoot, wt.path),
      wt.base,
    ],
    cwd: ctx.projectRoot,
  };
}

/** Build the `git worktree remove --force <path>` spec (never runs). */
export function worktreeRemoveSpec(
  ctx: WorktreeSafetyContext,
  wt: Worktree,
): CommandSpec {
  return {
    label: `git worktree remove ${wt.path}`,
    command: "git",
    args: ["worktree", "remove", "--force", absPath(ctx.projectRoot, wt.path)],
    cwd: ctx.projectRoot,
  };
}

/**
 * Create every planned worktree. Each is safety-checked immediately before its
 * command is emitted; an unsafe path/branch is skipped (never executed) and
 * reported, so one bad entry cannot compromise the main checkout or abort the
 * others.
 */
export async function createWorktrees(
  ctx: WorktreeManagerContext,
  worktrees: Worktree[],
): Promise<WorktreeOpResult[]> {
  const results: WorktreeOpResult[] = [];
  for (const wt of worktrees) {
    const guard = guardWorktree(ctx, wt.path, wt.branch);
    const spec = worktreeAddSpec(ctx, wt);
    if (!guard.safe) {
      results.push({
        worktree: wt,
        op: "add",
        spec,
        code: -1,
        safe: false,
        skippedReason: guard.reason,
      });
      continue;
    }
    const res = await ctx.runner.run(spec);
    results.push({ worktree: wt, op: "add", spec, code: res.code, safe: true });
  }
  return results;
}

/**
 * Remove worktrees during cleanup. Uses the stricter {@link isSafeToDelete}
 * (never the worktree root itself) so cleanup can only ever delete an
 * XForge-managed worktree directory.
 */
export async function removeWorktrees(
  ctx: WorktreeManagerContext,
  worktrees: Worktree[],
): Promise<WorktreeOpResult[]> {
  const results: WorktreeOpResult[] = [];
  for (const wt of worktrees) {
    const del = isSafeToDelete(ctx, wt.path);
    const spec = worktreeRemoveSpec(ctx, wt);
    if (!del.safe) {
      results.push({
        worktree: wt,
        op: "remove",
        spec,
        code: -1,
        safe: false,
        skippedReason: del.reason,
      });
      continue;
    }
    const res = await ctx.runner.run(spec);
    results.push({
      worktree: wt,
      op: "remove",
      spec,
      code: res.code,
      safe: true,
    });
  }
  return results;
}

/** A worktree is created only if its path is safe AND its branch is valid. */
export function guardWorktree(
  ctx: WorktreeSafetyContext,
  path: string,
  branch: string,
): { safe: boolean; reason?: string } {
  const pathSafety = isSafeWorktreePath(ctx, path);
  if (!pathSafety.safe) return { safe: false, reason: pathSafety.reason };
  if (!isValidDevBranch(branch))
    return { safe: false, reason: "invalid-branch" };
  return { safe: true };
}
