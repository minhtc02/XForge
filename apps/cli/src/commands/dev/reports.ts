import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { NotFoundError } from "@xforge/shared";
import {
  loadDevConfig,
  parseDevRun,
  runDir,
  runsDir,
  worktreeRoot,
  type DevRun,
} from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";

/**
 * Read-only dev run reports (blueprint §6, §21) plus cleanup. `status`/`report`
 * default to the latest run; `review` prints the static review; `clean` removes
 * XForge-managed run artifacts or worktrees only (never the main checkout).
 */

async function latestRunId(
  projectRoot: string,
  runsRoot: string,
): Promise<string | undefined> {
  const dir = runsDir(projectRoot, runsRoot);
  if (!existsSync(dir)) return undefined;
  const entries = (await readdir(dir)).filter((n) => n.startsWith("XFDEVRUN-"));
  entries.sort();
  return entries.at(-1);
}

async function loadRun(
  projectRoot: string,
  runsRoot: string,
  runId: string,
): Promise<DevRun> {
  const path = join(runDir(projectRoot, runsRoot, runId), "summary.json");
  if (!existsSync(path)) {
    throw new NotFoundError(`Run ${runId} not found`, { details: { path } });
  }
  return parseDevRun(JSON.parse(await readFile(path, "utf8")));
}

async function resolveRun(
  ctx: CliContext,
  runId: string | undefined,
): Promise<{ run: DevRun; runsRoot: string }> {
  const config = await loadDevConfig(ctx.projectRoot);
  const id = runId ?? (await latestRunId(ctx.projectRoot, config.runs_root));
  if (!id)
    throw new NotFoundError(
      "No dev runs found. Run `xforge dev run <plan-id> --execute` first.",
    );
  return {
    run: await loadRun(ctx.projectRoot, config.runs_root, id),
    runsRoot: config.runs_root,
  };
}

export async function runDevStatus(
  ctx: CliContext,
  runId?: string,
): Promise<DevRun> {
  const { run } = await resolveRun(ctx, runId);
  emitResult(ctx, run as unknown as Record<string, unknown>, () => {
    ctx.logger.info(`Dev run ${run.run_id}`);
    process.stderr.write(
      `\n  Status:        ${run.status}\n` +
        `  Files changed: ${run.changes.length}\n` +
        `  Commits:       ${run.commits.length}\n` +
        `  Integration:   ${run.integration?.integration_branch ?? "(none)"}\n` +
        `  Build/test/ui/perf: ${run.optional_results.build}/${run.optional_results.test}/${run.optional_results.ui}/${run.optional_results.performance}\n` +
        `  Docs sync:     ${run.docs_sync}\n`,
    );
  });
  return run;
}

export async function runDevReport(
  ctx: CliContext,
  runId?: string,
): Promise<DevRun> {
  const { run, runsRoot } = await resolveRun(ctx, runId);
  const summaryPath = join(
    runDir(ctx.projectRoot, runsRoot, run.run_id),
    "summary.md",
  );
  const summaryMd = existsSync(summaryPath)
    ? await readFile(summaryPath, "utf8")
    : `Run ${run.run_id}: ${run.status}`;
  emitResult(ctx, run as unknown as Record<string, unknown>, () => {
    process.stdout.write(summaryMd + "\n");
  });
  return run;
}

export async function runDevReview(
  ctx: CliContext,
  runId?: string,
): Promise<DevRun> {
  const { run } = await resolveRun(ctx, runId);
  emitResult(ctx, run as unknown as Record<string, unknown>, () => {
    const review = run.static_review;
    process.stdout.write(`# Static review — ${run.run_id}\n\n`);
    process.stdout.write(`Passed: ${review?.passed ? "Yes" : "No"}\n\n`);
    if (review && review.findings.length > 0) {
      for (const f of review.findings) {
        process.stdout.write(
          `- [${f.severity}] ${f.category}${f.file ? ` (${f.file})` : ""}: ${f.message}\n`,
        );
      }
    } else {
      process.stdout.write("No findings.\n");
    }
  });
  return run;
}

export interface DevCleanResult {
  target: "runs" | "worktrees";
  removed: string[];
}

/**
 * `xforge dev clean [runs|worktrees]`. Only ever removes XForge-managed
 * directories (`.xforge/dev/runs` or the worktree root's children). The main
 * checkout is never touched.
 */
export async function runDevClean(
  ctx: CliContext,
  target: "runs" | "worktrees",
): Promise<DevCleanResult> {
  const config = await loadDevConfig(ctx.projectRoot);
  const removed: string[] = [];
  if (target === "runs") {
    const dir = runsDir(ctx.projectRoot, config.runs_root);
    if (existsSync(dir)) {
      for (const entry of await readdir(dir)) {
        if (!entry.startsWith("XFDEVRUN-")) continue;
        await rm(join(dir, entry), { recursive: true, force: true });
        removed.push(entry);
      }
    }
  } else {
    const dir = worktreeRoot(ctx.projectRoot);
    if (existsSync(dir)) {
      for (const entry of await readdir(dir)) {
        await rm(join(dir, entry), { recursive: true, force: true });
        removed.push(entry);
      }
    }
    // Prune git's stale worktree registry so `git worktree list` is accurate.
    try {
      await promisify(execFile)("git", ["worktree", "prune"], {
        cwd: ctx.projectRoot,
        timeout: 5000,
      });
    } catch {
      // Not a git repo or git unavailable — the directories are still removed.
    }
  }
  const result: DevCleanResult = { target, removed };
  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    ctx.logger.success(`Cleaned ${removed.length} ${target} artifact(s).`);
  });
  return result;
}
