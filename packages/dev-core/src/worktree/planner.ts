import { posix } from "node:path";
import type { ImplementationGroup, Worktree } from "../models/plan.js";
import { isSafeWorktreePath, isValidDevBranch } from "./safety.js";

/**
 * Worktree planning (blueprint §10). Maps implementation groups to isolated
 * worktrees under `.xforge/worktrees/<change-id>/<group>` with branches named
 * `xforge/dev/<change-id>/<group>`, plus a dedicated integration worktree. The
 * planner only *plans* — it never creates anything (that is Phase 2), and it
 * validates every path/branch through the safety layer.
 */

export interface WorktreePlanInput {
  changeId: string;
  base: string;
  worktreeRootRel: string;
  groups: ImplementationGroup[];
  projectRoot: string;
}

export interface WorktreePlanResult {
  worktrees: Worktree[];
  integrationBranch: string;
  /** Non-fatal validation problems found while planning. */
  issues: string[];
}

export function planWorktrees(input: WorktreePlanInput): WorktreePlanResult {
  const issues: string[] = [];
  const worktrees: Worktree[] = [];

  const makePath = (group: string): string =>
    posix.join(input.worktreeRootRel, input.changeId, group);
  const makeBranch = (group: string): string =>
    `xforge/dev/${input.changeId}/${group}`;

  const validate = (path: string, branch: string): void => {
    const safety = isSafeWorktreePath(
      {
        projectRoot: input.projectRoot,
        worktreeRootRel: input.worktreeRootRel,
      },
      path,
    );
    if (!safety.safe)
      issues.push(`unsafe worktree path ${path}: ${safety.reason}`);
    if (!isValidDevBranch(branch)) issues.push(`invalid branch name ${branch}`);
  };

  for (const group of input.groups) {
    const path = makePath(group.id);
    const branch = makeBranch(group.id);
    validate(path, branch);
    worktrees.push({
      id: `wt-${group.id}`,
      path,
      branch,
      base: input.base,
      group_id: group.id,
      is_integration: false,
    });
  }

  const integrationPath = makePath("integration");
  const integrationBranch = makeBranch("integration");
  validate(integrationPath, integrationBranch);
  worktrees.push({
    id: "wt-integration",
    path: integrationPath,
    branch: integrationBranch,
    base: input.base,
    is_integration: true,
  });

  return { worktrees, integrationBranch, issues };
}
