import { z } from "zod";
import { Confidence, RunLevel, Severity, TestabilityMode } from "./enums.js";
import { TestCase } from "./test-case.js";

/**
 * TestPlan, TestSuite, SimulatorShard, TestabilityIssue, ExecutionPlan and
 * the immutable plan-input hash (blueprint §8, §16, §13, §18, §19, §5.3).
 */

export const TestSuite = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  feature: z.string().min(1),
  case_ids: z.array(z.string()).default([]),
});
export type TestSuite = z.infer<typeof TestSuite>;

/** A simulator worker shard (blueprint §16, §18). */
export const SimulatorShard = z.object({
  id: z.string().min(1),
  /** XForge-managed simulator name, e.g. XForge-iPhone15Pro-Worker-01 (§16.1). */
  simulator_name: z.string().min(1),
  device: z.string().min(1),
  runtime: z.string().default("latest"),
  roles: z.array(z.string()).default([]),
  case_ids: z.array(z.string()).default([]),
  /** Cases sharing mutable state must run sequentially within a shard (§18). */
  sequential: z.boolean().default(true),
  estimated_minutes: z.number().nonnegative().default(0),
});
export type SimulatorShard = z.infer<typeof SimulatorShard>;

/** A detected testability problem (blueprint §13). */
export const TestabilityIssue = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().min(1),
  severity: Severity,
  /** Case ids affected by this issue. */
  affected_cases: z.array(z.string()).default([]),
  /** Suggested test-support remediation (§13.1 test-support mode). */
  remediation: z.string().optional(),
  /** True if this blocks automation entirely under read-only mode. */
  blocks_automation: z.boolean().default(false),
});
export type TestabilityIssue = z.infer<typeof TestabilityIssue>;

/** The immutable snapshot of inputs a plan was built from (blueprint §5.3). */
export const PlanInputs = z.object({
  source_commit: z.string().optional(),
  config_version: z.number().int(),
  project_model_hash: z.string().optional(),
  figma_snapshot_version: z.string().optional(),
  /** Hash of the design map used, if any. */
  design_map_hash: z.string().optional(),
});
export type PlanInputs = z.infer<typeof PlanInputs>;

/** Enumerated permission scope requested by a plan (blueprint §19.1). */
export const PermissionScope = z.object({
  readRepository: z.boolean().default(true),
  readFigmaFrames: z.boolean().default(false),
  writeTestFiles: z.boolean().default(true),
  modifyDebugTestSupport: z.boolean().default(true),
  createSimulators: z.boolean().default(true),
  eraseManagedSimulators: z.boolean().default(true),
  runXcodebuild: z.boolean().default(true),
  captureArtifacts: z.boolean().default(true),
});
export type PermissionScope = z.infer<typeof PermissionScope>;

export const EstimatedDuration = z.object({
  min_minutes: z.number().nonnegative(),
  max_minutes: z.number().nonnegative(),
});

export const PlanStats = z.object({
  total_cases: z.number().int().nonnegative(),
  suites: z.number().int().nonnegative(),
  shards: z.number().int().nonnegative(),
  by_type: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type PlanStats = z.infer<typeof PlanStats>;

/** The full, immutable-once-approved test plan (blueprint §5.3, §31 Phase 1). */
export const TestPlan = z.object({
  schema_version: z.literal(1).default(1),
  id: z.string().min(1),
  project_id: z.string().min(1),
  created_at: z.string(),
  level: RunLevel,
  /** Feature filter used, if any (`--feature`). */
  feature_filter: z.array(z.string()).default([]),
  scope: z.array(z.string()).default([]),
  test_cases: z.array(TestCase).default([]),
  suites: z.array(TestSuite).default([]),
  shards: z.array(SimulatorShard).default([]),
  testability_issues: z.array(TestabilityIssue).default([]),
  testability_mode: TestabilityMode.default("test-support"),
  permissions: PermissionScope,
  production_modifications: z.array(z.string()).default([]),
  estimated_duration: EstimatedDuration,
  stats: PlanStats,
  inputs: PlanInputs,
  /** Sources discovered while planning (for the plan.md summary, §5.2). */
  sources: z
    .object({
      project_model: z.boolean().default(false),
      prd: z.boolean().default(false),
      existing_tests: z.number().int().nonnegative().default(0),
      figma_frames: z.number().int().nonnegative().default(0),
      feature_source_files: z.number().int().nonnegative().default(0),
    })
    .default({}),
  confidence: Confidence.default(0.6),
});
export type TestPlan = z.infer<typeof TestPlan>;
