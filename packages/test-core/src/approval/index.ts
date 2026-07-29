import { ValidationError } from "@xforge/shared";
import type { ApprovalManifest } from "../models/approval.js";
import { parseApprovalManifest } from "../models/index.js";
import type { TestPlan } from "../models/plan.js";
import { hashPlan, planMatchesHash } from "../planning/hash.js";

/**
 * Approval manifest creation + stale detection (blueprint §5.3, §19.2,
 * master prompt §4). Approval binds to a plan hash so a mutated or stale plan
 * is rejected before any run.
 */

export interface ApproveInput {
  plan: TestPlan;
  approvedBy?: string;
  approvedAt?: string;
}

/** Build an approval manifest for a plan (records the plan hash + scope). */
export function buildApprovalManifest(input: ApproveInput): ApprovalManifest {
  const planHash = hashPlan(input.plan);
  const manifest: ApprovalManifest = {
    schema_version: 1,
    planId: input.plan.id,
    approved: true,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    approvedBy: input.approvedBy,
    planHash,
    sourceCommit: input.plan.inputs.source_commit,
    configVersion: input.plan.inputs.config_version,
    figmaSnapshotVersion: input.plan.inputs.figma_snapshot_version,
    workers: input.plan.shards.length,
    permissions: input.plan.permissions,
  };
  return parseApprovalManifest(manifest);
}

export type StaleReason =
  "not-approved" | "plan-hash-mismatch" | "plan-id-mismatch";

export interface ApprovalCheck {
  valid: boolean;
  reason?: StaleReason;
}

/**
 * Validate that an approval manifest still authorizes running a given plan.
 * Used by the (future) run command and by `approve --verify`.
 */
export function verifyApproval(
  plan: TestPlan,
  manifest: ApprovalManifest,
): ApprovalCheck {
  if (!manifest.approved) return { valid: false, reason: "not-approved" };
  if (manifest.planId !== plan.id)
    return { valid: false, reason: "plan-id-mismatch" };
  if (!planMatchesHash(plan, manifest.planHash))
    return { valid: false, reason: "plan-hash-mismatch" };
  return { valid: true };
}

/** Throwing variant used at the run boundary. */
export function assertApproval(
  plan: TestPlan,
  manifest: ApprovalManifest,
): void {
  const check = verifyApproval(plan, manifest);
  if (!check.valid) {
    throw new ValidationError(
      `Plan ${plan.id} is not validly approved (${check.reason})`,
      { details: { reason: check.reason } },
    );
  }
}
