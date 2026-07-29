import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { globby } from "globby";
import { isSensitiveFile } from "../redaction/index.js";
import { DEFAULT_EXCLUDES } from "../configuration/schema.js";

/**
 * Deterministic file-tree scanner (blueprint §15.1).
 *
 * Applies ignore rules and skips sensitive files entirely. Never returns the
 * contents of a sensitive file; callers that need file bytes must go through
 * {@link readTextFileSafe} which refuses sensitive paths.
 */

export interface ScanOptions {
  /** Extra ignore globs merged with the built-in defaults. */
  exclude?: string[];
  /** Restrict to these globs (default: everything not excluded). */
  include?: string[];
  /** Follow into hidden dot-directories? Defaults to false. */
  dot?: boolean;
}

export interface ScannedFile {
  /** Path relative to the scanned root, POSIX separators. */
  path: string;
  size: number;
  /** True when the file is sensitive and its contents were not read. */
  sensitive: boolean;
}

/** Scan a project root, returning metadata for every non-excluded file. */
export async function scanFiles(
  root: string,
  options: ScanOptions = {},
): Promise<ScannedFile[]> {
  const patterns = options.include ?? ["**/*"];
  const ignore = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const entries = await globby(patterns, {
    cwd: root,
    ignore,
    dot: options.dot ?? true,
    onlyFiles: true,
    followSymbolicLinks: false,
    gitignore: false,
  });
  const files: ScannedFile[] = [];
  for (const rel of entries.sort()) {
    const abs = join(root, rel);
    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      continue;
    }
    files.push({
      path: rel.split("\\").join("/"),
      size,
      sensitive: isSensitiveFile(rel),
    });
  }
  return files;
}

/**
 * Read a text file, refusing sensitive paths. Returns null for sensitive files
 * so callers can safely `?? ""` without ever seeing secret contents.
 */
export async function readTextFileSafe(
  root: string,
  relPath: string,
): Promise<string | null> {
  if (isSensitiveFile(relPath)) return null;
  try {
    return await readFile(join(root, relPath), "utf8");
  } catch {
    return null;
  }
}

/** Compute a stable content hash for change detection (blueprint §21). */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Relative POSIX path helper. */
export function toPosixRelative(root: string, abs: string): string {
  return relative(root, abs).split("\\").join("/");
}
