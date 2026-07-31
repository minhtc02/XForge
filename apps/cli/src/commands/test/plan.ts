import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ValidationError } from "@xforge/shared";
import { hashContent, statePath } from "@xforge/core";
import {
  buildTestPlan,
  designNodesForFeature,
  ensureTestDirs,
  loadDesignMap,
  makePlanId,
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
import { resolveNavigationGraph } from "./navigation.js";

export interface TestPlanOptions {
  feature?: string;
  level?: string;
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
  approved: boolean;
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
  const featureFilter = options.feature
    ? options.feature
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  const { model, testConfig } = await loadTestModelContext(ctx);
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
    approved: false,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(`Test plan created: ${planId}`);
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
    process.stderr.write(
      `\n  Plan: ${planFilePath(projectRoot, planId, "planMarkdown")}\n` +
        `\n  Next:\n    xforge test generate ${planId}\n    xforge test approve ${planId}\n`,
    );
  });
  return result;
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
