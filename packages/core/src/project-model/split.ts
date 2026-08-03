import { ProjectModel } from "./schema.js";

/**
 * Core/appendix split for the Canonical Project Model (blueprint §9, §19).
 *
 * The model is what the LLM layer reads *instead of* the repository — that is
 * the whole point of compiling one. On a 5 000-file project the unsplit model
 * reached ~3.9 MB, of which three flat arrays accounted for 59%:
 *
 *   symbols                    10 000 entries   26%
 *   accessibility_identifiers   5 000 entries   18%
 *   source_files                5 000 entries   15%
 *
 * At that size the model stops being a cache and becomes another thing too big
 * to read. These three are per-file inventories: needed by the deterministic
 * generators, almost never needed whole by an agent. So they are persisted
 * beside the core model and merged back only when a caller asks for them.
 *
 * Nothing is lost — `mergeProjectModel(splitProjectModel(m))` round-trips.
 */

/** Model fields persisted separately from the core file. */
export const APPENDIX_FIELDS = [
  "symbols",
  "accessibility_identifiers",
  "source_files",
] as const;

export type AppendixField = (typeof APPENDIX_FIELDS)[number];

/** File name each appendix is written to, relative to the appendix directory. */
export const APPENDIX_FILES: Readonly<Record<AppendixField, string>> = {
  symbols: "symbols.json",
  accessibility_identifiers: "accessibility-identifiers.json",
  source_files: "source-files.json",
};

export interface SplitModel {
  /** The agent-facing model: everything except the per-file inventories. */
  core: ProjectModel;
  /** The extracted inventories, keyed by field name. */
  appendices: Record<AppendixField, unknown[]>;
}

/**
 * Split a model into its core and appendices. The core keeps `appendix_counts`
 * so a reader can tell "5 000 source files, listed separately" from "none" —
 * an empty array with no count would be indistinguishable from a real absence.
 */
export function splitProjectModel(model: ProjectModel): SplitModel {
  const appendices = {} as Record<AppendixField, unknown[]>;
  const counts: Record<string, number> = {};

  for (const field of APPENDIX_FIELDS) {
    const values = model[field] ?? [];
    appendices[field] = values;
    counts[field] = values.length;
  }

  const core: ProjectModel = {
    ...model,
    symbols: [],
    accessibility_identifiers: [],
    source_files: [],
    appendix_counts: counts,
  };
  return { core, appendices };
}

/** Re-attach appendices to a core model. Missing appendices stay empty. */
export function mergeProjectModel(
  core: ProjectModel,
  appendices: Partial<Record<AppendixField, unknown[]>>,
): ProjectModel {
  const merged = { ...core } as Record<string, unknown>;
  for (const field of APPENDIX_FIELDS) {
    const values = appendices[field];
    if (values && values.length > 0) merged[field] = values;
  }
  // Counts describe the split file; a merged model carries the data itself.
  delete merged.appendix_counts;
  return ProjectModel.parse(merged);
}

/**
 * True when this model was loaded from a core file whose appendices were not
 * merged in — so a caller can fail loudly instead of silently seeing zero
 * source files.
 */
export function isCoreOnly(model: ProjectModel): boolean {
  const counts = model.appendix_counts ?? {};
  return APPENDIX_FIELDS.some(
    (field) => (counts[field] ?? 0) > 0 && (model[field] ?? []).length === 0,
  );
}
