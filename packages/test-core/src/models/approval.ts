import { z } from "zod";
import { PermissionScope } from "./plan.js";

/**
 * Approval manifest (blueprint §19.2). Written to
 * `.xforge/test/plans/<plan-id>/approval.json` after an explicit, one-time
 * approval. The manifest binds the approval to a specific plan hash so a stale
 * or mutated plan is rejected at run time (blueprint §5.3, master prompt §4).
 */
export const ApprovalManifest = z.object({
  schema_version: z.literal(1).default(1),
  planId: z.string().min(1),
  approved: z.boolean(),
  approvedAt: z.string(),
  approvedBy: z.string().optional(),
  /** `sha256:...` hash of the canonical plan.json at approval time. */
  planHash: z.string().min(1),
  /** Snapshot of the plan's declared inputs, for stale detection. */
  sourceCommit: z.string().optional(),
  configVersion: z.number().int().optional(),
  figmaSnapshotVersion: z.string().optional(),
  workers: z.number().int().nonnegative().default(0),
  permissions: PermissionScope,
});
export type ApprovalManifest = z.infer<typeof ApprovalManifest>;
