import { z } from "zod";

/**
 * `.xforge/config.yaml` schema (blueprint §18).
 *
 * Design notes:
 *  - `version` is a single integer schema version. Bumping it is a breaking
 *    change; additive fields keep the same version and stay optional with
 *    defaults, so older configs keep working on patch/minor tool upgrades
 *    (MVP acceptance criterion §27.20).
 *  - Unknown top-level keys are preserved via `.passthrough()` on nested
 *    objects where forward-compat matters, but the shape is otherwise strict
 *    enough to catch typos.
 */

export const CONFIG_VERSION = 1;

export const SourcesConfig = z
  .object({
    code: z.array(z.string()).default(["."]),
    documents: z.array(z.string()).default(["README.md", "docs/**/*.md"]),
    prd: z
      .array(z.string())
      .default(["docs/**/prd*.md", "_bmad-output/**/prd*.md"]),
    speckit: z
      .array(z.string())
      .default([".specify/memory/constitution.md", "specs/**/*.md"]),
    bmad: z.array(z.string()).default(["_bmad-output/**/*.md"]),
  })
  .default({});

export const OutputConfig = z
  .object({
    root: z.string().default("docs/project"),
    format: z.enum(["markdown"]).default("markdown"),
    diagrams: z.enum(["mermaid", "none"]).default("mermaid"),
    language: z.string().default("vi"),
  })
  .default({});

export const GenerationConfig = z
  .object({
    include_code_references: z.boolean().default(true),
    include_prd_traceability: z.boolean().default(true),
    include_tests: z.boolean().default(true),
    detect_feature_gaps: z.boolean().default(true),
    preserve_manual_blocks: z.boolean().default(true),
    minimum_confidence: z.number().min(0).max(1).default(0.75),
    /**
     * Publish the complete model — inventories included — as
     * `_meta/project-model.json`, so the documentation tree stands on its own.
     * Turn off on a very large repository to keep the published tree small;
     * `.xforge/state/` always keeps the split form regardless.
     */
    publish_full_model: z.boolean().default(true),
  })
  .default({});

export const ProjectConfig = z
  .object({
    profile: z.enum(["ios-swift", "generic"]).default("ios-swift"),
    name: z.string().default("auto"),
  })
  .default({});

/** A feature's explicit path globs (blueprint §13.1). */
export const FeatureConfig = z.object({
  paths: z.array(z.string()).default([]),
});

/** Default exclude globs — includes secret-bearing files (blueprint §23). */
export const DEFAULT_EXCLUDES = [
  ".git/**",
  "DerivedData/**",
  "Pods/**",
  ".build/**",
  "node_modules/**",
  ".xforge/**",
  "**/*.xcuserstate",
  "**/*.pem",
  "**/*.p12",
  "**/*.mobileprovision",
  "**/.env*",
  "**/GoogleService-Info.plist",
] as const;

export const XForgeConfig = z.object({
  version: z.literal(CONFIG_VERSION),
  project: ProjectConfig,
  sources: SourcesConfig,
  exclude: z.array(z.string()).default([...DEFAULT_EXCLUDES]),
  output: OutputConfig,
  generation: GenerationConfig,
  features: z.record(z.string(), FeatureConfig).default({}),
});
export type XForgeConfig = z.infer<typeof XForgeConfig>;
export type SourcesConfig = z.infer<typeof SourcesConfig>;
export type OutputConfig = z.infer<typeof OutputConfig>;
export type GenerationConfig = z.infer<typeof GenerationConfig>;
