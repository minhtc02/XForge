import { z } from "zod";
import { Confidence, Priority, Severity, TestStatus } from "./enums.js";

/**
 * BugReport, TestEvidence, TestFailure, and performance/visual baselines
 * (blueprint §24, §21.3, §12). Included in Phase 1 so the schema surface is
 * stable for the runner/triage phases; nothing produces bugs yet.
 */

export const TestEvidence = z.object({
  kind: z.enum([
    "screenshot",
    "video",
    "log",
    "xcresult",
    "visual-diff",
    "overlay",
    "figma",
    "source",
  ]),
  path: z.string().min(1),
  description: z.string().optional(),
});
export type TestEvidence = z.infer<typeof TestEvidence>;

export const TestFailure = z.object({
  case_id: z.string().min(1),
  status: TestStatus,
  step_id: z.string().optional(),
  message: z.string().optional(),
  /** Normalized error used for dedup fingerprinting (§25). */
  normalized_error: z.string().optional(),
});
export type TestFailure = z.infer<typeof TestFailure>;

export const BugReport = z.object({
  schema_version: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(["Functional", "Visual", "Accessibility", "Performance"]),
  severity: Severity,
  priority: Priority,
  reproducibility: z.string().optional(),
  feature: z.string().min(1),
  status: z.enum(["Open", "Triaged", "Duplicate"]).default("Open"),
  /** Dedup fingerprint (§25). */
  fingerprint: z.string().min(1),
  environment: z.record(z.string(), z.string()).default({}),
  preconditions: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  expected_result: z.string().optional(),
  actual_result: z.string().optional(),
  evidence: z.array(TestEvidence).default([]),
  related_requirements: z.array(z.string()).default([]),
  impacted_cases: z.array(z.string()).default([]),
  suspected_code: z.array(z.string()).default([]),
  suggested_investigation: z.string().optional(),
  /** Root cause is a hypothesis unless direct evidence exists (§24). */
  confidence: Confidence.default(0.5),
});
export type BugReport = z.infer<typeof BugReport>;

export const PerformanceBaseline = z.object({
  feature: z.string().min(1),
  deviceProfile: z.string().min(1),
  machineProfile: z.string().optional(),
  metrics: z.record(z.string(), z.number()),
  commit: z.string().optional(),
});
export type PerformanceBaseline = z.infer<typeof PerformanceBaseline>;

export const VisualBaseline = z.object({
  feature: z.string().min(1),
  node_id: z.string().min(1),
  device: z.string().optional(),
  snapshot_path: z.string().min(1),
  figma_file_version: z.string().optional(),
  captured_at: z.string().optional(),
});
export type VisualBaseline = z.infer<typeof VisualBaseline>;
