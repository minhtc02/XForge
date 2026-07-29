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

  const planId = await nextPlanId(projectRoot);
  const plan = buildTestPlan({
    planId,
    model,
    config: testConfig,
    level,
    featureFilter,
    inputs: {
      config_version: 1,
      project_model_hash: projectModelHash,
      design_map_hash: designMapHash,
    },
    environment: {
      hasUiTestTarget: env.hasUiTestTarget,
      hasAccessibilityIdentifiers: env.hasAccessibilityIdentifiers,
      figmaFrameCount,
      existingTestCount,
    },
  });

  if (plan.test_cases.length === 0) {
    throw new ValidationError(
      featureFilter.length > 0
        ? `No features matched filter [${featureFilter.join(", ")}]. Known features: ${model.features.map((f) => f.id).join(", ") || "(none)"}.`
        : "No features detected in the Project Model; run `xforge docs` first.",
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
    approved: false,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(`Test plan created: ${planId}`);
    process.stderr.write(
      `\n  Cases:              ${result.stats.total_cases}\n` +
        `  Suites:             ${result.stats.suites}\n` +
        `  Simulator shards:   ${result.stats.shards}\n` +
        `  Testability issues: ${result.stats.testability_issues}\n` +
        `\n  Plan: ${planFilePath(projectRoot, planId, "planMarkdown")}\n` +
        `\n  Review, then approve with:\n    xforge test approve ${planId}\n`,
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
