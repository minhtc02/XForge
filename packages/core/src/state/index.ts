import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  APPENDIX_FIELDS,
  APPENDIX_FILES,
  mergeProjectModel,
  splitProjectModel,
  type AppendixField,
} from "../project-model/split.js";
import {
  parseProjectModelJson,
  serializeProjectModel,
} from "../project-model/index.js";
import type { ProjectModel } from "../project-model/schema.js";

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
  modelDigest: "state/model-digest.json",
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

/** Where the model's per-file appendices live (see `project-model/split.ts`). */
export function appendixDir(projectRoot: string): string {
  return join(projectRoot, STATE_DIR, "state", "model");
}

export function appendixPath(
  projectRoot: string,
  field: AppendixField,
): string {
  return join(appendixDir(projectRoot), APPENDIX_FILES[field]);
}

/**
 * Persist the model as a small core file plus per-file appendices.
 *
 * The core is what the LLM layer opens, so it must stay readable; the
 * appendices hold the inventories only the deterministic generators need.
 * Returns every path written.
 */
export async function writeProjectModel(
  projectRoot: string,
  model: ProjectModel,
): Promise<{ corePath: string; appendixPaths: string[] }> {
  const { core, appendices } = splitProjectModel(model);
  const corePath = statePath(projectRoot, "projectModel");
  await mkdir(join(projectRoot, STATE_DIR, "state"), { recursive: true });
  await writeFile(corePath, serializeProjectModel(core), "utf8");

  await mkdir(appendixDir(projectRoot), { recursive: true });
  const appendixPaths: string[] = [];
  for (const field of APPENDIX_FIELDS) {
    const path = appendixPath(projectRoot, field);
    await writeFile(
      path,
      JSON.stringify({ field, entries: appendices[field] }, null, 2) + "\n",
      "utf8",
    );
    appendixPaths.push(path);
  }
  return { corePath, appendixPaths };
}

export interface LoadModelOptions {
  /**
   * Merge the appendices back in. Required by anything that reasons over
   * individual files — doc generation, locator reconciliation, sharding.
   */
  full?: boolean;
}

/**
 * Read the persisted model. Without `full` this returns the core alone, which
 * is cheap and is what an agent wants; with `full` the appendices are merged so
 * the result is identical to what was built in memory.
 */
export async function readProjectModel(
  projectRoot: string,
  options: LoadModelOptions = {},
): Promise<ProjectModel> {
  const core = parseProjectModelJson(
    await readFile(statePath(projectRoot, "projectModel"), "utf8"),
  );
  if (!options.full) return core;

  const appendices: Partial<Record<AppendixField, unknown[]>> = {};
  for (const field of APPENDIX_FIELDS) {
    const path = appendixPath(projectRoot, field);
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as {
        entries?: unknown[];
      };
      if (Array.isArray(raw.entries)) appendices[field] = raw.entries;
    } catch {
      // A corrupt appendix degrades to "not available" rather than aborting;
      // `isCoreOnly` lets callers notice the gap.
      continue;
    }
  }
  return mergeProjectModel(core, appendices);
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
