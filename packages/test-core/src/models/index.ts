import { ValidationError } from "@xforge/shared";
import { formatZodIssues } from "@xforge/core";
import { z } from "zod";
import { TestPlan } from "./plan.js";
import { ApprovalManifest } from "./approval.js";
import { RunResult } from "./result.js";

export * from "./enums.js";
export * from "./test-case.js";
export * from "./navigation.js";
export * from "./review.js";
export * from "./plan.js";
export * from "./approval.js";
export * from "./bug.js";
export * from "./result.js";

/**
 * QAProject ties the QA model back to the Canonical Project Model (blueprint
 * §2.2 — reuse, never fork). It intentionally references the XForge project id
 * rather than duplicating project metadata.
 */
export const QAProject = z.object({
  schema_version: z.literal(1).default(1),
  project_id: z.string().min(1),
  project_name: z.string().min(1),
  config_version: z.number().int(),
});
export type QAProject = z.infer<typeof QAProject>;

/** Parse+validate a TestPlan, throwing a structured ValidationError. */
export function parseTestPlan(input: unknown): TestPlan {
  const result = TestPlan.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Test plan failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

/** Parse+validate an ApprovalManifest. */
export function parseApprovalManifest(input: unknown): ApprovalManifest {
  const result = ApprovalManifest.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Approval manifest failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

/** Parse+validate a RunResult. */
export function parseRunResult(input: unknown): RunResult {
  const result = RunResult.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Run result failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

/** Stable, pretty JSON serialization used for plan/approval artifacts. */
export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
