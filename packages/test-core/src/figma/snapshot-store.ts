import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DesignSnapshot, FigmaAdapter } from "./adapter.js";

/**
 * Frozen design snapshots (blueprint §11.4).
 *
 * This is the seam between the LLM layer and the deterministic one, and it is
 * the *preferred* way real Figma data reaches XForge.
 *
 * The CLI is a plain Node process: it cannot call the Figma MCP server, which
 * runs on the agent side. But the agent can — so the agent fetches through MCP
 * and writes the result here, and the CLI reads it offline. That ordering is
 * deliberate rather than a workaround:
 *
 *  - Credentials never enter the CLI, CI config, or a log.
 *  - Planning stays reproducible: a plan reads a file, not a live design that
 *    someone might be editing.
 *  - The same file works on a machine with no Figma access at all.
 *
 * The REST adapter exists as a fallback for CI, where no agent is present.
 */

export const SNAPSHOT_FILE = "snapshots.json";

export const StoredSnapshot = z.object({
  node_id: z.string().min(1),
  name: z.string().default(""),
  width: z.number().optional(),
  height: z.number().optional(),
  device: z.string().optional(),
  /** Design tokens: colour, typography, spacing. */
  variables: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .default({}),
  /** Per-element expectations, keyed by accessibility identifier. */
  elements: z
    .record(
      z.string(),
      z.object({
        width: z.number().optional(),
        height: z.number().optional(),
        color: z.string().optional(),
        fontSize: z.number().optional(),
      }),
    )
    .default({}),
  /** Relative path to an exported image, when one was downloaded. */
  screenshot_path: z.string().optional(),
});
export type StoredSnapshot = z.infer<typeof StoredSnapshot>;

export const SnapshotFile = z.object({
  schema_version: z.literal(1).default(1),
  /** Figma file key the snapshots came from. */
  file_key: z.string().default(""),
  /** Figma's own version id — proves which revision was frozen. */
  file_version: z.string().default("unknown"),
  /** How the data was obtained, for provenance in the report. */
  source: z.enum(["mcp", "rest", "fixture"]).default("mcp"),
  captured_at: z.string().default(""),
  snapshots: z.record(z.string(), StoredSnapshot).default({}),
});
export type SnapshotFile = z.infer<typeof SnapshotFile>;

export function snapshotFilePath(
  projectRoot: string,
  planId: string,
  testDir = ".xforge/test",
): string {
  return join(projectRoot, testDir, "design-snapshots", planId, SNAPSHOT_FILE);
}

/** Read frozen snapshots for a plan, or null when none were captured. */
export async function readSnapshots(
  path: string,
): Promise<SnapshotFile | null> {
  if (!existsSync(path)) return null;
  try {
    return SnapshotFile.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    // A malformed snapshot file means "no reference", never a failed run —
    // design data being unusable is an environment condition (§4.4).
    return null;
  }
}

export async function writeSnapshots(
  path: string,
  file: SnapshotFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Capture snapshots for a set of nodes using an adapter (the REST fallback).
 * Nodes the adapter cannot resolve are skipped, not faked.
 */
export async function captureSnapshots(input: {
  adapter: FigmaAdapter;
  nodeIds: string[];
  fileKey: string;
  source: SnapshotFile["source"];
  now?: () => Date;
}): Promise<SnapshotFile> {
  const snapshots: Record<string, StoredSnapshot> = {};
  const captured: DesignSnapshot[] = [];

  for (const nodeId of [...new Set(input.nodeIds)]) {
    const snapshot = await input.adapter.captureSnapshot({ node_id: nodeId });
    if (!snapshot) continue;
    captured.push(snapshot);
    snapshots[nodeId] = {
      node_id: nodeId,
      name: snapshot.metadata.name,
      ...(snapshot.metadata.width !== undefined
        ? { width: snapshot.metadata.width }
        : {}),
      ...(snapshot.metadata.height !== undefined
        ? { height: snapshot.metadata.height }
        : {}),
      ...(snapshot.metadata.device ? { device: snapshot.metadata.device } : {}),
      variables: snapshot.metadata.variables ?? {},
      elements: {},
      screenshot_path: snapshot.screenshot_path,
    };
  }

  return {
    schema_version: 1,
    file_key: input.fileKey,
    file_version: captured[0]?.figma_file_version ?? "unknown",
    source: input.source,
    captured_at: (input.now ?? (() => new Date()))().toISOString(),
    snapshots,
  };
}

/** The template the agent fills in after calling the Figma MCP. */
export function snapshotTemplate(
  nodeIds: string[],
  fileKey: string,
): SnapshotFile {
  return {
    schema_version: 1,
    file_key: fileKey,
    file_version: "unknown",
    source: "mcp",
    captured_at: "",
    snapshots: Object.fromEntries(
      [...new Set(nodeIds)].map((nodeId) => [
        nodeId,
        { node_id: nodeId, name: "", variables: {}, elements: {} },
      ]),
    ),
  };
}

/** Node ids present in the file but never filled in by whoever wrote it. */
export function unresolvedNodes(file: SnapshotFile): string[] {
  return Object.values(file.snapshots)
    .filter((s) => s.width === undefined && s.height === undefined)
    .map((s) => s.node_id)
    .sort();
}
