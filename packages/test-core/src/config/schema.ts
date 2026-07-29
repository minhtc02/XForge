import { z } from "zod";

/**
 * `.xforge/test/config.yaml` schema (blueprint §26). Additive fields stay
 * optional with defaults so a minor tool upgrade never breaks an existing test
 * config (mirrors XForge Core's config-versioning approach).
 */

export const TEST_CONFIG_VERSION = 1;

export const ProjectSection = z
  .object({
    scheme: z.string().default("auto"),
    workspace: z.string().default("auto"),
    project: z.string().default("auto"),
    configuration: z.string().default("Debug"),
    app_bundle_id: z.string().default("auto"),
    ui_test_target: z.string().default("auto"),
  })
  .default({});

export const FigmaSection = z
  .object({
    enabled: z.boolean().default(false),
    design_map: z.string().default(".xforge/test/design-map.yaml"),
    snapshot_on_plan: z.boolean().default(true),
    use_cached_snapshots_during_run: z.boolean().default(true),
  })
  .default({});

export const TestabilitySection = z
  .object({
    mode: z
      .enum(["read-only", "test-support", "production-modification"])
      .default("test-support"),
    allow_accessibility_identifiers: z.boolean().default(true),
    allow_debug_hooks: z.boolean().default(true),
    allow_test_deep_links: z.boolean().default(true),
    allow_mock_clock: z.boolean().default(true),
    allow_mock_network: z.boolean().default(true),
    allow_state_reset: z.boolean().default(true),
  })
  .default({});

export const DeviceConfig = z.object({
  name: z.string().min(1),
  runtime: z.string().default("latest"),
  roles: z.array(z.string()).default([]),
});
export type DeviceConfig = z.infer<typeof DeviceConfig>;

export const WorkersSection = z
  .object({
    max: z
      .union([z.literal("auto"), z.number().int().positive()])
      .default("auto"),
    strategy: z
      .enum(["feature", "device", "test-type", "risk", "balanced-duration"])
      .default("feature"),
    memory_per_worker_gb: z.number().positive().default(4),
  })
  .default({});

export const ExecutionSection = z
  .object({
    continue_on_failure: z.boolean().default(true),
    retry_infrastructure_failure: z.number().int().nonnegative().default(2),
    retry_assertion_failure: z.number().int().nonnegative().default(0),
    global_timeout_minutes: z.number().int().positive().default(90),
    record_video_on_failure: z.boolean().default(true),
    capture_screenshot_on_step: z.boolean().default(false),
    capture_screenshot_on_failure: z.boolean().default(true),
  })
  .default({});

export const VisualSection = z
  .object({
    enabled: z.boolean().default(true),
    layout_tolerance_points: z.number().nonnegative().default(2),
    pixel_difference_warning: z.number().min(0).max(1).default(0.01),
    pixel_difference_failure: z.number().min(0).max(1).default(0.03),
    color_delta_warning: z.number().nonnegative().default(3),
    color_delta_failure: z.number().nonnegative().default(8),
    mask_dynamic_regions: z.boolean().default(true),
  })
  .default({});
export type VisualSection = z.infer<typeof VisualSection>;

export const PerformanceSection = z
  .object({
    enabled: z.boolean().default(true),
    baseline_mode: z.enum(["relative", "absolute"]).default("relative"),
    minimum_samples: z.number().int().positive().default(5),
    warning_percent: z.number().nonnegative().default(10),
    failure_percent: z.number().nonnegative().default(25),
    discard_outliers: z.boolean().default(true),
  })
  .default({});
export type PerformanceSection = z.infer<typeof PerformanceSection>;

export const OutputSection = z
  .object({
    docs_root: z.string().default("docs/qa"),
    runs_root: z.string().default("qa-runs"),
  })
  .default({});

export const SourcesSection = z
  .object({
    project_model: z.string().default(".xforge/state/project-model.json"),
    docs: z.array(z.string()).default(["docs/project/**/*.md"]),
    prd: z
      .array(z.string())
      .default(["docs/**/prd*.md", "_bmad-output/**/prd*.md"]),
    tests: z
      .array(z.string())
      .default(["**/*Tests/**/*.swift", "**/*UITests/**/*.swift"]),
  })
  .default({});

export const TestConfig = z.object({
  version: z.literal(TEST_CONFIG_VERSION),
  project: ProjectSection,
  sources: SourcesSection,
  figma: FigmaSection,
  testability: TestabilitySection,
  devices: z.array(DeviceConfig).default([
    {
      name: "iPhone 15 Pro",
      runtime: "latest",
      roles: ["functional", "visual", "performance"],
    },
    {
      name: "iPhone SE",
      runtime: "latest",
      roles: ["visual", "accessibility"],
    },
  ]),
  workers: WorkersSection,
  execution: ExecutionSection,
  visual: VisualSection,
  performance: PerformanceSection,
  output: OutputSection,
});
export type TestConfig = z.infer<typeof TestConfig>;
