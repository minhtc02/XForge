import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  buildApprovalManifest,
  hashPlan,
  parseTestPlan,
  planFilePath,
  serializeJson,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

export interface TestApproveOptions {
  verify?: boolean;
}

export interface TestApproveResult {
  planId: string;
  approved: boolean;
  planHash: string;
  approvalPath: string;
  workers: number;
}

/**
 * `xforge test approve <plan-id>` (blueprint §5.3, §19.2, master prompt §4).
 * Validates the plan exists and is schema-valid, computes its canonical hash,
 * and writes an immutable approval manifest binding approval to that hash.
 * A stale/mutated plan (re-hash mismatch on a prior approval) is refused.
 */
export async function runTestApprove(
  ctx: CliContext,
  planId: string,
  options: TestApproveOptions = {},
): Promise<TestApproveResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge test approve <plan-id>",
    );
  }

  const planPath = planFilePath(projectRoot, planId, "plan");
  if (!existsSync(planPath)) {
    throw new NotFoundError(`Plan ${planId} not found`, {
      details: { planPath },
    });
  }

  const plan = parseTestPlan(JSON.parse(await readFile(planPath, "utf8")));
  if (plan.id !== planId) {
    throw new ValidationError(
      `Plan id mismatch: directory ${planId} contains plan ${plan.id}`,
    );
  }

  const planHash = hashPlan(plan);
  const approvalPath = planFilePath(projectRoot, planId, "approval");

  // If a prior approval exists, verify it still matches (stale detection).
  if (existsSync(approvalPath)) {
    const prior = JSON.parse(await readFile(approvalPath, "utf8")) as {
      planHash?: string;
    };
    if (prior.planHash && prior.planHash !== planHash) {
      throw new ValidationError(
        `Plan ${planId} changed since a prior approval; re-run \`xforge test plan\` to regenerate before approving.`,
        { details: { priorHash: prior.planHash, currentHash: planHash } },
      );
    }
  }

  // --verify only checks; it does not (re)write approval.
  if (options.verify) {
    const result: TestApproveResult = {
      planId,
      approved: existsSync(approvalPath),
      planHash,
      approvalPath,
      workers: plan.shards.length,
    };
    emitResult(ctx, result as unknown as Record<string, unknown>, () => {
      if (result.approved)
        logger.success(`Plan ${planId} is approved and current`);
      else logger.info(`Plan ${planId} is valid but not yet approved`);
    });
    return result;
  }

  const manifest = buildApprovalManifest({ plan });
  await writeFile(approvalPath, serializeJson(manifest), "utf8");

  const result: TestApproveResult = {
    planId,
    approved: true,
    planHash,
    approvalPath,
    workers: manifest.workers,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(`Plan ${planId} approved`);
    process.stderr.write(
      `\n  Plan hash: ${planHash}\n` +
        `  Workers:   ${result.workers}\n` +
        `  Manifest:  ${approvalPath}\n` +
        `\n  Run (Phase 2): xforge test run ${planId}\n`,
    );
  });
  return result;
}
