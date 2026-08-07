import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  affectedDocuments,
  loadConfig,
  parseProjectModelJson,
  statePath,
  type DependencyGraph,
} from "@xforge/core";
import { runCheck } from "./check.js";
import { runDocs } from "./docs.js";
import { emitResult, type CliContext } from "../context.js";

export interface SyncResult {
  changedBefore: string[];
  addedBefore: string[];
  removedBefore: string[];
  regenerated: boolean;
  /** True when only the affected subset of documents was rewritten (§21). */
  incremental: boolean;
  /** Documents the change set invalidated, when scoped. */
  affectedDocuments: string[];
  skippedDocuments: number;
  modelPath: string;
}

/**
 * `xforge docs sync` (blueprint §21).
 *
 * Detects which files changed since the last generation, then rebuilds the
 * Project Model and rewrites **only the documents those files invalidate**,
 * using the persisted dependency graph. Falls back to a full generation when
 * there is no prior state, when the change set touches an unclassifiable file,
 * or when the feature set itself changed — correctness before speed.
 */
export async function runSync(ctx: CliContext): Promise<SyncResult> {
  const { projectRoot, logger } = ctx;
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

  const changed = [...check.changed, ...check.added, ...check.removed];
  const scope = await computeScope(projectRoot, changed);

  // `sync` re-runs a decision the user already made: it regenerates what a
  // previous `docs` produced. Asking again on every file change would be noise,
  // so the configured source applies silently.
  const docs = await runDocs(
    { ...ctx, json: false },
    scope ? { onlyDocuments: scope, yes: true } : { yes: true },
  );

  const result: SyncResult = {
    changedBefore: check.changed,
    addedBefore: check.added,
    removedBefore: check.removed,
    regenerated: true,
    incremental: scope !== undefined,
    affectedDocuments: scope ? [...scope].sort() : [],
    skippedDocuments: docs.skippedDocuments,
    modelPath: docs.modelPath,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    if (result.incremental) {
      logger.success(
        `Sync complete — rewrote ${result.affectedDocuments.length} affected document(s), skipped ${result.skippedDocuments}`,
      );
    } else {
      logger.success("Sync complete (full regeneration)");
    }
  });
  return result;
}

/**
 * The set of documents to rewrite, or `undefined` to regenerate everything.
 * Uses the *previous* model + dependency graph, because the change set is
 * expressed in terms of the state the last generation saw.
 */
async function computeScope(
  projectRoot: string,
  changed: string[],
): Promise<Set<string> | undefined> {
  if (changed.length === 0) return undefined;
  const modelPath = statePath(projectRoot, "projectModel");
  if (!existsSync(modelPath)) return undefined;

  let previousModel;
  try {
    previousModel = parseProjectModelJson(await readFile(modelPath, "utf8"));
  } catch {
    return undefined; // unreadable/outdated state — regenerate everything
  }

  const graphPath = statePath(projectRoot, "dependencyGraph");
  let graph: DependencyGraph | undefined;
  if (existsSync(graphPath)) {
    try {
      graph = JSON.parse(await readFile(graphPath, "utf8")) as DependencyGraph;
    } catch {
      graph = undefined;
    }
  }

  const config = await loadConfig(projectRoot);
  // Changes inside the generated tree are our own output, never an input.
  const inputs = changed.filter(
    (p) => !p.startsWith(`${config.output.root}/`) && !p.startsWith(".xforge/"),
  );
  if (inputs.length === 0) return undefined;

  return affectedDocuments(previousModel, inputs, graph);
}
