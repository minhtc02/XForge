import type { Feature, FeatureEntryPoint } from "../project-model/schema.js";
import type { SwiftFileAnalysis, SwiftRole } from "../swift/parser.js";

/**
 * Deterministic feature detection (blueprint §13, Phase 4).
 *
 * Three deterministic tiers (the fourth, LLM classification, is layered on top
 * later by the Claude plugin):
 *   1. Explicit configuration — `features: { alarm: { paths: [...] } }`.
 *   2. Convention detection — a `Features/<Name>/` or `<Name>/` folder whose
 *      files share a common leaf directory.
 *   3. Name-prefix clustering — files sharing a symbol/name prefix
 *      (AlarmView, AlarmViewModel, AlarmScheduler → "Alarm").
 *
 * Every produced feature carries evidence (the source files) and a confidence
 * reflecting which tier detected it (§10.2). Nothing here asserts *behavior* —
 * that is the LLM layer's job; this only groups files structurally.
 */

export interface AnalyzedSource {
  path: string;
  analysis: SwiftFileAnalysis;
}

export interface FeatureDetectionInput {
  sources: AnalyzedSource[];
  /** Explicit `features` map from config: featureId -> path globs. */
  explicit?: Record<string, { paths: string[] }>;
}

const ROLE_ENTRY: Partial<Record<SwiftRole, string>> = {
  view: "view",
  "app-entry": "app",
  coordinator: "coordinator",
};

/** Convert an arbitrary label into a kebab-case feature id. */
export function featureId(label: string): string {
  return (
    label
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "feature"
  );
}

/** Human label from a kebab/prefix id (alarm -> Alarm, habit-alarm -> Habit Alarm). */
export function featureName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function globToRegExp(glob: string): RegExp {
  // Tokenize so `**` (any depth) and `*` (single segment) are unambiguous
  // and the pattern is never built via placeholder characters.
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp("^" + out + "$");
}

function entryPointsFor(files: AnalyzedSource[]): FeatureEntryPoint[] {
  const points: FeatureEntryPoint[] = [];
  for (const f of files) {
    const kind = ROLE_ENTRY[f.analysis.role];
    if (!kind) continue;
    // Prefer a public type, else the first declared type, else the filename.
    const type =
      f.analysis.types.find((t) => t.isPublic) ?? f.analysis.types[0];
    points.push({
      name: type?.name ?? f.path.split("/").pop() ?? f.path,
      kind,
      file: f.path,
    });
  }
  return points;
}

/**
 * Derive a name prefix for clustering. Uses the leading CamelCase word of the
 * primary declared type, falling back to the filename stem's leading word.
 */
function namePrefix(f: AnalyzedSource): string | undefined {
  const roleSuffix =
    /(View|ViewModel|ViewController|Repository|Service|Scheduler|Coordinator|Client|Store|Manager|Screen|Model)$/;
  const typeName =
    f.analysis.types.find((t) => roleSuffix.test(t.name))?.name ??
    f.analysis.types[0]?.name;
  const source =
    typeName ?? (f.path.split("/").pop() ?? "").replace(/\.swift$/, "");
  const stripped = source.replace(roleSuffix, "");
  const match = /^[A-Z][a-z0-9]+/.exec(stripped);
  return match?.[0];
}

/** Build features from analyzed Swift sources. */
export function detectFeatures(input: FeatureDetectionInput): Feature[] {
  const sources = input.sources.filter((s) => s.analysis.role !== "test");
  const assigned = new Set<string>();
  const features: Feature[] = [];

  // Tier 1: explicit config paths.
  for (const [id, cfg] of Object.entries(input.explicit ?? {})) {
    const matchers = cfg.paths.map(globToRegExp);
    const matched = sources.filter((s) =>
      matchers.some((re) => re.test(s.path)),
    );
    if (matched.length === 0) continue;
    matched.forEach((s) => assigned.add(s.path));
    features.push(buildFeature(featureId(id), matched, 0.98, input.sources));
  }

  // Tier 2: convention — group by `Features/<Name>/` or a dedicated subfolder.
  const byConvention = new Map<string, AnalyzedSource[]>();
  for (const s of sources) {
    if (assigned.has(s.path)) continue;
    const conv = conventionFolder(s.path);
    if (!conv) continue;
    const list = byConvention.get(conv) ?? [];
    list.push(s);
    byConvention.set(conv, list);
  }
  for (const [name, files] of byConvention) {
    if (files.length < 2) continue; // a lone file isn't a feature folder
    files.forEach((s) => assigned.add(s.path));
    features.push(buildFeature(featureId(name), files, 0.85, input.sources));
  }

  // Tier 3: name-prefix clustering for whatever remains.
  const byPrefix = new Map<string, AnalyzedSource[]>();
  for (const s of sources) {
    if (assigned.has(s.path)) continue;
    const prefix = namePrefix(s);
    if (!prefix) continue;
    const list = byPrefix.get(prefix) ?? [];
    list.push(s);
    byPrefix.set(prefix, list);
  }
  for (const [prefix, files] of byPrefix) {
    if (files.length < 2) continue;
    files.forEach((s) => assigned.add(s.path));
    features.push(buildFeature(featureId(prefix), files, 0.7, input.sources));
  }

  // Merge features that ended up with the same id (config + convention overlap).
  return mergeById(features);
}

/** The feature folder name for a path like `.../Features/Alarm/AlarmView.swift`. */
function conventionFolder(path: string): string | undefined {
  const parts = path.split("/");
  const idx = parts.findIndex((p) => /^features?$/i.test(p));
  if (idx !== -1 && parts[idx + 1] && idx + 2 < parts.length) {
    return parts[idx + 1];
  }
  return undefined;
}

function buildFeature(
  id: string,
  files: AnalyzedSource[],
  confidence: number,
  allSources: AnalyzedSource[],
): Feature {
  const sourceFiles = files.map((f) => f.path).sort();
  // Include matching tests as evidence when a test @testable-imports the module
  // or lives under a folder matching the feature name.
  const testEvidence = allSources
    .filter(
      (s) =>
        s.analysis.role === "test" &&
        (new RegExp(
          `(^|/)${escapeRe(featureName(id).replace(/ /g, ""))}`,
          "i",
        ).test(s.path) ||
          s.analysis.types.some((t) =>
            t.name.toLowerCase().startsWith(id.replace(/-/g, "")),
          )),
    )
    .map((s) => s.path);

  return {
    id,
    name: featureName(id),
    status: "IMPLEMENTED",
    confidence,
    entry_points: entryPointsFor(files),
    source_files: sourceFiles,
    requirements: [],
    evidence: [
      ...files.map((f) => ({
        file: f.path,
        kind: "source" as const,
        confidence,
        start_line: f.analysis.types[0]?.line,
        description: `Declares ${f.analysis.types.map((t) => t.name).join(", ") || "code"} (${f.analysis.role})`,
      })),
      ...testEvidence.map((path) => ({
        file: path,
        kind: "test" as const,
        confidence: 0.9,
        description: "Test coverage",
      })),
    ],
  };
}

function mergeById(features: Feature[]): Feature[] {
  const byId = new Map<string, Feature>();
  for (const f of features) {
    const existing = byId.get(f.id);
    if (!existing) {
      byId.set(f.id, f);
      continue;
    }
    existing.source_files = [
      ...new Set([...existing.source_files, ...f.source_files]),
    ].sort();
    existing.entry_points = [...existing.entry_points, ...f.entry_points];
    existing.evidence = [...existing.evidence, ...f.evidence];
    existing.confidence = Math.max(existing.confidence, f.confidence);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
