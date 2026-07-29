import { z } from "zod";

/**
 * QA Knowledge Model enums (blueprint §20.6, §10, §8).
 *
 * These deliberately separate product failures from infrastructure/environment
 * failures (blueprint §4.4) so bug triage never blames the app for a simulator
 * crash or build problem.
 */

/** Test execution status enum (blueprint §20.6, master prompt §3). */
export const TestStatus = z.enum([
  "PASS",
  "FAIL_FUNCTIONAL",
  "FAIL_VISUAL",
  "FAIL_ACCESSIBILITY",
  "FAIL_PERFORMANCE",
  "FLAKY",
  "BLOCKED",
  "INFRASTRUCTURE_FAILURE",
  "ENVIRONMENT_BLOCKED",
  "SKIPPED",
]);
export type TestStatus = z.infer<typeof TestStatus>;

/** Which statuses represent a genuine product defect (vs infra/env). */
export const PRODUCT_FAILURE_STATUSES: ReadonlySet<TestStatus> = new Set([
  "FAIL_FUNCTIONAL",
  "FAIL_VISUAL",
  "FAIL_ACCESSIBILITY",
  "FAIL_PERFORMANCE",
]);

/** Statuses that are infrastructure/environment problems, never product bugs. */
export const NON_PRODUCT_STATUSES: ReadonlySet<TestStatus> = new Set([
  "BLOCKED",
  "INFRASTRUCTURE_FAILURE",
  "ENVIRONMENT_BLOCKED",
  "SKIPPED",
]);

/** Priority buckets (blueprint §10). */
export const Priority = z.enum(["P0", "P1", "P2", "P3"]);
export type Priority = z.infer<typeof Priority>;

/** Test category types (blueprint §8.2, §9). */
export const TestType = z.enum([
  "functional",
  "persistence",
  "permissions",
  "notifications",
  "visual",
  "accessibility",
  "performance",
]);
export type TestType = z.infer<typeof TestType>;

/** Run levels (blueprint §6.4). */
export const RunLevel = z.enum(["smoke", "critical", "regression", "full"]);
export type RunLevel = z.infer<typeof RunLevel>;

/** Automation framework (blueprint §8.2 automation.framework). */
export const AutomationFramework = z.enum([
  "xcuitest",
  "xctest",
  "manual",
  "none",
]);
export type AutomationFramework = z.infer<typeof AutomationFramework>;

/** Testability analysis mode (blueprint §13.1). */
export const TestabilityMode = z.enum([
  "read-only",
  "test-support",
  "production-modification",
]);
export type TestabilityMode = z.infer<typeof TestabilityMode>;

/** Confidence in [0,1] — mirrors XForge Core's convention. */
export const Confidence = z.number().min(0).max(1);

/** Provenance of a generated artifact — how much to trust it (§6). */
export const Provenance = z.enum([
  "prd",
  "source",
  "existing-test",
  "figma",
  "git-diff",
  "inference",
  "UNKNOWN",
  "INFERRED",
  "NEEDS_CONFIRMATION",
]);
export type Provenance = z.infer<typeof Provenance>;

/** Visual comparison verdicts (blueprint §12.5). */
export const VisualVerdict = z.enum([
  "PASS",
  "VISUAL_WARNING",
  "VISUAL_FAILURE",
  "DESIGN_REFERENCE_MISSING",
  "DESIGN_STATE_UNMAPPED",
]);
export type VisualVerdict = z.infer<typeof VisualVerdict>;

/** Severity for testability issues and bugs. */
export const Severity = z.enum([
  "blocker",
  "critical",
  "major",
  "minor",
  "info",
]);
export type Severity = z.infer<typeof Severity>;
