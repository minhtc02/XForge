import type { Worktree } from "../models/plan.js";
import type { CommandRunner, CommandSpec } from "./runner.js";
import { isValidDevBranch } from "../worktree/safety.js";

/**
 * Integration planner (blueprint §6, §21, Roadmap Phase 6). Merges each feature
 * worktree's branch into the integration branch — never into main. The commands
 * run inside the *integration worktree*, so the main checkout is never a merge
 * target (master prompt §Worktree safety: mergeIntoMain is denied). Merges use
 * `--no-ff` so every feature branch stays visible in history, and a conflicting
 * merge is aborted (`git merge --abort`) rather than left half-applied — the
 * conflict is reported for a human/agent to resolve, continue-on-failure (§22
 * continue_on_agent_failure).
 */

export interface IntegrationInput {
  integration: Worktree;
  featureBranches: string[];
  runner: CommandRunner;
  dryRun: boolean;
  projectRoot: string;
}

export interface MergeOutcome {
  branch: string;
  merged: boolean;
  conflicted: boolean;
  skippedReason?: string;
}

export interface IntegrationOutcome {
  integration_branch: string;
  merged_branches: string[];
  conflicts: string[];
  merges: MergeOutcome[];
}

function mergeSpec(cwd: string, branch: string): CommandSpec {
  return {
    label: `git merge --no-ff ${branch}`,
    command: "git",
    args: ["merge", "--no-ff", "--no-edit", branch],
    cwd,
  };
}

function abortSpec(cwd: string): CommandSpec {
  return {
    label: "git merge --abort",
    command: "git",
    args: ["merge", "--abort"],
    cwd,
  };
}

export async function integrateBranches(
  input: IntegrationInput,
): Promise<IntegrationOutcome> {
  // The integration worktree's absolute path is where merges happen.
  const cwd = `${input.projectRoot}/${input.integration.path}`;
  const merges: MergeOutcome[] = [];
  const mergedBranches: string[] = [];
  const conflicts: string[] = [];

  for (const branch of input.featureBranches) {
    // Never merge an invalid or main-looking ref.
    if (!isValidDevBranch(branch)) {
      merges.push({
        branch,
        merged: false,
        conflicted: false,
        skippedReason: "invalid-branch",
      });
      continue;
    }
    const spec = mergeSpec(cwd, branch);
    if (input.dryRun) {
      await input.runner.run(spec);
      merges.push({
        branch,
        merged: false,
        conflicted: false,
        skippedReason: "dry-run",
      });
      continue;
    }
    const res = await input.runner.run(spec);
    if (res.code === 0) {
      merges.push({ branch, merged: true, conflicted: false });
      mergedBranches.push(branch);
    } else {
      // Abort so the integration worktree stays clean for the next branch.
      await input.runner.run(abortSpec(cwd));
      merges.push({ branch, merged: false, conflicted: true });
      conflicts.push(branch);
    }
  }

  return {
    integration_branch: input.integration.branch,
    merged_branches: mergedBranches,
    conflicts,
    merges,
  };
}
