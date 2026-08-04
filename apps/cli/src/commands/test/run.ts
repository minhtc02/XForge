import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  applyVisualEscalations,
  loadDesignMap,
  runArtifactDir,
  unreachableScreens,
  DryRunCommandRunner,
  SpawnCommandRunner,
  computeCoverage,
  computeRunStats,
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
import { runConformance, readProbeScreens } from "./conformance.js";
import { exportProbeDump, exportScreenshots } from "./artifacts-export.js";
import { runVisualCheck } from "./visual-check.js";

export interface TestRunOptions {
  /** Actually invoke xcodebuild/simctl. Default false (dry run). */
  execute?: boolean;
  /** Accept this run's screenshots as the new visual baselines. */
  updateBaselines?: boolean;
}

export interface TestRunResult {
  runId: string;
  planId: string;
  dryRun: boolean;
  gatePassed: boolean;
  stats: Record<string, number>;
  bugs: number;
  /** Artifacts extracted from the result bundles. */
  artifacts: { probe: boolean; screenshots: number };
  /** Visual regression outcome against the approved baselines. */
  visual: {
    compared: number;
    changed: number;
    missingBaselines: number;
    baselinesWritten: number;
  };
  /** Design conformance outcome, when a comparison was possible. */
  conformance: {
    casesChecked: number;
    failing: number;
    warnings: number;
    skippedReason?: string;
  };
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

  // --- Pre-flight probe ---------------------------------------------------
  // `auto` probes only when static reconciliation left locators it could not
  // resolve; probing when everything already matched buys nothing but time.
  const unresolvedLocators = plan.testability_issues.some(
    (i) => i.kind === "locator-not-statically-resolvable",
  );
  const probeMode = config.execution.probe_before_run;
  const includeProbe =
    !dryRun &&
    (probeMode === "always" || (probeMode === "auto" && unresolvedLocators));

  const probePath = join(
    runArtifactDir(projectRoot, config.output.runs_root, runId, "probe"),
    "xforge-probe.json",
  );

  const runResult = await orchestrateRun({
    plan,
    config,
    runId,
    runner,
    dryRun,
    includeProbe,
    ...(config.project.ui_test_target !== "auto"
      ? { uiTestTarget: config.project.ui_test_target }
      : {}),
    // Extract the probe's attachment before the matrix runs, so an unreachable
    // screen stops the run instead of every case behind it timing out.
    runProbe: async (resultBundlePath) => {
      const exported = await exportProbeDump(
        runner,
        resultBundlePath,
        probePath,
      );
      if (!exported) return { unreachable: [] };
      return { unreachable: unreachableScreens(exported.screens) };
    },
  });

  // Screenshots live beside the case that produced them, for the visual report.
  const screensDir = runArtifactDir(
    projectRoot,
    config.output.runs_root,
    runId,
    "screens",
  );
  const screenshots: string[] = [];
  if (!dryRun) {
    for (const shard of plan.shards) {
      screenshots.push(
        ...(await exportScreenshots(
          runner,
          `${config.output.runs_root}/${runId}/xcresult/${shard.id}.xcresult`,
          screensDir,
          shard.id,
        )),
      );
    }
  }

  // --- Design conformance (blueprint §12) --------------------------------
  // Compares what the probe measured against the frozen Figma references, then
  // applies the project's severity policy: a missing element fails the case, a
  // size or token delta is reported. Degrades to "nothing to compare" whenever
  // a piece is absent — losing design data must not turn a run red.
  const probeScreens = await readProbeScreens(probePath);
  const conformance = await runConformance({
    projectRoot,
    plan,
    config,
    ...(probeScreens ? { probeScreens } : {}),
    designMap: config.figma.enabled
      ? await loadDesignMap(projectRoot, config.figma.design_map)
      : null,
  });

  // --- Visual regression (blueprint §12) ---------------------------------
  // Complements conformance: that asks "does it match the design?", this asks
  // "did it change since we approved it?". A screenshot with no baseline is
  // reported, never auto-approved — blessing the current look would bless the
  // bugs already in it.
  const visual = await runVisualCheck({
    projectRoot,
    plan,
    config,
    runId,
    screenshots,
    ...(options.updateBaselines ? { updateBaselines: true } : {}),
  });

  const escalated = applyVisualEscalations(runResult.executions, [
    ...conformance.escalations,
    ...visual.escalations,
  ]);
  runResult.executions = escalated.executions;
  const recomputed = computeRunStats(runResult.executions);
  runResult.gate_passed = recomputed.gate_passed;
  const { gate_passed: _gate, ...stats } = recomputed;
  runResult.stats = stats;

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
  await write(
    "summaryMarkdown",
    [
      renderRunSummaryMarkdown(runResult, bugs),
      conformance.markdown,
      visual.markdown,
    ]
      .filter((part) => part.length > 0)
      .join("\n"),
  );
  await write("coverageMarkdown", renderCoverageMarkdown(coverage));

  const result: TestRunResult = {
    runId,
    planId,
    dryRun,
    gatePassed: runResult.gate_passed,
    stats: runResult.stats as unknown as Record<string, number>,
    bugs: bugs.length,
    artifacts: {
      probe: probeScreens !== undefined,
      screenshots: screenshots.length,
    },
    visual: {
      compared: visual.comparisons.length,
      changed: visual.comparisons.filter((c) => c.verdict !== "PASS").length,
      missingBaselines: visual.missingBaselines.length,
      baselinesWritten: visual.baselinesWritten.length,
    },
    conformance: {
      casesChecked: conformance.byCase.length,
      failing: conformance.byCase.filter((c) => c.verdict.failing.length > 0)
        .length,
      warnings: conformance.byCase.reduce(
        (n, c) => n + c.verdict.warnings.length,
        0,
      ),
      ...(conformance.skippedReason
        ? { skippedReason: conformance.skippedReason }
        : {}),
    },
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

    if (!dryRun) {
      process.stderr.write(
        `\n  Artifacts: probe ${result.artifacts.probe ? "captured" : "not captured"}` +
          `, ${result.artifacts.screenshots} screenshot(s)\n`,
      );
      const v = result.visual;
      if (v.baselinesWritten > 0) {
        process.stderr.write(
          `  Baselines: accepted ${v.baselinesWritten} screenshot(s)\n`,
        );
      } else if (v.compared > 0) {
        process.stderr.write(
          `  Visual:    ${v.compared} compared` +
            `${v.changed > 0 ? `, ${v.changed} changed` : ""}` +
            `${v.missingBaselines > 0 ? `, ${v.missingBaselines} without a baseline` : ""}\n`,
        );
      }
      const c = result.conformance;
      if (c.skippedReason) {
        process.stderr.write(`  Design:    skipped — ${c.skippedReason}\n`);
      } else {
        process.stderr.write(
          `  Design:    ${c.casesChecked} case(s) checked` +
            `${c.failing > 0 ? `, ${c.failing} FAILING` : ""}` +
            `${c.warnings > 0 ? `, ${c.warnings} warning(s)` : ""}\n`,
        );
      }
    }

    process.stderr.write("\n  Next:\n");
    if (dryRun) {
      process.stderr.write(
        "    This was a dry run — no simulators executed.\n" +
          `    xforge test run ${planId} --execute   # run for real\n`,
      );
    } else {
      process.stderr.write(
        `    xforge test report   # summary${bugs.length > 0 ? ` + ${bugs.length} bug(s)` : ""}\n` +
          (runResult.gate_passed
            ? ""
            : "    xforge test status   # per-case detail\n"),
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
