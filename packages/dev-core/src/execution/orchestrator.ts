import type { DevPlan } from "../models/plan.js";
import type { DevConfig } from "../config/schema.js";
import type { DevRun, CodeChange, CommitRecord } from "../models/run.js";
import type { CommandRunner } from "./runner.js";
import { createWorktrees } from "../worktree/manager.js";
import { scheduleGroups } from "./scheduler.js";
import { integrateBranches } from "./integration.js";
import {
  collectAllowedFiles,
  reviewChanges,
  type ChangedFile,
} from "./static-review.js";

/**
 * Development orchestration (blueprint §7 Execution, Roadmap Phase 3 + 6). Ties
 * the pieces together deterministically:
 *
 *   validate plan → create isolated worktrees → schedule groups into waves →
 *   (agents implement code — injected) → static review → integrate → DevRun.
 *
 * The orchestrator NEVER builds, tests, launches a Simulator, or syncs docs —
 * those are opt-in gates run separately (Phase 8). Its only default side effects
 * are git worktree/branch operations, and only under a live runner (`--execute`);
 * the default DryRunCommandRunner records the exact plan and changes nothing.
 *
 * Code generation itself is the Claude agent layer. The orchestrator accepts an
 * `implementGroup` callback so the deterministic flow (isolation, scheduling,
 * review, integration, delivery) is testable without an LLM; the CLI/plugin
 * supplies the real implementation, and a dry run reports zero changes.
 */

export interface ImplementResult {
  changes: CodeChange[];
  commits: CommitRecord[];
  /** Files touched with contents, for the static-review secret scan. */
  reviewed?: ChangedFile[];
}

export interface OrchestratorInput {
  plan: DevPlan;
  config: DevConfig;
  runId: string;
  runner: CommandRunner;
  dryRun: boolean;
  projectRoot: string;
  /**
   * Implement one group's tasks in its worktree. Injected so the flow is pure;
   * dry runs pass a no-op that returns zero changes. Must never write outside
   * the group's file scope — the static review is the deterministic backstop.
   */
  implementGroup?: (groupId: string) => Promise<ImplementResult>;
  now?: () => Date;
}

export async function orchestrateRun(
  input: OrchestratorInput,
): Promise<DevRun> {
  const now = input.now ?? (() => new Date());
  const started = now().toISOString();
  const ctx = {
    projectRoot: input.projectRoot,
    worktreeRootRel: input.config.worktrees.root,
    runner: input.runner,
  };

  // --- 1. Create isolated worktrees (skips + reports any unsafe entry). ---
  const wtResults = await createWorktrees(ctx, input.plan.worktrees);
  const unsafeWorktrees = wtResults.filter((r) => !r.safe);

  // --- 2. Schedule groups into dependency-aware waves. ---
  const schedule = scheduleGroups(input.plan.groups);
  if (schedule.cycles.length > 0) {
    return finalize(input, {
      status: "BLOCKED",
      changes: [],
      commits: [],
      started,
      now,
      staticReview: {
        findings: [
          {
            category: "planning",
            severity: "blocker",
            message: `Cyclic group dependencies: ${schedule.cycles.join(", ")}`,
          },
        ],
        passed: false,
      },
    });
  }

  // --- 3. Implement each group (agents; no-op on dry run). ---
  const changes: CodeChange[] = [];
  const commits: CommitRecord[] = [];
  const reviewed: ChangedFile[] = [];
  let anyGroupFailed = false;

  for (const wave of schedule.waves) {
    for (const group of wave) {
      if (input.dryRun || !input.implementGroup) continue;
      try {
        const res = await input.implementGroup(group.id);
        changes.push(...res.changes);
        commits.push(...res.commits);
        if (res.reviewed) reviewed.push(...res.reviewed);
      } catch {
        anyGroupFailed = true;
        // continue_on_agent_failure (§22): record and keep going.
        if (!input.config.execution.continue_on_agent_failure) break;
      }
    }
  }

  // --- 4. Deterministic static review (always runs on code). ---
  const staticReview = reviewChanges({
    changedFiles: reviewed,
    groups: input.plan.groups,
    allowedFiles: collectAllowedFiles(input.plan.groups),
  });

  // --- 5. Integrate feature branches into the integration branch. ---
  const integrationWt = input.plan.worktrees.find((w) => w.is_integration);
  const featureBranches = input.plan.worktrees
    .filter((w) => !w.is_integration)
    .map((w) => w.branch);
  const integration = integrationWt
    ? await integrateBranches({
        integration: integrationWt,
        featureBranches,
        runner: input.runner,
        dryRun: input.dryRun,
        projectRoot: input.projectRoot,
      })
    : undefined;

  // --- 6. Decide status (implement-only success is CODE_COMPLETED). ---
  const hasBlockers = !staticReview.passed || unsafeWorktrees.length > 0;
  const status = input.dryRun
    ? "PLANNED"
    : hasBlockers
      ? "BLOCKED"
      : anyGroupFailed
        ? "PARTIALLY_COMPLETED"
        : "CODE_COMPLETED";

  return finalize(input, {
    status,
    changes,
    commits,
    integration: integration
      ? {
          integration_branch: integration.integration_branch,
          merged_branches: integration.merged_branches,
          conflicts: integration.conflicts,
        }
      : undefined,
    staticReview,
    started,
    now,
  });
}

function finalize(
  input: OrchestratorInput,
  parts: {
    status: DevRun["status"];
    changes: CodeChange[];
    commits: CommitRecord[];
    integration?: DevRun["integration"];
    staticReview?: DevRun["static_review"];
    started: string;
    now: () => Date;
  },
): DevRun {
  return {
    schema_version: 1,
    run_id: input.runId,
    plan_id: input.plan.id,
    project_id: input.plan.project_id,
    started_at: parts.started,
    finished_at: parts.now().toISOString(),
    dry_run: input.dryRun,
    status: parts.status,
    changes: parts.changes,
    commits: parts.commits,
    integration: parts.integration,
    static_review: parts.staticReview,
    // Optional verification never runs here — always NOT_REQUESTED (§4.1).
    optional_results: {
      build: "NOT_REQUESTED",
      test: "NOT_REQUESTED",
      ui: "NOT_REQUESTED",
      performance: "NOT_REQUESTED",
    },
    docs_sync: "NOT_REQUIRED",
    spec_differences_recorded:
      input.plan.effective_spec.differences?.length ?? 0,
    confidence: input.plan.confidence,
  };
}

/** Make a delivery run id like XFDEVRUN-20260729-001. */
export function makeDevRunId(date: Date, sequence: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `XFDEVRUN-${y}${m}${d}-${String(sequence).padStart(3, "0")}`;
}
