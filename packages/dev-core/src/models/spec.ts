import { z } from "zod";
import { Confidence, SpecSource, SpecStatus } from "./enums.js";

/**
 * Effective Spec model (blueprint §13, §14). The Effective Spec is the resolved
 * behavior XForge Dev implements:  canonical docs + user overrides + approved
 * plan. User overrides never mutate docs — they are recorded as Staged Spec
 * differences (§14, §4.2).
 */

export const Requirement = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  source: SpecSource,
  acceptance_criteria: z.array(z.string()).default([]),
  /** Files expected to implement this requirement (from docs/model). */
  implementation: z.array(z.string()).default([]),
  test_source: z.array(z.string()).default([]),
  feature: z.string().optional(),
  confidence: Confidence.default(0.6),
});
export type Requirement = z.infer<typeof Requirement>;

/** A user request that overrides the documented behavior in this run (§14). */
export const UserOverride = z.object({
  id: z.string().min(1),
  /** Requirement id or free-form target the override applies to. */
  target: z.string().min(1),
  /** The documented value/behavior. */
  docs_value: z.string().optional(),
  /** The requested value/behavior that takes effect this run. */
  requested_value: z.string().min(1),
  reason: z.string().optional(),
});
export type UserOverride = z.infer<typeof UserOverride>;

/** A recorded difference between canonical docs and effective behavior (§14). */
export const SpecDifference = z.object({
  id: z.string().min(1),
  target: z.string().min(1),
  docs_value: z.string().optional(),
  effective_value: z.string().min(1),
  source: SpecSource,
  /** Path(s) of the canonical doc this difference diverges from. */
  doc_paths: z.array(z.string()).default([]),
  status: SpecStatus.default("RECORDED"),
});
export type SpecDifference = z.infer<typeof SpecDifference>;

export const EffectiveSpec = z.object({
  schema_version: z.literal(1).default(1),
  feature: z.string().min(1),
  /** Requirements after applying overrides, in source-priority order (§4.2). */
  requirements: z.array(Requirement).default([]),
  overrides: z.array(UserOverride).default([]),
  differences: z.array(SpecDifference).default([]),
  /** Docs consulted while resolving (for hashing / traceability). */
  source_docs: z.array(z.string()).default([]),
  confidence: Confidence.default(0.6),
});
export type EffectiveSpec = z.infer<typeof EffectiveSpec>;
