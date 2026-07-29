import { z } from "zod";

/**
 * Implementation status for features and requirements (blueprint §10.1).
 * These deliberately cover the "not enough evidence" cases so XForge never
 * has to assert something it cannot back with sources.
 */
export const ImplementationStatus = z.enum([
  "IMPLEMENTED",
  "PARTIALLY_IMPLEMENTED",
  "NOT_IMPLEMENTED",
  "UNKNOWN",
  "INFERRED",
  "NEEDS_CONFIRMATION",
  "DEPRECATED",
]);
export type ImplementationStatus = z.infer<typeof ImplementationStatus>;

/**
 * Where a piece of knowledge came from. Used to keep the three kinds of truth
 * distinct (blueprint §3.1): as-intended vs as-built vs project rules.
 */
export const SourceType = z.enum([
  "prompt",
  "config",
  "constitution",
  "prd",
  "speckit",
  "bmad",
  "docs",
  "source",
  "test",
  "runtime",
  "inference",
]);
export type SourceType = z.infer<typeof SourceType>;

/** Kind of evidence pointer. */
export const EvidenceKind = z.enum([
  "source",
  "test",
  "config",
  "doc",
  "prd",
  "manifest",
  "plist",
  "entitlement",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/**
 * Confidence in [0, 1]. Interpretation (blueprint §10.2):
 *   0.90–1.00 direct evidence
 *   0.75–0.89 strong inference
 *   0.50–0.74 weak inference
 *   < 0.50    needs confirmation
 */
export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;
