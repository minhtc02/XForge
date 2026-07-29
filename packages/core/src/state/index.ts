import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * `.xforge/` runtime layout (blueprint §19).
 *
 * State files that are safe to commit live under `state/`; caches and logs live
 * under `cache/` and `logs/` and are gitignored.
 */

export const STATE_DIR = ".xforge";

export const STATE_SUBDIRS = ["cache", "state", "logs"] as const;

export const STATE_FILES = {
  projectModel: "state/project-model.json",
  fileIndex: "state/file-index.json",
  dependencyGraph: "state/dependency-graph.json",
  featureMap: "state/feature-map.json",
  requirementMap: "state/requirement-map.json",
  generationState: "state/generation-state.json",
} as const;

export function stateRoot(projectRoot: string): string {
  return join(projectRoot, STATE_DIR);
}

export function statePath(
  projectRoot: string,
  file: keyof typeof STATE_FILES,
): string {
  return join(projectRoot, STATE_DIR, STATE_FILES[file]);
}

/** Create the `.xforge/` directory skeleton. Idempotent. */
export async function ensureStateDirs(projectRoot: string): Promise<string[]> {
  const created: string[] = [];
  const root = stateRoot(projectRoot);
  await mkdir(root, { recursive: true });
  created.push(root);
  for (const sub of STATE_SUBDIRS) {
    const p = join(root, sub);
    await mkdir(p, { recursive: true });
    created.push(p);
  }
  // Keep the (otherwise-empty, gitignored) dirs present locally.
  await writeFile(join(root, "cache", ".gitkeep"), "");
  await writeFile(join(root, "logs", ".gitkeep"), "");
  return created;
}
