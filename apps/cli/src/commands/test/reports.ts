import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  loadTestConfig,
  parseRunResult,
  runFilePath,
  testRoot,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

/**
 * `xforge test status | report | bugs | clean` (blueprint §5.5, §6.1). These
 * read the artifacts written by `run`; they never execute simulators.
 */

async function latestRunId(
  projectRoot: string,
  runsRoot: string,
  runId?: string,
): Promise<string> {
  if (runId && runId !== "--latest") return runId;
  try {
    const dirs = (await readdir(join(projectRoot, runsRoot)))
      .filter((n) => n.startsWith("XFRUN-"))
      .sort();
    const last = dirs[dirs.length - 1];
    if (!last) throw new Error("none");
    return last;
  } catch {
    throw new NotFoundError(
      "No runs found. Run `xforge test run <plan-id>` first.",
    );
  }
}

async function loadRun(
  ctx: CliContext,
  runId: string | undefined,
): Promise<{ runId: string; runsRoot: string; summaryJsonPath: string }> {
  const config = await loadTestConfig(ctx.projectRoot);
  const resolved = await latestRunId(
    ctx.projectRoot,
    config.output.runs_root,
    runId,
  );
  const summaryJsonPath = runFilePath(
    ctx.projectRoot,
    config.output.runs_root,
    resolved,
    "summaryJson",
  );
  if (!existsSync(summaryJsonPath)) {
    throw new NotFoundError(`Run ${resolved} not found`, {
      details: { summaryJsonPath },
    });
  }
  return {
    runId: resolved,
    runsRoot: config.output.runs_root,
    summaryJsonPath,
  };
}

export async function runTestStatus(
  ctx: CliContext,
  runId?: string,
): Promise<Record<string, unknown>> {
  const { summaryJsonPath, runId: resolved } = await loadRun(ctx, runId);
  const run = parseRunResult(
    JSON.parse(await readFile(summaryJsonPath, "utf8")),
  );
  const payload = {
    runId: resolved,
    planId: run.plan_id,
    dryRun: run.dry_run,
    gatePassed: run.gate_passed,
    stats: run.stats,
  };
  emitResult(ctx, payload, () => {
    ctx.logger.info(
      `Run ${resolved}: gate ${run.gate_passed ? "PASSED" : "FAILED"} (${run.stats.passed}/${run.stats.total} passed)`,
    );
  });
  return payload;
}

export async function runTestReport(
  ctx: CliContext,
  runId?: string,
): Promise<Record<string, unknown>> {
  const {
    summaryJsonPath,
    runId: resolved,
    runsRoot,
  } = await loadRun(ctx, runId);
  const mdPath = runFilePath(
    ctx.projectRoot,
    runsRoot,
    resolved,
    "summaryMarkdown",
  );
  const run = parseRunResult(
    JSON.parse(await readFile(summaryJsonPath, "utf8")),
  );
  const markdown = existsSync(mdPath) ? await readFile(mdPath, "utf8") : "";

  // Bugs belong in the report: asking for them separately made it easy to read
  // a green-looking summary and miss the triaged failures underneath.
  const bugsPath = runFilePath(ctx.projectRoot, runsRoot, resolved, "bugsJson");
  const bugs: Array<Record<string, unknown>> = existsSync(bugsPath)
    ? ((JSON.parse(await readFile(bugsPath, "utf8")).bugs ?? []) as Array<
        Record<string, unknown>
      >)
    : [];

  const payload = {
    runId: resolved,
    stats: run.stats,
    gatePassed: run.gate_passed,
    bugs,
  };
  emitResult(ctx, payload, () => {
    process.stdout.write(markdown + "\n");
    if (bugs.length > 0) {
      process.stdout.write(`\n## Bugs (${bugs.length})\n\n`);
      for (const bug of bugs) {
        process.stdout.write(
          `- **${String(bug.id)}** [${String(bug.severity)}] ${String(bug.title)}\n` +
            `  feature: ${String(bug.feature)} · cases: ${(bug.impacted_cases as string[] | undefined)?.length ?? 0}\n`,
        );
      }
    }
    process.stderr.write(
      bugs.length > 0
        ? `\n  Next: fix the bugs above, then \`xforge test plan\` to re-verify.\n`
        : run.gate_passed
          ? "\n  Next: gate passed — nothing to do.\n"
          : "\n  Next: `xforge test status` for per-case detail.\n",
    );
  });
  return payload;
}

export async function runTestBugs(
  ctx: CliContext,
  runId?: string,
): Promise<Record<string, unknown>> {
  const { runId: resolved, runsRoot } = await loadRun(ctx, runId);
  const bugsPath = runFilePath(ctx.projectRoot, runsRoot, resolved, "bugsJson");
  const bugs = existsSync(bugsPath)
    ? (JSON.parse(await readFile(bugsPath, "utf8")).bugs ?? [])
    : [];
  const payload = { runId: resolved, bugs };
  emitResult(ctx, payload, () => {
    if (bugs.length === 0) {
      ctx.logger.info(`Run ${resolved}: no product bugs.`);
      return;
    }
    process.stderr.write(`\nRun ${resolved} — ${bugs.length} bug(s):\n`);
    for (const b of bugs as Array<Record<string, string>>) {
      process.stderr.write(
        `  ${b.id} [${b.severity}/${b.priority}] ${b.title}\n`,
      );
    }
  });
  return payload;
}

export async function runTestClean(
  ctx: CliContext,
  target?: string,
): Promise<Record<string, unknown>> {
  const config = await loadTestConfig(ctx.projectRoot);
  const removed: string[] = [];
  // Only ever remove inside XForge-managed directories (blueprint §29).
  const candidates: string[] = [];
  if (!target || target === "runs") {
    candidates.push(join(ctx.projectRoot, config.output.runs_root));
  }
  if (!target || target === "cache") {
    candidates.push(join(testRoot(ctx.projectRoot), "cache"));
  }
  if (target && !["runs", "cache"].includes(target)) {
    throw new ValidationError(
      `Unknown clean target "${target}". Use: runs | cache (default: both).`,
    );
  }
  for (const dir of candidates) {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  const payload = { removed };
  emitResult(ctx, payload, () => {
    ctx.logger.success(
      removed.length > 0
        ? `Cleaned ${removed.length} director(ies).`
        : "Nothing to clean.",
    );
  });
  return payload;
}
