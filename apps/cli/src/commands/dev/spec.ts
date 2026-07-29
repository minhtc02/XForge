import { writeFile } from "node:fs/promises";
import { readTextFileSafe } from "@xforge/core";
import { ValidationError } from "@xforge/shared";
import {
  dismissStagedSpec,
  planFilePath,
  planSyncDocs,
  renderStagedSpecMarkdown,
  serializeJson,
  type StagedSpec,
} from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";
import { loadPlan } from "./shared.js";

/**
 * Staged Spec journal commands (blueprint §14, §15). The journal is a change
 * log, never a code gate. `inspect-spec` prints it; `sync-docs` applies the
 * proposed patches to docs (drift-protected, appended as a marked block) and
 * marks the journal SYNCED; `dismiss-spec` drops the changes without touching
 * docs. Docs are only ever modified by an explicit `sync-docs` (§4.2).
 */

export async function runDevInspectSpec(
  ctx: CliContext,
  planId: string,
): Promise<StagedSpec> {
  const { staged } = await loadPlan(ctx.projectRoot, planId);
  if (!staged)
    throw new ValidationError(`No Staged Spec found for plan ${planId}.`);
  emitResult(ctx, staged as unknown as Record<string, unknown>, () => {
    process.stdout.write(renderStagedSpecMarkdown(staged) + "\n");
  });
  return staged;
}

export interface DevSyncDocsResult {
  planId: string;
  status: StagedSpec["status"];
  written: string[];
  driftedSkipped: string[];
}

export async function runDevSyncDocs(
  ctx: CliContext,
  planId: string,
): Promise<DevSyncDocsResult> {
  const { staged } = await loadPlan(ctx.projectRoot, planId);
  if (!staged)
    throw new ValidationError(`No Staged Spec found for plan ${planId}.`);

  // Read current doc contents for every doc the journal proposes to patch.
  const currentDocs: Record<string, string> = {};
  for (const patch of staged.proposed_patches) {
    const content = await readTextFileSafe(ctx.projectRoot, patch.doc_path);
    if (content !== null) currentDocs[patch.doc_path] = content;
  }

  const plan = planSyncDocs({ staged, currentDocs });
  const written: string[] = [];
  for (const [docPath, content] of Object.entries(plan.writes)) {
    await writeFile(`${ctx.projectRoot}/${docPath}`, content, "utf8");
    written.push(docPath);
  }
  // Persist the transitioned journal back to the plan.
  await writeFile(
    planFilePath(ctx.projectRoot, planId, "stagedSpec"),
    serializeJson(plan.staged),
    "utf8",
  );

  const result: DevSyncDocsResult = {
    planId,
    status: plan.staged.status,
    written,
    driftedSkipped: plan.driftedSkipped,
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    if (plan.driftedSkipped.length > 0) {
      ctx.logger.warn(
        `Docs drifted since recording; skipped ${plan.driftedSkipped.join(", ")} (journal → CONFLICTED).`,
      );
    } else {
      ctx.logger.success(
        `Synced ${written.length} doc(s); journal → ${plan.staged.status}.`,
      );
    }
  });
  return result;
}

export async function runDevDismissSpec(
  ctx: CliContext,
  planId: string,
): Promise<{ planId: string; status: StagedSpec["status"] }> {
  const { staged } = await loadPlan(ctx.projectRoot, planId);
  if (!staged)
    throw new ValidationError(`No Staged Spec found for plan ${planId}.`);
  const dismissed = dismissStagedSpec(staged);
  await writeFile(
    planFilePath(ctx.projectRoot, planId, "stagedSpec"),
    serializeJson(dismissed),
    "utf8",
  );
  emitResult(ctx, { planId, status: dismissed.status }, () =>
    ctx.logger.info(`Staged Spec for ${planId} dismissed (docs untouched).`),
  );
  return { planId, status: dismissed.status };
}
