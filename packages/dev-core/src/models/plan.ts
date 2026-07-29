import { z } from "zod";
import {
  BuildStatus,
  Confidence,
  DevMode,
  DocsStatus,
  PerformanceStatus,
  RiskLevel,
  TaskStatus,
  TestStatus,
  UIStatus,
} from "./enums.js";
import { EffectiveSpec } from "./spec.js";

/**
 * DevPlan and its parts (blueprint §8, §9, §10, §16). A plan is deterministic
 * and immutable-once-approved; it never modifies production code.
 */

export const FileScope = z.object({
  /** Glob or path the group is allowed to write. */
  path: z.string().min(1),
  mode: z.enum(["create", "modify", "create-test"]).default("modify"),
});
export type FileScope = z.infer<typeof FileScope>;

export const ImplementationTask = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  requirement_ids: z.array(z.string()).default([]),
  file_scope: z.array(FileScope).default([]),
  status: TaskStatus.default("PLANNED"),
});
export type ImplementationTask = z.infer<typeof ImplementationTask>;

export const ImplementationGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Group ids this group depends on (task graph edges). */
  depends_on: z.array(z.string()).default([]),
  tasks: z.array(ImplementationTask).default([]),
  /** Whether this group shares files with others (kept sequential if so). */
  shares_files: z.boolean().default(false),
});
export type ImplementationGroup = z.infer<typeof ImplementationGroup>;

export const Branch = z.object({
  name: z.string().min(1),
  base: z.string().min(1),
});
export type Branch = z.infer<typeof Branch>;

/** A planned worktree (blueprint §10). Never created during plan/dry-run. */
export const Worktree = z.object({
  id: z.string().min(1),
  /** Path under `.xforge/worktrees/` only (§16 safety). */
  path: z.string().min(1),
  branch: z.string().min(1),
  base: z.string().min(1),
  group_id: z.string().optional(),
  is_integration: z.boolean().default(false),
});
export type Worktree = z.infer<typeof Worktree>;

/** Impact analysis output (blueprint §11 Impact Analyst). */
export const ImpactAnalysis = z.object({
  affected_files: z.array(z.string()).default([]),
  affected_features: z.array(z.string()).default([]),
  regression_risk: RiskLevel.default("low"),
  merge_conflict_risk: RiskLevel.default("low"),
  notes: z.array(z.string()).default([]),
});
export type ImpactAnalysis = z.infer<typeof ImpactAnalysis>;

/** Permission manifest (blueprint §16). Optional actions default to false. */
export const PermissionManifest = z.object({
  allowed: z
    .object({
      readRepository: z.boolean().default(true),
      createWorktrees: z.boolean().default(true),
      writeWorktrees: z.boolean().default(true),
      readFigma: z.boolean().default(false),
      readProvidedImages: z.boolean().default(false),
      createSourceFiles: z.boolean().default(true),
      modifySourceFiles: z.boolean().default(true),
      createTestSourceFiles: z.boolean().default(true),
      commitFeatureBranches: z.boolean().default(true),
      mergeIntoIntegrationBranch: z.boolean().default(true),
    })
    .default({}),
  optional: z
    .object({
      runBuild: z.boolean().default(false),
      runTests: z.boolean().default(false),
      runSimulator: z.boolean().default(false),
      runUIVerification: z.boolean().default(false),
      runPerformanceVerification: z.boolean().default(false),
    })
    .default({}),
  denied: z
    .object({
      modifyMainCheckout: z.boolean().default(true),
      mergeIntoMain: z.boolean().default(true),
      forcePush: z.boolean().default(true),
      modifySigning: z.boolean().default(true),
      accessProduction: z.boolean().default(true),
      publishBuild: z.boolean().default(true),
    })
    .default({}),
});
export type PermissionManifest = z.infer<typeof PermissionManifest>;

/** Optional-action requested flags — all default false (§19, §27). */
export const OptionalActions = z.object({
  build: BuildStatus.default("NOT_REQUESTED"),
  test: TestStatus.default("NOT_REQUESTED"),
  ui_verification: UIStatus.default("NOT_REQUESTED"),
  performance: PerformanceStatus.default("NOT_REQUESTED"),
  docs_sync: DocsStatus.default("NOT_REQUIRED"),
});
export type OptionalActions = z.infer<typeof OptionalActions>;

export const PlanInputs = z.object({
  base_branch: z.string().default("main"),
  source_commit: z.string().optional(),
  config_version: z.number().int(),
  project_model_hash: z.string().optional(),
  effective_spec_hash: z.string().optional(),
  figma_snapshot_version: z.string().optional(),
});
export type PlanInputs = z.infer<typeof PlanInputs>;

export const DevPlan = z.object({
  schema_version: z.literal(1).default(1),
  id: z.string().min(1),
  project_id: z.string().min(1),
  created_at: z.string(),
  mode: DevMode.default("plan-first"),
  feature: z.string().min(1),
  change_id: z.string().min(1),
  effective_spec: EffectiveSpec,
  impact: ImpactAnalysis,
  groups: z.array(ImplementationGroup).default([]),
  worktrees: z.array(Worktree).default([]),
  integration_branch: z.string().min(1),
  permissions: PermissionManifest,
  optional_actions: OptionalActions,
  /** Actions requiring re-approval if auto (§17). */
  requires_approval: z.array(z.string()).default([]),
  inputs: PlanInputs,
  confidence: Confidence.default(0.6),
});
export type DevPlan = z.infer<typeof DevPlan>;
