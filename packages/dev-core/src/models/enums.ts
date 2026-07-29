import { z } from "zod";

/**
 * XForge Dev status enums (blueprint §9).
 *
 * The defining rule of this module: optional verification actions default to
 * NOT_REQUESTED and docs to NOT_REQUIRED. XForge Dev only implements code by
 * default — build/test/UI/performance/docs-sync are opt-in (§4.1, §19, §27).
 */

/** Overall development lifecycle status (blueprint §9). */
export const DevStatus = z.enum([
  "PLANNED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "CODING",
  "CODE_COMPLETED",
  "READY_FOR_CODE_REVIEW",
  "CODE_ACCEPTED",
  "REJECTED",
  "BLOCKED",
  "PARTIALLY_COMPLETED",
  "CANCELLED",
]);
export type DevStatus = z.infer<typeof DevStatus>;

/** Build status — defaults to NOT_REQUESTED (§9, §19). */
export const BuildStatus = z.enum([
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "PASSED",
  "FAILED",
  "BLOCKED",
]);
export type BuildStatus = z.infer<typeof BuildStatus>;

/** Test status — defaults to NOT_REQUESTED. */
export const TestStatus = z.enum([
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "PASSED",
  "FAILED",
  "PARTIAL",
  "BLOCKED",
]);
export type TestStatus = z.infer<typeof TestStatus>;

/** UI verification status — defaults to NOT_REQUESTED. */
export const UIStatus = z.enum([
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "MATCHED",
  "DIFFERENCES_FOUND",
  "BLOCKED",
]);
export type UIStatus = z.infer<typeof UIStatus>;

/** Performance status — defaults to NOT_REQUESTED. */
export const PerformanceStatus = z.enum([
  "NOT_REQUESTED",
  "PENDING",
  "RUNNING",
  "PASSED",
  "REGRESSION_FOUND",
  "BLOCKED",
]);
export type PerformanceStatus = z.infer<typeof PerformanceStatus>;

/** Docs sync status — defaults to NOT_REQUIRED (§9, §14). */
export const DocsStatus = z.enum([
  "NOT_REQUIRED",
  "RECORDED",
  "NOT_SYNCED",
  "SYNCED",
  "DISMISSED",
  "CONFLICTED",
]);
export type DocsStatus = z.infer<typeof DocsStatus>;

/** Staged Spec journal status (blueprint §14). */
export const SpecStatus = z.enum([
  "RECORDED",
  "NOT_SYNCED",
  "SYNCED",
  "DISMISSED",
  "CONFLICTED",
]);
export type SpecStatus = z.infer<typeof SpecStatus>;

/** Per-task/group implementation status. */
export const TaskStatus = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "OUT_OF_SCOPE",
  "BLOCKED",
  "SKIPPED",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** Operating mode (blueprint §5). */
export const DevMode = z.enum(["plan-first", "auto"]);
export type DevMode = z.infer<typeof DevMode>;

/** Where a spec/requirement fact comes from — source-of-truth order (§4.2). */
export const SpecSource = z.enum([
  "user-request",
  "approved-plan",
  "docs",
  "constitution",
  "figma",
  "reference-image",
  "source",
  "existing-test",
  "inference",
]);
export type SpecSource = z.infer<typeof SpecSource>;

/** Confidence in [0,1] — mirrors XForge Core. */
export const Confidence = z.number().min(0).max(1);

/** Risk level for impact analysis. */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;
