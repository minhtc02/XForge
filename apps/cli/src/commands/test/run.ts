import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  DryRunCommandRunner,
  SpawnCommandRunner,
  computeCoverage,
  loadTestConfig,
  makeRunId,
  orchestrateRun,
  parseApprovalManifest,
  parseTestPlan,
  planFilePath,
  renderCoverageMarkdown,
  renderRunSummaryMarkdown,
  runFilePath,
  serializeJson,
  triageBugs,
  verifyApproval,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

export interface TestRunOptions {
  /** Actually invoke xcodebuild/simctl. Default false (dry run). */
  execute?: boolean;
}

export interface TestRunResult {
  runId: string;
  planId: string;
  dryRun: boolean;
  gatePassed: boolean;
  stats: Record<string, number>;
  bugs: number;
  writtenFiles: string[];
}

/**
 * `xforge test run <plan-id>` (blueprint §5.4, §15, §17, master prompt §8).
 *
 * Verifies a valid, current approval, then orchestrates the run. By default it
 * runs in DRY mode (records the exact build/test command plan without invoking
 * Xcode) so it is safe and deterministic everywhere; `--execute` opts into real
 * xcodebuild/simctl. After a valid approval there are NO interactive prompts
 * (§19.3). Individual failures never stop the pipeline (§4.1).
 */
export async function runTestRun(
  ctx: CliContext,
  planId: string,
  options: TestRunOptions = {},
): Promise<TestRunResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge test run <plan-id>",
    );
  }

  const planPath = planFilePath(projectRoot, planId, "plan");
  if (!existsSync(planPath)) {
    throw new NotFoundError(`Plan ${planId} not found`, {
      details: { planPath },
    });
  }
  const plan = parseTestPlan(JSON.parse(await readFile(planPath, "utf8")));

  const approvalPath = planFilePath(projectRoot, planId, "approval");
  if (!existsSync(approvalPath)) {
    throw new ValidationError(
      `Plan ${planId} is not approved. Run \`xforge test approve ${planId}\` first.`,
    );
  }
  const approval = parseApprovalManifest(
    JSON.parse(await readFile(approvalPath, "utf8")),
  );
  const check = verifyApproval(plan, approval);
  if (!check.valid) {
    throw new ValidationError(
      `Plan ${planId} approval is invalid (${check.reason}); re-plan and re-approve.`,
      { details: { reason: check.reason } },
    );
  }

  const config = await loadTestConfig(projectRoot);
  const runId = await nextRunId(projectRoot, config.output.runs_root);
  const dryRun = !options.execute;
  const runner = dryRun
    ? new DryRunCommandRunner()
    : new SpawnCommandRunner({ cwd: projectRoot });

  logger.info(dryRun ? "Starting dry run" : "Starting run", { runId, planId });

  const runResult = await orchestrateRun({
    plan,
    config,
    runId,
    runner,
    dryRun,
    // Real xcresult collection is wired in when --execute matures; for now a
    // successful shard with no collector yields no executions (dry path used).
  });

  const bugs = triageBugs({
    executions: runResult.executions,
    cases: plan.test_cases,
  });
  const coverage = computeCoverage(plan, runResult.executions);

  const writtenFiles: string[] = [];
  const write = async (
    file: Parameters<typeof runFilePath>[3],
    content: string,
  ): Promise<void> => {
    const abs = runFilePath(projectRoot, config.output.runs_root, runId, file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    writtenFiles.push(abs);
  };

  await write("summaryJson", serializeJson(runResult));
  await write(
    "testResults",
    serializeJson({ executions: runResult.executions }),
  );
  await write("bugsJson", serializeJson({ bugs }));
  await write("summaryMarkdown", renderRunSummaryMarkdown(runResult, bugs));
  await write("coverageMarkdown", renderCoverageMarkdown(coverage));

  const result: TestRunResult = {
    runId,
    planId,
    dryRun,
    gatePassed: runResult.gate_passed,
    stats: runResult.stats as unknown as Record<string, number>,
    bugs: bugs.length,
    writtenFiles,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(
      `Run ${runId} complete${dryRun ? " (dry run)" : ""} — gate ${runResult.gate_passed ? "PASSED" : "FAILED"}`,
    );
    const s = runResult.stats;
    process.stderr.write(
      `\n  Passed:  ${s.passed}\n  Failed:  ${s.failed}\n  Blocked: ${s.blocked}\n` +
        `  Infra:   ${s.infrastructure}\n  Skipped: ${s.skipped}\n  Bugs:    ${bugs.length}\n` +
        `\n  Summary: ${runFilePath(projectRoot, config.output.runs_root, runId, "summaryMarkdown")}\n`,
    );
    if (dryRun) {
      process.stderr.write(
        "\n  This was a dry run (no simulators executed). Re-run with --execute\n" +
          "  on a Mac with Xcode + a UI-testable app to run for real.\n",
      );
    }
  });
  return result;
}

async function nextRunId(
  projectRoot: string,
  runsRoot: string,
): Promise<string> {
  const now = new Date();
  const prefix = makeRunId(now, 1).slice(0, "XFRUN-YYYYMMDD".length);
  let seq = 1;
  try {
    const existing = await readdir(`${projectRoot}/${runsRoot}`);
    seq = existing.filter((n) => n.startsWith(prefix)).length + 1;
  } catch {
    seq = 1;
  }
  return makeRunId(now, seq);
}
