import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { ValidationError } from "@xforge/shared";
import { hashContent, statePath } from "@xforge/core";
import {
  buildTestPlan,
  designNodesForFeature,
  ensureTestDirs,
  loadDesignMap,
  makePlanId,
  navigationGraphPath,
  planDir,
  plansDir,
  planFilePath,
  renderPermissionsDoc,
  renderPlanMarkdown,
  renderTestabilityReport,
  serializeJson,
  type RunLevel,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";
import {
  inventoryExistingTests,
  loadTestModelContext,
  probeEnvironment,
} from "./shared.js";
import { resolveNavigationGraph, runTestNavigation } from "./navigation.js";
import { runTestDoctor } from "./doctor.js";
import { runTestGenerate } from "./generate.js";
import { runTestApprove } from "./approve.js";
import { integrateWithXcode } from "./xcode-integrate.js";
import { canPrompt, selectOne } from "../../prompt.js";

export interface TestPlanOptions {
  feature?: string;
  level?: string;
  /** Run the environment preflight first. Default true. */
  doctor?: boolean;
  /** Scaffold navigation.yaml when the project has none. Default true. */
  navigation?: boolean;
  /** Generate XCUITest sources once the plan is written. Default true. */
  generate?: boolean;
  /** Also emit the accessibility probe class when generating. */
  probe?: boolean;
  /** Overwrite existing generated sources. */
  force?: boolean;
  /** Approve the plan as soon as it is written. Default true. */
  approve?: boolean;
  /** Copy generated sources into the Xcode targets. Default true. */
  xcode?: boolean;
}

export interface TestPlanResult {
  planId: string;
  planDir: string;
  writtenFiles: string[];
  stats: {
    total_cases: number;
    suites: number;
    shards: number;
    testability_issues: number;
  };
  /** Static locator reconciliation summary (§13). */
  reconcile: {
    checked: number;
    matched: number;
    missing: number;
    unresolvable: number;
    skipped: boolean;
  };
  /** Features no confident navigation path reaches (no cases generated). */
  unreachableFeatures: string[];
  /** State buckets folded back because the per-feature cap was exceeded. */
  mergedBuckets: string[];
  /** Preflight outcome, when the doctor step ran. */
  preflight?: { ok: boolean; warnings: string[] };
  /** Set when this run scaffolded a navigation graph. */
  navigationScaffolded?: string;
  /** Generation outcome, when the generate step ran. */
  generated?: {
    outputDir: string;
    cases: number;
    assertions: number;
    unverifiedExpectations: number;
  };
  /** Why generation was skipped, when it was attempted but could not run. */
  generateSkippedReason?: string;
  /** How the sources were wired into Xcode, when that step ran. */
  xcodeIntegration?: {
    method: string;
    copied: string[];
    added: Array<{ file: string; target: string }>;
    warnings: string[];
    backup?: string;
  };
  approved: boolean;
  /**
   * Screens the plan targets that nothing else in the app refers to. Approval
   * is withheld while this is non-empty: the cases may be testing dead code,
   * and only a source investigation can tell.
   */
  unreferencedScreens: string[];
  /** Hash the approval is bound to, when this run approved the plan. */
  planHash?: string;
}

const VALID_LEVELS: RunLevel[] = ["smoke", "critical", "regression", "full"];

/**
 * `xforge test plan` (blueprint §5.2, §31 Phase 1, master prompt §4).
 * Deterministically builds a test plan from the Canonical Project Model + test
 * config, writes the immutable plan artifacts, and records input hashes. It
 * never runs tests.
 */
export async function runTestPlan(
  ctx: CliContext,
  options: TestPlanOptions,
): Promise<TestPlanResult> {
  const { projectRoot, logger } = ctx;
  const level = normalizeLevel(options.level);
  let featureFilter = options.feature
    ? options.feature
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  // --- Preflight (§4.1: never discover a blocker mid-run) ---------------
  // Planning is cheap; a broken environment is not. Run the doctor's checks
  // first so a missing model or config fails here rather than three commands
  // later. Only hard failures stop us — missing Xcode is a warning off a Mac.
  let preflight: TestPlanResult["preflight"];
  if (options.doctor !== false) {
    const doctor = await runTestDoctor(ctx, { silent: true });
    const failures = doctor.checks.filter((c) => c.status === "fail");
    preflight = {
      ok: doctor.ok,
      warnings: doctor.checks
        .filter((c) => c.status === "warn")
        .map((c) => `${c.name}: ${c.detail}`),
    };
    if (failures.length > 0) {
      throw new ValidationError(
        `Environment is not ready for planning:\n${failures
          .map((c) => `  ✗ ${c.name} — ${c.detail}`)
          .join("\n")}\nRun \`xforge test doctor\` for the full report.`,
        { details: { failures } },
      );
    }
  }

  const { model, testConfig } = await loadTestModelContext(ctx);

  // --- Feature selection -------------------------------------------------
  // Only ever prompt at a terminal with no explicit `--feature`: a prompt in CI
  // hangs the build, and one under `--json` corrupts the output.
  if (
    featureFilter.length === 0 &&
    canPrompt(ctx) &&
    model.features.length > 0
  ) {
    featureFilter = await pickFeatures(model.features);
  }

  // --- Navigation graph -------------------------------------------------
  // Scaffold one when the project has none, so BFS has something authored to
  // work from. Reported loudly: every scaffolded edge is `derived` (0.6) and
  // needs review before it can be trusted.
  let navigationScaffolded: string | undefined;
  if (
    options.navigation !== false &&
    testConfig.navigation.enabled &&
    !existsSync(navigationGraphPath(projectRoot, testConfig.navigation.graph))
  ) {
    const nav = await runTestNavigation(ctx, { init: true, silent: true });
    navigationScaffolded = nav.graphPath;
  }
  const env = await probeEnvironment(projectRoot);
  const existingTestCount = await inventoryExistingTests(
    projectRoot,
    testConfig.sources.tests,
  );

  // Figma frame count (from design map, file-backed — no live MCP in Phase 1).
  let figmaFrameCount = 0;
  let designMapHash: string | undefined;
  if (testConfig.figma.enabled) {
    const designMap = await loadDesignMap(
      projectRoot,
      testConfig.figma.design_map,
    );
    if (designMap) {
      const targetFeatures =
        featureFilter.length > 0
          ? featureFilter
          : model.features.map((f) => f.id);
      figmaFrameCount = targetFeatures.reduce(
        (n, f) => n + designNodesForFeature(designMap, f).length,
        0,
      );
      designMapHash = hashContent(JSON.stringify(designMap));
    }
  }

  // Immutable input provenance (blueprint §5.3).
  const modelStatePath = statePath(projectRoot, "projectModel");
  const projectModelHash = existsSync(modelStatePath)
    ? hashContent(await readFile(modelStatePath, "utf8"))
    : undefined;

  // Navigation graph: model-derived, overlaid with the authored file when one
  // exists. Hashed into the plan inputs so an approval cannot outlive it.
  const navigation = await resolveNavigationGraph(
    projectRoot,
    testConfig.navigation.graph,
    model,
  );
  const navigationGraphHash = navigation.raw
    ? hashContent(navigation.raw)
    : undefined;

  const planId = await nextPlanId(projectRoot);
  const { plan, reconcile, unreachableFeatures, mergedBuckets } = buildTestPlan(
    {
      ...(testConfig.navigation.enabled
        ? { navigation: navigation.graph }
        : {}),
      planId,
      model,
      config: testConfig,
      level,
      featureFilter,
      inputs: {
        config_version: 1,
        project_model_hash: projectModelHash,
        design_map_hash: designMapHash,
        navigation_graph_hash: navigationGraphHash,
      },
      environment: {
        hasUiTestTarget: env.hasUiTestTarget,
        hasAccessibilityIdentifiers: env.hasAccessibilityIdentifiers,
        figmaFrameCount,
        existingTestCount,
      },
    },
  );

  if (plan.test_cases.length === 0) {
    throw new ValidationError(
      featureFilter.length > 0
        ? `No features matched filter [${featureFilter.join(", ")}]. Known features: ${model.features.map((f) => f.id).join(", ") || "(none)"}.`
        : "No features detected in the Project Model; run `xforge docs` first.",
    );
  }

  const missingLocators = reconcile.deviations.filter(
    (d) => d.kind === "missing",
  );
  const unresolvableLocators = reconcile.deviations.filter(
    (d) => d.kind === "unresolvable",
  );

  // Refuse to emit a plan whose locators provably do not exist, when the
  // project asked for that (§13). Off by default so an upgrade never blocks.
  if (testConfig.planning.fail_on_deviation && missingLocators.length > 0) {
    const locators = [...new Set(missingLocators.map((d) => d.locator))].sort();
    throw new ValidationError(
      `DEVIATION: ${locators.length} locator(s) are not declared in source: ${locators.join(", ")}. ` +
        "Add the missing accessibilityIdentifier values, or set planning.fail_on_deviation: false to plan anyway.",
      { details: { locators, cases: missingLocators.map((d) => d.case_id) } },
    );
  }

  await ensureTestDirs(projectRoot);
  await mkdir(planDir(projectRoot, planId), { recursive: true });

  const writtenFiles: string[] = [];
  const write = async (
    file: Parameters<typeof planFilePath>[2],
    content: string,
  ): Promise<void> => {
    const abs = planFilePath(projectRoot, planId, file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    writtenFiles.push(abs);
  };

  await write("plan", serializeJson(plan));
  await write("testCases", serializeJson({ test_cases: plan.test_cases }));
  await write("planMarkdown", renderPlanMarkdown(plan));
  await write("permissions", renderPermissionsDoc(plan));
  await write("testabilityReport", renderTestabilityReport(plan));

  // --- Generate XCUITest sources ---------------------------------------
  // Writing Swift is not running tests, so this stays within what `test plan`
  // promises. A generation failure (e.g. every case blocked) must not discard
  // the plan we just wrote — it is reported instead.
  let generated: TestPlanResult["generated"];
  let generateSkippedReason: string | undefined;
  if (options.generate !== false) {
    try {
      const result = await runTestGenerate(ctx, planId, {
        silent: true,
        ...(options.probe ? { probe: true } : {}),
        ...(options.force ? { force: true } : {}),
      });
      generated = {
        outputDir: result.outputDir,
        cases: result.cases,
        assertions: result.assertions,
        unverifiedExpectations: result.unverifiedExpectations,
      };
    } catch (error) {
      generateSkippedReason =
        error instanceof Error ? error.message : String(error);
    }
  }

  // --- Put the sources where Xcode will build them ----------------------
  // Prefer copying into a folder-backed target; fall back to editing the
  // project with a backup and a structural check. Any doubt and it declines,
  // because an unopenable project is a far worse outcome than a manual step.
  let xcodeIntegration: TestPlanResult["xcodeIntegration"];
  if (generated && options.xcode !== false) {
    const integration = await integrateWithXcode({
      projectRoot,
      planId,
      ...(testConfig.project.project !== "auto"
        ? { xcodeProject: testConfig.project.project }
        : {}),
      ...(testConfig.project.ui_test_target !== "auto"
        ? { uiTestTarget: testConfig.project.ui_test_target }
        : {}),
      ...(testConfig.project.scheme !== "auto"
        ? { appTarget: testConfig.project.scheme }
        : {}),
    });
    xcodeIntegration = {
      method: integration.method,
      copied: integration.copied,
      added: integration.added,
      warnings: integration.warnings,
      ...(integration.backup ? { backup: integration.backup } : {}),
    };
  }

  // --- Approval ----------------------------------------------------------
  // Folded in so the common path is one command. The hash binding is kept, so
  // a plan that later drifts still cannot run; what is skipped is the pause,
  // not the guarantee. `--no-approve` restores the explicit gate.
  //
  // Except when the plan targets a screen nothing refers to. Then the pause is
  // the whole point: auto-approving would rubber-stamp a plan that may be
  // testing dead code, and the resulting green run would be evidence of
  // nothing. Approval is withheld and the user is pointed at `test review`,
  // which is where that question actually gets answered.
  const orphanIssues = plan.testability_issues.filter(
    (i) => i.kind === "screen-not-referenced",
  );
  const unreferencedScreenNames = [
    ...new Set(orphanIssues.flatMap((i) => i.subjects)),
  ].sort();
  const needsReview = orphanIssues.length > 0;
  let approved = false;
  let planHash: string | undefined;
  if (options.approve !== false && !needsReview) {
    const approval = await runTestApprove(ctx, planId, { silent: true });
    approved = approval.approved;
    planHash = approval.planHash;
  }

  const result: TestPlanResult = {
    planId,
    planDir: planDir(projectRoot, planId),
    writtenFiles,
    stats: {
      total_cases: plan.stats.total_cases,
      suites: plan.stats.suites,
      shards: plan.stats.shards,
      testability_issues: plan.testability_issues.length,
    },
    reconcile: {
      checked: reconcile.checked,
      matched: reconcile.matched,
      missing: missingLocators.length,
      unresolvable: unresolvableLocators.length,
      skipped: reconcile.skipped,
    },
    unreachableFeatures,
    mergedBuckets,
    ...(preflight ? { preflight } : {}),
    ...(navigationScaffolded ? { navigationScaffolded } : {}),
    ...(generated ? { generated } : {}),
    ...(generateSkippedReason ? { generateSkippedReason } : {}),
    ...(xcodeIntegration ? { xcodeIntegration } : {}),
    approved,
    unreferencedScreens: unreferencedScreenNames,
    ...(planHash ? { planHash } : {}),
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(`Test plan created: ${planId}`);
    if (result.navigationScaffolded) {
      process.stderr.write(
        `\n  Scaffolded navigation graph: ${relative(projectRoot, result.navigationScaffolded)}\n` +
          "    Every edge starts at provenance `derived` (0.6). Review it and\n" +
          "    raise confirmed ones to `explicit` before trusting the paths.\n",
      );
    }
    process.stderr.write(
      `\n  Cases:              ${result.stats.total_cases}\n` +
        `  Suites:             ${result.stats.suites}\n` +
        `  Simulator shards:   ${result.stats.shards}\n` +
        `  Testability issues: ${result.stats.testability_issues}\n`,
    );
    if (result.reconcile.skipped) {
      process.stderr.write(
        "  Locators:           not checked (no accessibility identifiers in the model)\n",
      );
    } else {
      process.stderr.write(
        `  Locators:           ${result.reconcile.matched}/${result.reconcile.checked} matched` +
          `${result.reconcile.missing > 0 ? `, ${result.reconcile.missing} MISSING` : ""}` +
          `${result.reconcile.unresolvable > 0 ? `, ${result.reconcile.unresolvable} unresolvable` : ""}\n`,
      );
    }
    if (result.unreachableFeatures.length > 0) {
      process.stderr.write(
        `  Unreachable:        ${result.unreachableFeatures.join(", ")}` +
          " (no cases generated — see `xforge test navigation`)\n",
      );
    }
    if (result.mergedBuckets.length > 0) {
      process.stderr.write(
        `  Merged buckets:     ${result.mergedBuckets.length}` +
          " (state.max_buckets_per_feature exceeded)\n",
      );
    }
    if (result.generated) {
      process.stderr.write(
        `\n  Generated:          ${result.generated.cases} case(s), ` +
          `${result.generated.assertions} assertion(s)` +
          `${result.generated.unverifiedExpectations > 0 ? `, ${result.generated.unverifiedExpectations} unverified` : ""}\n` +
          `                      ${relative(projectRoot, result.generated.outputDir)}/\n`,
      );
    } else if (result.generateSkippedReason) {
      process.stderr.write(
        `\n! Sources not generated: ${result.generateSkippedReason}\n` +
          "  The plan itself was written — fix the issue and run\n" +
          `  \`xforge test generate ${planId}\`.\n`,
      );
    }

    const xc = result.xcodeIntegration;
    if (xc && (xc.copied.length > 0 || xc.added.length > 0)) {
      const how =
        xc.method === "synchronized-folder"
          ? "copied into folder-backed target(s)"
          : "added to project.pbxproj";
      process.stderr.write(`\n  Xcode:              ${how}\n`);
      for (const file of xc.copied) {
        process.stderr.write(`                      ${file}\n`);
      }
      for (const { file, target } of xc.added) {
        process.stderr.write(`                      ${file} → ${target}\n`);
      }
      if (xc.backup) {
        process.stderr.write(`                      backup: ${xc.backup}\n`);
      }
    }
    for (const warning of xc?.warnings ?? []) {
      process.stderr.write(`  ! ${warning}\n`);
    }

    if (result.approved) {
      process.stderr.write(
        `\n  Approved:           ${result.planHash?.slice(0, 23)}…\n`,
      );
    } else if (result.unreferencedScreens.length > 0) {
      process.stderr.write(
        `\n  NOT approved — nothing in the app refers to: ${result.unreferencedScreens.join(", ")}.\n` +
          "  If those screens are dead code, these cases test something the user\n" +
          "  cannot reach, and a green run would prove nothing. Settle it first:\n" +
          `    /xforge:test-review ${planId}   # in Claude Code: investigate + fix the plan\n` +
          `    xforge test review ${planId}    # or review by hand\n` +
          "  The check is lexical, so a screen reached by reflection or a\n" +
          "  storyboard will look unreferenced too — confirm before deleting anything.\n",
      );
    }

    for (const warning of result.preflight?.warnings ?? []) {
      process.stderr.write(`  ! ${warning}\n`);
    }

    process.stderr.write(
      `\n  Plan: ${planFilePath(projectRoot, planId, "planMarkdown")}\n`,
    );

    // Always end with the single next command, so the flow is self-guiding.
    process.stderr.write("\n  Next:\n");
    if (result.unreferencedScreens.length > 0) {
      process.stderr.write(
        `    /xforge:test-review ${planId}   # settle the dead-code question first\n`,
      );
    } else if (!result.generated) {
      process.stderr.write(`    xforge test generate ${planId}\n`);
    } else if (!result.approved) {
      process.stderr.write(`    xforge test approve ${planId}\n`);
    } else if (xc && xc.warnings.length > 0) {
      process.stderr.write(
        `    add the sources listed above to your Xcode targets, then\n` +
          `    xforge test run ${planId} --execute\n`,
      );
    } else {
      process.stderr.write(
        `    xforge test run ${planId}              # dry run, no build\n` +
          `    xforge test run ${planId} --execute   # run for real\n`,
      );
    }
  });
  return result;
}

/**
 * Ask which features to plan for. "All features" is the first option because it
 * is the common answer; a single feature is the one you pick deliberately.
 */
async function pickFeatures(
  features: Array<{ id: string; name: string; status: string }>,
): Promise<string[]> {
  const choices = [
    {
      value: [] as string[],
      label: "All features",
      hint: `(${features.length})`,
    },
    ...features.map((f) => ({
      value: [f.id],
      label: f.name,
      hint: `${f.id} — ${f.status}`,
    })),
  ];
  return selectOne("Which features should the plan cover?", choices, 0);
}

function normalizeLevel(level?: string): RunLevel {
  if (level && (VALID_LEVELS as string[]).includes(level))
    return level as RunLevel;
  return "critical";
}

/** Compute the next sequential plan id for today (XFPLAN-YYYYMMDD-NNN). */
async function nextPlanId(projectRoot: string): Promise<string> {
  const now = new Date();
  const prefix = makePlanId(now, 1).slice(0, "XFPLAN-YYYYMMDD".length);
  const dir = plansDir(projectRoot);
  let seq = 1;
  try {
    const existing = await readdir(dir);
    const todays = existing.filter((name) => name.startsWith(prefix));
    seq = todays.length + 1;
  } catch {
    seq = 1;
  }
  return makePlanId(now, seq);
}
