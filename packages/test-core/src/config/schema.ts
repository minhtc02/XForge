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

/**
 * Running the same case on more than one screen size — the cheapest way to
 * catch the most common class of UI bug (layout that breaks on the small
 * device, text that truncates at a large Dynamic Type size).
 */
export const ResponsiveSection = z
  .object({
    enabled: z.boolean().default(true),
    /**
     * Case types that fan out across every device whose roles include them.
     * Functional cases stay on one device: re-running the same tap on four
     * screens costs time and finds nothing.
     */
    expand_types: z.array(z.string()).default(["visual", "accessibility"]),
    /**
     * Dynamic Type sizes to additionally run accessibility cases at. Each size
     * costs one more shard, so the default is the one that breaks layouts.
     */
    dynamic_type_sizes: z.array(z.string()).default([]),
    /** Appearances to fan out across, e.g. `["light", "dark"]`. */
    appearances: z.array(z.enum(["light", "dark"])).default([]),
  })
  .default({});
export type ResponsiveSection = z.infer<typeof ResponsiveSection>;

/** System-level state control via `simctl` (optimization plan §B). */
export const StateSection = z
  .object({
    enabled: z.boolean().default(true),
    /**
     * Pre-grant privacy permissions with `simctl privacy grant`. Off by default:
     * simctl itself warns that bypassing the permission flow can mask bugs (an
     * app missing its Info.plist usage key would still run).
     */
    grant_permissions: z.boolean().default(false),
    /**
     * `launch-arg` delivers a deep link through XForgeTestSupport inside one
     * xcodebuild invocation (per-case, cheap). `os` uses `simctl openurl` for a
     * real OS handoff, which costs the bucket its own invocation.
     */
    deep_link_mode: z.enum(["launch-arg", "os"]).default("launch-arg"),
    /** Use uninstall+reinstall for first-run cases (the only true FTU state). */
    fresh_install_for_ftu: z.boolean().default(true),
    /** Guard against bucket explosion; extra buckets fold back and are reported. */
    max_buckets_per_feature: z.number().int().positive().default(4),
  })
  .default({});
export type StateSection = z.infer<typeof StateSection>;

/** Navigation graph used to derive shortest paths to a screen (§A). */
export const NavigationSection = z
  .object({
    enabled: z.boolean().default(true),
    graph: z.string().default("navigation.yaml"),
    /** Edges below this confidence are never used to build a path. */
    min_edge_confidence: z.number().min(0).max(1).default(0.6),
    max_path_length: z.number().int().positive().default(6),
  })
  .default({});
export type NavigationSection = z.infer<typeof NavigationSection>;

export const PlanningSection = z
  .object({
    /**
     * Refuse to write a plan when static reconciliation finds a locator that
     * does not exist in source. Off by default so an existing project is not
     * blocked by a tool upgrade; turn it on to enforce testability.
     */
    fail_on_deviation: z.boolean().default(false),
  })
  .default({});
export type PlanningSection = z.infer<typeof PlanningSection>;

export const ExecutionSection = z
  .object({
    continue_on_failure: z.boolean().default(true),
    /**
     * Render an expectation with no assertion as a hard failure instead of an
     * explicit skip. Either way it is never a silent pass (§14 exit-0 trap).
     */
    strict_expectations: z.boolean().default(false),
    /**
     * Run the accessibility probe after build-for-testing, before the shard
     * matrix. `auto` probes only when static reconciliation left locators
     * unresolvable — probing when everything already matched buys nothing.
     */
    probe_before_run: z.enum(["off", "auto", "always"]).default("auto"),
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
  responsive: ResponsiveSection,
  state: StateSection,
  navigation: NavigationSection,
  planning: PlanningSection,
  execution: ExecutionSection,
  visual: VisualSection,
  performance: PerformanceSection,
  output: OutputSection,
});
export type TestConfig = z.infer<typeof TestConfig>;
