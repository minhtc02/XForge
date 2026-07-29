import type { Feature, ProjectModel } from "@xforge/core";
import { parseTestPlan, type TestPlan } from "../models/index.js";
import type { TestSuite } from "../models/plan.js";
import type { RunLevel, TestType } from "../models/enums.js";
import type { TestConfig } from "../config/schema.js";
import { generateTestCases } from "./case-generator.js";
import { buildShards } from "./shard.js";
import { analyzeTestability } from "./testability.js";

/**
 * Assemble a full {@link TestPlan} from the Canonical Project Model + test
 * config (blueprint §5.2, §31 Phase 1). Pure and deterministic given its
 * inputs; the CLI layer supplies model, config and environment facts.
 */

export interface BuildPlanInput {
  planId: string;
  model: ProjectModel;
  config: TestConfig;
  level: RunLevel;
  /** Feature ids to include; empty = all detected features. */
  featureFilter?: string[];
  /** Immutable input provenance. */
  inputs: TestPlan["inputs"];
  /** Environment facts discovered by the CLI (from `test doctor` logic). */
  environment: {
    hasUiTestTarget: boolean;
    hasAccessibilityIdentifiers: boolean;
    figmaFrameCount: number;
    existingTestCount: number;
  };
  createdAt?: string;
}

function selectFeatures(model: ProjectModel, filter?: string[]): Feature[] {
  if (!filter || filter.length === 0) return model.features;
  const wanted = new Set(filter.map((f) => f.toLowerCase()));
  return model.features.filter((f) => wanted.has(f.id.toLowerCase()));
}

export function buildTestPlan(input: BuildPlanInput): TestPlan {
  const features = selectFeatures(input.model, input.featureFilter);

  const testCases = generateTestCases({
    model: input.model,
    features,
    level: input.level,
  });

  // Mark cases blocked when read-only mode + a blocking testability issue.
  const testability = analyzeTestability({
    model: input.model,
    features,
    mode: input.config.testability.mode,
    hasUiTestTarget: input.environment.hasUiTestTarget,
    hasAccessibilityIdentifiers: input.environment.hasAccessibilityIdentifiers,
  });
  const hardBlock = testability.some((t) => t.blocks_automation);
  if (hardBlock) {
    for (const c of testCases) c.automation.blocked = true;
  }

  const suites: TestSuite[] = features.map((f) => ({
    id: `suite-${f.id}`,
    name: `${f.name} suite`,
    feature: f.id,
    case_ids: testCases.filter((c) => c.feature === f.id).map((c) => c.id),
  }));

  const { shards, estimatedMinutes } = buildShards(
    testCases,
    input.config.devices,
  );

  const byType: Record<string, number> = {};
  for (const c of testCases) {
    for (const t of c.types as TestType[]) {
      byType[t] = (byType[t] ?? 0) + 1;
    }
  }

  const figmaEnabled = input.config.figma.enabled;
  const plan: TestPlan = {
    schema_version: 1,
    id: input.planId,
    project_id: input.model.project.id,
    created_at: input.createdAt ?? new Date().toISOString(),
    level: input.level,
    feature_filter: input.featureFilter ?? [],
    scope: features.map((f) => f.name),
    test_cases: testCases,
    suites,
    shards,
    testability_issues: testability,
    testability_mode: input.config.testability.mode,
    permissions: {
      readRepository: true,
      readFigmaFrames: figmaEnabled && input.environment.figmaFrameCount > 0,
      writeTestFiles: input.config.testability.mode !== "read-only",
      modifyDebugTestSupport: input.config.testability.mode === "test-support",
      createSimulators: true,
      eraseManagedSimulators: true,
      runXcodebuild: true,
      captureArtifacts: true,
    },
    production_modifications: [],
    estimated_duration: {
      min_minutes: estimatedMinutes.min,
      max_minutes: estimatedMinutes.max,
    },
    stats: {
      total_cases: testCases.length,
      suites: suites.length,
      shards: shards.length,
      by_type: byType,
    },
    inputs: input.inputs,
    sources: {
      project_model: true,
      prd: input.model.requirements.length > 0,
      existing_tests: input.environment.existingTestCount,
      figma_frames: input.environment.figmaFrameCount,
      feature_source_files: features.reduce(
        (n, f) => n + f.source_files.length,
        0,
      ),
    },
    confidence: features.length > 0 ? 0.7 : 0.3,
  };

  // Validate before returning so callers always get a schema-valid plan.
  return parseTestPlan(plan);
}

/** Generate a plan id like XFPLAN-20260729-001 from a date + sequence. */
export function makePlanId(date: Date, sequence: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `XFPLAN-${y}${m}${d}-${String(sequence).padStart(3, "0")}`;
}
