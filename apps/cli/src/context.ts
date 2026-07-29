import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createLogger, type Logger, type LogLevel } from "@xforge/shared";

/**
 * Shared CLI runtime context: resolved project root, output mode and logger.
 * Commands receive this instead of reaching for globals, which keeps them
 * unit-testable.
 */

export interface GlobalOptions {
  cwd?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export interface CliContext {
  projectRoot: string;
  json: boolean;
  logger: Logger;
}

/** Walk upward from `start` to find a project root (git dir or existing config). */
export function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (
      existsSync(resolve(dir, ".git")) ||
      existsSync(resolve(dir, ".xforge/config.yaml"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the starting directory when no marker is found.
  return resolve(start);
}

export function createContext(options: GlobalOptions): CliContext {
  const cwd = resolve(options.cwd ?? process.cwd());
  const level: LogLevel = options.verbose
    ? "debug"
    : options.quiet
      ? "error"
      : "info";
  const logger = createLogger({
    level,
    format: options.json ? "json" : "text",
  });
  return {
    projectRoot: findProjectRoot(cwd),
    json: Boolean(options.json),
    logger,
  };
}

/**
 * Emit a command result. In JSON mode a single object is printed to stdout; in
 * text mode the provided renderer runs. This keeps machine output clean and
 * separate from stderr logging.
 */
export function emitResult(
  ctx: CliContext,
  payload: Record<string, unknown>,
  renderText: () => void,
): void {
  if (ctx.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    renderText();
  }
}
