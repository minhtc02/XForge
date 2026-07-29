import { createHash } from "node:crypto";
import type { TestPlan } from "../models/plan.js";

/**
 * Deterministic plan hashing (blueprint §5.3, §19.2).
 *
 * The hash must be stable regardless of key ordering and must exclude volatile
 * fields (timestamps) so that re-serializing an unchanged plan yields the same
 * hash — this is what lets `approve` bind to a specific plan and `run` detect a
 * stale/mutated plan.
 */

/** Recursively sort object keys so serialization is order-independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

/** Fields excluded from the hash because they are volatile / non-semantic. */
const VOLATILE_KEYS = new Set(["created_at"]);

function stripVolatile(plan: TestPlan): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...plan };
  for (const k of VOLATILE_KEYS) delete copy[k];
  return copy;
}

/** Compute the canonical `sha256:...` hash of a test plan. */
export function hashPlan(plan: TestPlan): string {
  const canonical = canonicalize(stripVolatile(plan));
  const json = JSON.stringify(canonical);
  const digest = createHash("sha256").update(json).digest("hex");
  return `sha256:${digest}`;
}

/** Verify a plan still matches a previously recorded hash (stale detection). */
export function planMatchesHash(plan: TestPlan, expected: string): boolean {
  return hashPlan(plan) === expected;
}
