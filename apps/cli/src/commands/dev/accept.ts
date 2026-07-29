import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  loadDevConfig,
  parseDevRun,
  runDir,
  serializeJson,
  type DevRun,
} from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";

/**
 * `xforge dev accept|reject <run-id>` (blueprint §7 "User decisions after
 * execution"). Code acceptance is independent from docs sync (§4.4): accepting
 * code never syncs the Staged Spec, and an unsynced spec never blocks
 * acceptance. Accept moves the run to CODE_ACCEPTED; reject to REJECTED. Neither
 * merges into main or modifies the main checkout.
 */

async function loadRun(
  projectRoot: string,
  runsRoot: string,
  runId: string,
): Promise<{ run: DevRun; path: string }> {
  const path = join(runDir(projectRoot, runsRoot, runId), "summary.json");
  if (!existsSync(path)) {
    throw new NotFoundError(`Run ${runId} not found`, { details: { path } });
  }
  return { run: parseDevRun(JSON.parse(await readFile(path, "utf8"))), path };
}

export interface DevDecisionResult {
  runId: string;
  status: DevRun["status"];
  docsSynced: boolean;
}

export async function runDevAccept(
  ctx: CliContext,
  runId: string,
): Promise<DevDecisionResult> {
  if (!runId)
    throw new ValidationError(
      "A run id is required: xforge dev accept <run-id>",
    );
  const config = await loadDevConfig(ctx.projectRoot);
  const { run, path } = await loadRun(ctx.projectRoot, config.runs_root, runId);

  // Code acceptance is independent from spec sync (§4.4). We accept regardless
  // of whether the Staged Spec was synced; docs are never touched here.
  const updated: DevRun = { ...run, status: "CODE_ACCEPTED" };
  await writeFile(path, serializeJson(updated), "utf8");

  const result: DevDecisionResult = {
    runId,
    status: updated.status,
    docsSynced: updated.docs_sync === "SYNCED",
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    ctx.logger.success(`Run ${runId} accepted (CODE_ACCEPTED).`);
    if (run.spec_differences_recorded > 0 && updated.docs_sync !== "SYNCED") {
      process.stderr.write(
        `\n  Note: ${run.spec_differences_recorded} spec difference(s) remain unsynced — this does NOT block acceptance (§4.4).\n` +
          `  Sync with 'xforge dev sync-docs' or drop with 'xforge dev dismiss-spec'.\n`,
      );
    }
  });
  return result;
}

export async function runDevReject(
  ctx: CliContext,
  runId: string,
): Promise<DevDecisionResult> {
  if (!runId)
    throw new ValidationError(
      "A run id is required: xforge dev reject <run-id>",
    );
  const config = await loadDevConfig(ctx.projectRoot);
  const { run, path } = await loadRun(ctx.projectRoot, config.runs_root, runId);
  const updated: DevRun = { ...run, status: "REJECTED" };
  await writeFile(path, serializeJson(updated), "utf8");
  const result: DevDecisionResult = {
    runId,
    status: updated.status,
    docsSynced: false,
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    ctx.logger.info(`Run ${runId} rejected.`);
  });
  return result;
}
