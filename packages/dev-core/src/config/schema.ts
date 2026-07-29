import { z } from "zod";

/**
 * `.xforge/dev/config.yaml` schema (blueprint §22). Additive fields stay
 * optional with defaults so a minor tool upgrade never breaks an existing dev
 * config. Crucially, every verification action defaults to opt-in and docs sync
 * is never automatic (§4.1, §22).
 */

export const DEV_CONFIG_VERSION = 1;

export const SourceOfTruth = z
  .object({
    default_logic: z.enum(["docs", "source"]).default("docs"),
    user_request_overrides_docs: z.boolean().default(true),
    visual: z
      .enum(["figma_or_provided_image", "figma", "provided_image", "none"])
      .default("figma_or_provided_image"),
    implementation_state: z.enum(["source"]).default("source"),
    tests_as_evidence: z.boolean().default(true),
  })
  .default({});

export const PlanningSection = z
  .object({
    default_mode: z.enum(["plan-first", "auto"]).default("plan-first"),
    detect_spec_conflicts: z.boolean().default(true),
    require_requirement_traceability: z.boolean().default(true),
  })
  .default({});

export const ExecutionSection = z
  .object({
    default_actions: z
      .array(z.string())
      .default(["implement", "static_review", "create_integration_branch"]),
    build: z.enum(["opt_in"]).default("opt_in"),
    test: z.enum(["opt_in"]).default("opt_in"),
    ui_verification: z.enum(["opt_in"]).default("opt_in"),
    performance_verification: z.enum(["opt_in"]).default("opt_in"),
    continue_on_agent_failure: z.boolean().default(true),
  })
  .default({});

export const SpecChangesSection = z
  .object({
    record_differences: z.boolean().default(true),
    block_code_acceptance: z.boolean().default(false),
    sync_to_docs: z.enum(["optional", "never"]).default("optional"),
    sync_on_code_accept: z.boolean().default(false),
    preserve_history: z.boolean().default(true),
  })
  .default({});

export const WorktreesSection = z
  .object({
    root: z.string().default(".xforge/worktrees"),
    strategy: z
      .enum(["dependency-aware", "feature", "single"])
      .default("dependency-aware"),
    max_parallel: z
      .union([z.literal("auto"), z.number().int().positive()])
      .default("auto"),
    main_checkout_read_only: z.boolean().default(true),
    integration_worktree: z.boolean().default(true),
    cleanup_after_accept: z.enum(["keep", "remove"]).default("keep"),
  })
  .default({});

export const FigmaSection = z
  .object({
    enabled: z.boolean().default(true),
    freeze_snapshot_on_plan: z.boolean().default(true),
    allow_reference_images: z.boolean().default(true),
    reuse_xforge_test_visual_engine: z.boolean().default(true),
    design_map: z.string().default(".xforge/dev/design-map.yaml"),
  })
  .default({});

export const CodeSection = z
  .object({
    allow_production_edits: z.boolean().default(true),
    allow_test_source_edits: z.boolean().default(true),
    allow_debug_support: z.boolean().default(true),
    allow_dependency_addition: z
      .enum(["plan-only", "never"])
      .default("plan-only"),
    allow_public_api_changes: z
      .enum(["plan-only", "never"])
      .default("plan-only"),
    allow_database_migration: z
      .enum(["plan-only", "never"])
      .default("plan-only"),
  })
  .default({});

export const AcceptanceSection = z
  .object({
    require_build: z.boolean().default(false),
    require_tests: z.boolean().default(false),
    require_ui_verification: z.boolean().default(false),
    require_performance_verification: z.boolean().default(false),
    allow_code_accept_with_unsynced_spec: z.boolean().default(true),
  })
  .default({});

export const IntegrationSection = z
  .object({
    merge_to_main: z.boolean().default(false),
    create_integration_branch: z.boolean().default(true),
    code_sync_independent_from_docs: z.boolean().default(true),
    update_project_model_on_accept: z
      .enum(["optional", "never"])
      .default("optional"),
  })
  .default({});

export const IterationsSection = z
  .object({
    implementation: z.number().int().positive().default(5),
    static_review_fix: z.number().int().positive().default(3),
    integration_conflict_fix: z.number().int().positive().default(3),
  })
  .default({});

export const DevConfig = z.object({
  version: z.literal(DEV_CONFIG_VERSION),
  source_of_truth: SourceOfTruth,
  planning: PlanningSection,
  execution: ExecutionSection,
  spec_changes: SpecChangesSection,
  worktrees: WorktreesSection,
  figma: FigmaSection,
  code: CodeSection,
  acceptance: AcceptanceSection,
  integration: IntegrationSection,
  iterations: IterationsSection,
  /** Base branch worktrees are created from. */
  base_branch: z.string().default("main"),
  /** Where delivery runs are written. */
  runs_root: z.string().default(".xforge/dev/runs"),
});
export type DevConfig = z.infer<typeof DevConfig>;
