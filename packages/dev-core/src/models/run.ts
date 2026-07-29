import { z } from "zod";
import {
  BuildStatus,
  Confidence,
  DevStatus,
  DocsStatus,
  PerformanceStatus,
  TestStatus,
  UIStatus,
} from "./enums.js";

/**
 * DevRun / delivery models (blueprint §9, §21). Included in Phase 1 so the
 * schema surface is stable; the runner produces these in later phases.
 */

export const CodeChange = z.object({
  file: z.string().min(1),
  change: z.enum(["created", "modified", "deleted"]),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
});
export type CodeChange = z.infer<typeof CodeChange>;

export const CommitRecord = z.object({
  sha: z.string().optional(),
  branch: z.string().min(1),
  message: z.string().min(1),
});
export type CommitRecord = z.infer<typeof CommitRecord>;

export const StaticReviewFinding = z.object({
  category: z.string().min(1),
  severity: z.enum(["blocker", "major", "minor", "info"]),
  file: z.string().optional(),
  message: z.string().min(1),
});
export type StaticReviewFinding = z.infer<typeof StaticReviewFinding>;

export const StaticReview = z.object({
  findings: z.array(StaticReviewFinding).default([]),
  passed: z.boolean().default(true),
});
export type StaticReview = z.infer<typeof StaticReview>;

export const IntegrationResult = z.object({
  integration_branch: z.string().min(1),
  merged_branches: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
});
export type IntegrationResult = z.infer<typeof IntegrationResult>;

/** Optional verification results — each defaults to its NOT_REQUESTED status. */
export const OptionalResults = z.object({
  build: BuildStatus.default("NOT_REQUESTED"),
  test: TestStatus.default("NOT_REQUESTED"),
  ui: UIStatus.default("NOT_REQUESTED"),
  performance: PerformanceStatus.default("NOT_REQUESTED"),
});
export type OptionalResults = z.infer<typeof OptionalResults>;

export const DevRun = z.object({
  schema_version: z.literal(1).default(1),
  run_id: z.string().min(1),
  plan_id: z.string().min(1),
  project_id: z.string().min(1),
  started_at: z.string(),
  finished_at: z.string(),
  dry_run: z.boolean().default(true),
  status: DevStatus,
  changes: z.array(CodeChange).default([]),
  commits: z.array(CommitRecord).default([]),
  integration: IntegrationResult.optional(),
  static_review: StaticReview.optional(),
  optional_results: OptionalResults,
  docs_sync: DocsStatus.default("NOT_REQUIRED"),
  spec_differences_recorded: z.number().int().nonnegative().default(0),
  confidence: Confidence.default(0.6),
});
export type DevRun = z.infer<typeof DevRun>;
