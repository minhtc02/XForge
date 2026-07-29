import { createHash } from "node:crypto";
import type { DevPlan } from "../models/plan.js";

/**
 * Deterministic plan hashing (blueprint §16, master prompt §Phase 1 "save input
 * hashes"). Stable regardless of key order; excludes volatile fields so an
 * unchanged plan re-hashes identically (enables approval binding / drift).
 */

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort())
      sorted[key] = canonicalize(obj[key]);
    return sorted;
  }
  return value;
}

const VOLATILE_KEYS = new Set(["created_at"]);

export function hashDevPlan(plan: DevPlan): string {
  const copy: Record<string, unknown> = { ...plan };
  for (const k of VOLATILE_KEYS) delete copy[k];
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize(copy)))
    .digest("hex");
  return `sha256:${digest}`;
}

export function devPlanMatchesHash(plan: DevPlan, expected: string): boolean {
  return hashDevPlan(plan) === expected;
}
