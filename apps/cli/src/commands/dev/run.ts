import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ValidationError } from "@xforge/shared";
import {
  SpawnCommandRunner,
  buildDeliveryManifest,
  isSafeWorktreePath,
  isValidDevBranch,
  makeDevRunId,
  orchestrateRun,
  renderDryRun,
  renderRunSummary,
  runDir,
  serializeJson,
  type DevPlan,
  type DevRun,
} from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";
import { loadDevModelContext, loadPlan } from "./shared.js";

const exec = promisify(execFile);

export interface DevRunOptions {
  dryRun?: boolean;
  execute?: boolean;
}

export interface DevRunResult {
  planId: string;
  runId?: string;
  dryRun: boolean;
  baseBranchValid: boolean;
  worktreePathsSafe: boolean;
  branchesValid: boolean;
  status?: string;
  worktrees: Array<{ path: string; branch: string; safe: boolean }>;
  optionalActions: Record<string, string>;
}

/**
 * `xforge dev run <plan-id>` (blueprint §5.2, §7). Default is a dry-run preview:
 * validate the plan, base branch and worktree paths and show exactly what a run
 * would do — creating nothing. With `--execute` the deterministic orchestrator
 * runs: it creates isolated worktrees under `.xforge/worktrees/`, schedules
 * groups, runs a static review, merges feature branches into the integration
 * branch, and writes a delivery package under `.xforge/dev/runs/`. It NEVER
 * builds, tests, launches a Simulator, syncs docs, or touches the main checkout
 * — those are opt-in gates run separately (§4.1). Actual Swift/Figma code is
 * produced by the Claude agent layer inside the created worktrees.
 */
export async function runDevRun(
  ctx: CliContext,
  planId: string,
  options: DevRunOptions,
): Promise<DevRunResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge dev run <plan-id>",
    );
  }
  const { plan } = await loadPlan(projectRoot, planId);

  // Validate base branch + worktree safety regardless of mode.
  const baseBranchValid = await branchExists(
    projectRoot,
    plan.inputs.base_branch,
  );
  const worktrees = validateWorktrees(projectRoot, plan);
  const worktreePathsSafe = worktrees.every((w) => w.safe);
  const branchesValid = plan.worktrees.every((w) => isValidDevBranch(w.branch));
  if (!worktreePathsSafe) {
    throw new ValidationError(
      "Plan contains unsafe worktree paths or invalid branch names; refusing.",
      { details: { worktrees: worktrees.filter((w) => !w.safe) } },
    );
  }

  const optionalActions = {
    build: plan.optional_actions.build,
    test: plan.optional_actions.test,
    ui_verification: plan.optional_actions.ui_verification,
    performance: plan.optional_actions.performance,
    docs_sync: plan.optional_actions.docs_sync,
  };

  // --- Dry-run preview (default). ---
  if (!options.execute) {
    const payload: DevRunResult = {
      planId,
      dryRun: true,
      baseBranchValid,
      worktreePathsSafe,
      branchesValid,
      worktrees,
      optionalActions,
    };
    emitResult(ctx, payload as unknown as Record<string, unknown>, () => {
      logger.info(
        `Dry run for ${planId} — no worktrees created, no source modified`,
      );
      process.stdout.write(renderDryRun(plan) + "\n");
      if (!baseBranchValid) {
        process.stderr.write(
          `\n! base branch "${plan.inputs.base_branch}" not found locally; --execute would need it.\n`,
        );
      }
      process.stderr.write(
        `\n  Execute for real with:\n    xforge dev run ${planId} --execute\n`,
      );
    });
    return payload;
  }

  // --- Real execution (--execute). ---
  if (!baseBranchValid) {
    throw new ValidationError(
      `Base branch "${plan.inputs.base_branch}" not found locally; cannot create worktrees.`,
    );
  }
  const { devConfig } = await loadDevModelContext(ctx);
  const runId = makeDevRunId(new Date(), 1);
  const runner = new SpawnCommandRunner({ cwd: projectRoot });

  const run = await orchestrateRun({
    plan,
    config: devConfig,
    runId,
    runner,
    dryRun: false,
    projectRoot,
    // No implementGroup here: the deterministic CLI sets up isolation +
    // integration + review; the Claude agent layer writes code inside the
    // worktrees. A CLI-only --execute produces the scaffold + a delivery
    // package with zero code changes.
    now: () => new Date(),
  });

  const dir = runDir(projectRoot, devConfig.runs_root, runId);
  await writeDeliveryPackage(dir, plan, run);

  const payload: DevRunResult = {
    planId,
    runId,
    dryRun: false,
    baseBranchValid,
    worktreePathsSafe,
    branchesValid,
    status: run.status,
    worktrees,
    optionalActions,
  };
  emitResult(ctx, payload as unknown as Record<string, unknown>, () => {
    logger.success(`Dev run ${runId}: ${run.status}`);
    process.stderr.write(
      `\n  Integration branch: ${run.integration?.integration_branch ?? "(none)"}\n` +
        `  Files changed:      ${run.changes.length}\n` +
        `  Static review:      ${run.static_review?.passed ? "passed" : "findings"}\n` +
        `  Build/test/ui/perf: NOT_REQUESTED (opt-in)\n` +
        `\n  Delivery package: ${dir}\n`,
    );
  });
  return payload;
}

function validateWorktrees(
  projectRoot: string,
  plan: DevPlan,
): Array<{ path: string; branch: string; safe: boolean }> {
  return plan.worktrees.map((w) => {
    const safety = isSafeWorktreePath(
      { projectRoot, worktreeRootRel: ".xforge/worktrees" },
      w.path,
    );
    return {
      path: w.path,
      branch: w.branch,
      safe: safety.safe && isValidDevBranch(w.branch),
    };
  });
}

async function writeDeliveryPackage(
  dir: string,
  plan: DevPlan,
  run: DevRun,
): Promise<void> {
  await mkdir(join(dir, "changes"), { recursive: true });
  await mkdir(join(dir, "reviews"), { recursive: true });
  await mkdir(join(dir, "staged-spec"), { recursive: true });
  const manifest = buildDeliveryManifest(run);
  await writeFile(join(dir, "summary.md"), renderRunSummary(run, plan), "utf8");
  await writeFile(join(dir, "summary.json"), serializeJson(run), "utf8");
  await writeFile(join(dir, "plan.json"), serializeJson(plan), "utf8");
  await writeFile(
    join(dir, "delivery-manifest.json"),
    serializeJson(manifest),
    "utf8",
  );
  await writeFile(
    join(dir, "changes/file-changes.json"),
    serializeJson(run.changes),
    "utf8",
  );
  await writeFile(
    join(dir, "changes/commits.json"),
    serializeJson(run.commits),
    "utf8",
  );
}

async function branchExists(
  projectRoot: string,
  branch: string,
): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--verify", branch], {
      cwd: projectRoot,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
