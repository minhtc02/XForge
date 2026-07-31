import { z } from "zod";
import { Confidence, TestStatus, VisualVerdict } from "./enums.js";
import { TestEvidence } from "./bug.js";

/**
 * Run-time result models (blueprint §20.6, §23). Produced by the execution
 * engine + xcresult parser and consumed by triage/reporting.
 */

/** One case's execution result on a specific shard. */
export const TestExecution = z.object({
  case_id: z.string().min(1),
  shard_id: z.string().optional(),
  status: TestStatus,
  duration_ms: z.number().nonnegative().default(0),
  step_id: z.string().optional(),
  message: z.string().optional(),
  /** Normalized error for dedup fingerprinting (§25). */
  normalized_error: z.string().optional(),
  /** Number of infrastructure retries consumed. */
  retries: z.number().int().nonnegative().default(0),
  evidence: z.array(TestEvidence).default([]),
  visual_verdict: VisualVerdict.optional(),
  /**
   * Who decided this status. `xcuitest` is the test process itself; the others
   * are XForge layers that may *escalate* a result after the fact. Recorded so a
   * reader can tell a deterministic assertion failure from a probabilistic
   * judgement and re-check the latter (§4.3).
   */
  verdict_source: z
    .enum(["xcuitest", "visual-agent", "probe"])
    .default("xcuitest"),
});
export type TestExecution = z.infer<typeof TestExecution>;

export const RunStats = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  infrastructure: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type RunStats = z.infer<typeof RunStats>;

/** The full result of a run (blueprint §23 summary.json). */
export const RunResult = z.object({
  schema_version: z.literal(1).default(1),
  run_id: z.string().min(1),
  plan_id: z.string().min(1),
  project_id: z.string().min(1),
  started_at: z.string(),
  finished_at: z.string(),
  dry_run: z.boolean().default(false),
  executions: z.array(TestExecution).default([]),
  stats: RunStats,
  /** Whether the whole run should be considered a pass gate. */
  gate_passed: z.boolean(),
});
export type RunResult = z.infer<typeof RunResult>;

/** A row in a coverage report (requirement/feature/design). */
export const CoverageEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(["requirement", "feature", "design"]),
  covered: z.boolean(),
  passed: z.boolean().optional(),
  case_ids: z.array(z.string()).default([]),
});
export type CoverageEntry = z.infer<typeof CoverageEntry>;

export const CoverageReport = z.object({
  requirement: z.array(CoverageEntry).default([]),
  feature: z.array(CoverageEntry).default([]),
  design: z.array(CoverageEntry).default([]),
  confidence: Confidence.default(1),
});
export type CoverageReport = z.infer<typeof CoverageReport>;
