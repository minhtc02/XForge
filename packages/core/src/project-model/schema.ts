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
  evidence: z.array(Evidence).default([]),
});
export type Feature = z.infer<typeof Feature>;

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
  gaps: z.array(Gap).default([]),
  assumptions: z.array(Assumption).default([]),
  metadata: GenerationMetadata,
});
export type ProjectModel = z.infer<typeof ProjectModel>;
