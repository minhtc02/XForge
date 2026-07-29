import { runCheck } from "./check.js";
import { runDocs } from "./docs.js";
import { emitResult, type CliContext } from "../context.js";

export interface SyncResult {
  changedBefore: string[];
  addedBefore: string[];
  removedBefore: string[];
  regenerated: boolean;
  modelPath: string;
}

/**
 * `xforge docs sync` (blueprint §21).
 *
 * Detects which files changed since the last generation, then regenerates the
 * Project Model + affected docs. Phase 1 regenerates the deterministic model
 * wholesale but reports the changed set so later phases can scope work to only
 * affected documents.
 */
export async function runSync(ctx: CliContext): Promise<SyncResult> {
  const { logger } = ctx;
  // Non-throwing drift check to learn what changed.
  const check = await runCheck(
    { ...ctx, json: false },
    { throwOnDrift: false },
  );

  if (!check.drift) {
    logger.success("Everything up to date — nothing to sync");
  } else {
    logger.info("Changes detected, regenerating model", {
      changed: check.changed.length,
      added: check.added.length,
      removed: check.removed.length,
    });
  }

  const docs = await runDocs({ ...ctx, json: false }, {});

  const result: SyncResult = {
    changedBefore: check.changed,
    addedBefore: check.added,
    removedBefore: check.removed,
    regenerated: true,
    modelPath: docs.modelPath,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    logger.success("Sync complete"),
  );
  return result;
}
