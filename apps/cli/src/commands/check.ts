import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  hashContent,
  loadConfig,
  readTextFileSafe,
  scanFiles,
  statePath,
} from "@xforge/core";
import { DriftError, ExitCode, type Logger } from "@xforge/shared";
import { emitResult, type CliContext } from "../context.js";

export interface CheckResult {
  drift: boolean;
  changed: string[];
  added: string[];
  removed: string[];
  exitCode: number;
}

/**
 * `xforge docs check` (blueprint §22).
 *
 * Compares current file hashes against the persisted file index. Exit codes:
 *   0 no drift, 1 drift found, 2 config/runtime error (thrown as XForgeError).
 * When `throwOnDrift` is true (CLI default) a {@link DriftError} is thrown so
 * the process exits 1; tests can pass false to inspect the result.
 */
export async function runCheck(
  ctx: CliContext,
  opts: { throwOnDrift?: boolean } = {},
): Promise<CheckResult> {
  const { projectRoot, logger } = ctx;
  const config = await loadConfig(projectRoot);
  const indexPath = statePath(projectRoot, "fileIndex");

  const previous: Record<string, string> = existsSync(indexPath)
    ? (JSON.parse(await readFile(indexPath, "utf8")).files ?? {})
    : {};

  const files = await scanFiles(projectRoot, {
    exclude: [...config.exclude, `${config.output.root}/**`],
  });
  const current: Record<string, string> = {};
  for (const file of files) {
    if (file.sensitive) continue;
    const content = await readTextFileSafe(projectRoot, file.path);
    if (content === null) continue;
    current[file.path] = hashContent(content);
  }

  const changed: string[] = [];
  const added: string[] = [];
  for (const [path, hash] of Object.entries(current)) {
    if (!(path in previous)) added.push(path);
    else if (previous[path] !== hash) changed.push(path);
  }
  const removed = Object.keys(previous).filter((p) => !(p in current));

  const drift = changed.length + added.length + removed.length > 0;
  const result: CheckResult = {
    drift,
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
    exitCode: drift ? ExitCode.OperationalFailure : ExitCode.Success,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderCheck(logger, result),
  );

  if (drift && (opts.throwOnDrift ?? true)) {
    throw new DriftError("Documentation drift detected", {
      details: {
        changed: result.changed,
        added: result.added,
        removed: result.removed,
      },
    });
  }
  return result;
}

function renderCheck(logger: Logger, result: CheckResult): void {
  if (!result.drift) {
    logger.success("No documentation drift detected");
    return;
  }
  process.stderr.write("\nDocumentation drift detected.\n");
  emitList("Changed source files", result.changed);
  emitList("Added files", result.added);
  emitList("Removed files", result.removed);
}

function emitList(title: string, items: string[]): void {
  if (items.length === 0) return;
  process.stderr.write(`\n${title}:\n`);
  for (const item of items) process.stderr.write(`  - ${item}\n`);
}
