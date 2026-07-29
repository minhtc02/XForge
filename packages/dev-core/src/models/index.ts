import { ValidationError } from "@xforge/shared";
import { formatZodIssues } from "@xforge/core";
import { z } from "zod";
import { DevPlan } from "./plan.js";
import { EffectiveSpec } from "./spec.js";
import { DevRun } from "./run.js";

export * from "./enums.js";
export * from "./spec.js";
export * from "./plan.js";
export * from "./run.js";

/**
 * DevProject ties the Dev module back to the Canonical Project Model
 * (blueprint §2 — reuse, never fork).
 */
export const DevProject = z.object({
  schema_version: z.literal(1).default(1),
  project_id: z.string().min(1),
  project_name: z.string().min(1),
  config_version: z.number().int(),
});
export type DevProject = z.infer<typeof DevProject>;

export function parseDevPlan(input: unknown): DevPlan {
  const result = DevPlan.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Dev plan failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

export function parseEffectiveSpec(input: unknown): EffectiveSpec {
  const result = EffectiveSpec.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Effective spec failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

export function parseDevRun(input: unknown): DevRun {
  const result = DevRun.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Dev run failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

/** Stable, pretty JSON serialization for plan/spec/run artifacts. */
export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
