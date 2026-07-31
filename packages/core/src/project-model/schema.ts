import { z } from "zod";
import {
  Confidence,
  EvidenceKind,
  ImplementationStatus,
  SourceType,
} from "./enums.js";

/**
 * Canonical Project Model schema (blueprint §9, §10).
 *
 * This is XForge's core asset: a structured, evidence-backed, reusable model of
 * a repository. Everything is defined with Zod so we get both runtime
 * validation and inferred TypeScript types from a single source of truth.
 *
 * Use snake_case field names to match the serialized JSON/YAML in the blueprint
 * examples and the published JSON Schema.
 */

const Id = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be kebab-case (a-z, 0-9, -)");

/** A single evidence pointer into the repository. */
export const Evidence = z.object({
  id: z.string().min(1).optional(),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  kind: EvidenceKind,
  description: z.string().optional(),
  confidence: Confidence.default(1),
});
export type Evidence = z.infer<typeof Evidence>;

export const ProjectPrinciple = z.object({
  id: Id,
  description: z.string().min(1),
  source_type: SourceType,
  sources: z.array(z.string()).default([]),
});
export type ProjectPrinciple = z.infer<typeof ProjectPrinciple>;

export const Technology = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  confidence: Confidence.default(1),
  evidence: z.array(Evidence).default([]),
});
export type Technology = z.infer<typeof Technology>;

export const SourceFile = z.object({
  path: z.string().min(1),
  language: z.string().optional(),
  hash: z.string().optional(),
  loc: z.number().int().nonnegative().optional(),
  role: z.string().optional(),
});
export type SourceFile = z.infer<typeof SourceFile>;

export const Symbol = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
});
export type Symbol = z.infer<typeof Symbol>;

export const FeatureEntryPoint = z.object({
  name: z.string().min(1),
  kind: z.string().optional(),
  file: z.string().optional(),
});
export type FeatureEntryPoint = z.infer<typeof FeatureEntryPoint>;

export const Feature = z.object({
  id: Id,
  name: z.string().min(1),
  status: ImplementationStatus,
  confidence: Confidence.default(0.5),
  summary: z.string().optional(),
  entry_points: z.array(FeatureEntryPoint).default([]),
  source_files: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  /** Frameworks imported by this feature's files (SwiftUI, CoreLocation, ...). */
  frameworks: z.array(z.string()).default([]),
  evidence: z.array(Evidence).default([]),
});
export type Feature = z.infer<typeof Feature>;

/**
 * An `accessibilityIdentifier` declared in source. `value` is absent when the
 * expression is interpolated or computed — recorded as `dynamic` so consumers
 * report "unresolvable" rather than "missing" (§3.3).
 */
export const AccessibilityIdentifier = z.object({
  value: z.string().optional(),
  expression: z.string(),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  dynamic: z.boolean().default(false),
  feature: z.string().optional(),
});
export type AccessibilityIdentifier = z.infer<typeof AccessibilityIdentifier>;

export const Requirement = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  source_type: SourceType,
  implementation_status: ImplementationStatus,
  confidence: Confidence.default(0.5),
  feature: z.string().optional(),
  evidence: z.array(Evidence).default([]),
});
export type Requirement = z.infer<typeof Requirement>;

/** A value/DTO type the app models its data with (blueprint §10). */
export const DataModel = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  /** Conformances that made this a data model (Codable, Identifiable, ...). */
  conformances: z.array(z.string()).default([]),
  feature: z.string().optional(),
  evidence: z.array(Evidence).default([]),
});
export type DataModel = z.infer<typeof DataModel>;

/** A type persisted by a storage mechanism (Core Data, SwiftData, Realm). */
export const PersistenceEntity = z.object({
  name: z.string().min(1),
  mechanism: z.string().min(1),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  feature: z.string().optional(),
  evidence: z.array(Evidence).default([]),
});
export type PersistenceEntity = z.infer<typeof PersistenceEntity>;

/**
 * A privacy permission the app declares. `simctl_grantable` records whether a
 * simulator can pre-authorize it, which QA planning needs up front.
 */
export const Permission = z.object({
  /** The `NS…UsageDescription` key or entitlement key. */
  key: z.string().min(1),
  /** Normalized service name (camera, location, ...). */
  service: z.string().min(1),
  purpose: z.string().optional(),
  source: z.enum(["plist", "entitlement", "source"]).default("plist"),
  simctl_grantable: z.boolean().default(false),
  evidence: z.array(Evidence).default([]),
});
export type Permission = z.infer<typeof Permission>;

/** An analytics event name passed to a recognized logging API. */
export const AnalyticsEvent = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  feature: z.string().optional(),
  evidence: z.array(Evidence).default([]),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>;

/** A remote endpoint referenced from source as an absolute URL literal. */
export const ApiEndpoint = z.object({
  url: z.string().min(1),
  host: z.string().min(1),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  feature: z.string().optional(),
  evidence: z.array(Evidence).default([]),
});
export type ApiEndpoint = z.infer<typeof ApiEndpoint>;

/** A third-party dependency declared by a package manifest. */
export const Dependency = z.object({
  name: z.string().min(1),
  manager: z.enum(["spm", "cocoapods"]),
  requirement: z.string().optional(),
  url: z.string().optional(),
  evidence: z.array(Evidence).default([]),
});
export type Dependency = z.infer<typeof Dependency>;

/** An architectural layer derived from detected file roles. */
export const ArchitectureComponent = z.object({
  id: Id,
  name: z.string().min(1),
  role: z.string().min(1),
  file_count: z.number().int().nonnegative().default(0),
  files: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
});
export type ArchitectureComponent = z.infer<typeof ArchitectureComponent>;

/** An existing automated test discovered in the repository. */
export const TestCase = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  kind: z.enum(["unit", "ui"]).default("unit"),
  feature: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCase>;

export const Gap = z.object({
  requirement: z.string().optional(),
  feature: z.string().optional(),
  status: ImplementationStatus,
  kind: z
    .enum([
      "planned-not-implemented",
      "implemented-not-in-prd",
      "implemented-not-tested",
      "implemented-not-documented",
    ])
    .optional(),
  description: z.string().min(1),
});
export type Gap = z.infer<typeof Gap>;

export const Assumption = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  confidence: Confidence.default(0.5),
  needs_confirmation: z.boolean().default(true),
});
export type Assumption = z.infer<typeof Assumption>;

export const GenerationMetadata = z.object({
  generated_by: z.literal("xforge").default("xforge"),
  generator_version: z.string(),
  source_commit: z.string().optional(),
  last_generated_at: z.string().optional(),
  confidence: Confidence.optional(),
});
export type GenerationMetadata = z.infer<typeof GenerationMetadata>;

export const ProjectType = z.enum([
  "ios-application",
  "ios-library",
  "unknown",
]);
export type ProjectType = z.infer<typeof ProjectType>;

export const ProjectInfo = z.object({
  id: Id,
  name: z.string().min(1),
  type: ProjectType.default("unknown"),
  platforms: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
});
export type ProjectInfo = z.infer<typeof ProjectInfo>;

/** Top-level Canonical Project Model. */
export const ProjectModel = z.object({
  schema_version: z.literal(1).default(1),
  project: ProjectInfo,
  principles: z.array(ProjectPrinciple).default([]),
  technologies: z.array(Technology).default([]),
  features: z.array(Feature).default([]),
  requirements: z.array(Requirement).default([]),
  source_files: z.array(SourceFile).default([]),
  symbols: z.array(Symbol).default([]),
  architecture: z.array(ArchitectureComponent).default([]),
  data_models: z.array(DataModel).default([]),
  persistence_entities: z.array(PersistenceEntity).default([]),
  permissions: z.array(Permission).default([]),
  analytics_events: z.array(AnalyticsEvent).default([]),
  api_endpoints: z.array(ApiEndpoint).default([]),
  dependencies: z.array(Dependency).default([]),
  test_cases: z.array(TestCase).default([]),
  accessibility_identifiers: z.array(AccessibilityIdentifier).default([]),
  /** iOS capabilities from entitlements (`Push Notifications`, ...). */
  capabilities: z.array(z.string()).default([]),
  /** `UIBackgroundModes` values declared in Info.plist. */
  background_modes: z.array(z.string()).default([]),
  /** Custom URL schemes (deep-link entry points). */
  url_schemes: z.array(z.string()).default([]),
  gaps: z.array(Gap).default([]),
  assumptions: z.array(Assumption).default([]),
  metadata: GenerationMetadata,
});
export type ProjectModel = z.infer<typeof ProjectModel>;
