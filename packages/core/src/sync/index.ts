import type { ProjectModel } from "../project-model/schema.js";

/**
 * Incremental sync support (blueprint §19 state files, §21 affected-document
 * graph, §22 drift).
 *
 * The pieces here answer one question: *given the set of files that changed,
 * which documents must be rewritten?* Keeping that mapping explicit — and
 * persisted under `.xforge/state/` — is what makes `xforge docs sync` do less
 * work than a full generation instead of quietly regenerating everything.
 */

/** Documents that summarize the whole repository, not one feature. */
export const PROJECT_DOCS = {
  index: "index.md",
  overview: "project-overview.md",
  principles: "principles.md",
  technologyStack: "technology-stack.md",
  architecture: "architecture.md",
  repositoryStructure: "repository-structure.md",
  gettingStarted: "getting-started.md",
  buildAndRelease: "build-and-release.md",
  dataModels: "data/data-models.md",
  persistence: "data/persistence.md",
  migrations: "data/migrations.md",
  api: "integrations/api.md",
  notifications: "integrations/notifications.md",
  analytics: "integrations/analytics.md",
  thirdParty: "integrations/third-party-services.md",
  testingStrategy: "quality/testing-strategy.md",
  security: "quality/security.md",
  accessibility: "quality/accessibility.md",
  performance: "quality/performance.md",
  featureIndex: "features/index.md",
  prdCoverage: "traceability/prd-coverage.md",
  implementationGaps: "traceability/implementation-gaps.md",
  undocumentedCode: "traceability/undocumented-code.md",
  assumptions: "_meta/assumptions.md",
} as const;

export function featureDocPath(featureId: string): string {
  return `features/${featureId}.md`;
}

/** Documents that a Swift source change can invalidate. */
const SWIFT_DOCS: string[] = [
  PROJECT_DOCS.overview,
  PROJECT_DOCS.technologyStack,
  PROJECT_DOCS.architecture,
  PROJECT_DOCS.repositoryStructure,
  PROJECT_DOCS.featureIndex,
  PROJECT_DOCS.dataModels,
  PROJECT_DOCS.persistence,
  PROJECT_DOCS.migrations,
  PROJECT_DOCS.api,
  PROJECT_DOCS.analytics,
  PROJECT_DOCS.testingStrategy,
  PROJECT_DOCS.accessibility,
  PROJECT_DOCS.performance,
  PROJECT_DOCS.undocumentedCode,
  PROJECT_DOCS.implementationGaps,
  PROJECT_DOCS.assumptions,
];

/** Documents a requirement/PRD change can invalidate. */
const PRD_DOCS: string[] = [
  PROJECT_DOCS.overview,
  PROJECT_DOCS.prdCoverage,
  PROJECT_DOCS.implementationGaps,
  PROJECT_DOCS.featureIndex,
  PROJECT_DOCS.assumptions,
];

/** Documents a plist/entitlements change can invalidate. */
const PLIST_DOCS: string[] = [
  PROJECT_DOCS.security,
  PROJECT_DOCS.notifications,
  PROJECT_DOCS.performance,
  PROJECT_DOCS.assumptions,
];

/** Documents a manifest (Package.swift / Podfile) change can invalidate. */
const MANIFEST_DOCS: string[] = [
  PROJECT_DOCS.technologyStack,
  PROJECT_DOCS.thirdParty,
  PROJECT_DOCS.gettingStarted,
  PROJECT_DOCS.buildAndRelease,
];

/** Documents a rules file (constitution / CLAUDE.md) change can invalidate. */
const RULES_DOCS: string[] = [PROJECT_DOCS.principles];

export type ChangeKind =
  "swift" | "prd" | "plist" | "manifest" | "rules" | "docs" | "other";

/** Classify a changed path so we know which document family it feeds. */
export function classifyChange(path: string): ChangeKind {
  if (/(^|\/)Package\.swift$/.test(path)) return "manifest";
  if (path.endsWith(".swift")) return "swift";
  if (/(^|\/)Podfile$/.test(path)) return "manifest";
  if (/Info\.plist$/.test(path) || path.endsWith(".entitlements"))
    return "plist";
  if (/constitution\.md$/i.test(path) || /(^|\/)CLAUDE\.md$/.test(path))
    return "rules";
  if (/prd.*\.md$/i.test(path) || /specs?\//i.test(path)) return "prd";
  if (path.endsWith(".md")) return "docs";
  return "other";
}

/** The per-file → documents map persisted as `dependency-graph.json`. */
export interface DependencyGraph {
  schema_version: 1;
  generated_at: string;
  files: Record<string, { feature?: string; documents: string[] }>;
}

/** Build the affected-document graph from a model (blueprint §21). */
export function buildDependencyGraph(
  model: ProjectModel,
  generatedAt: string,
): DependencyGraph {
  const featureOf = new Map<string, string>();
  for (const f of model.features) {
    for (const path of f.source_files) featureOf.set(path, f.id);
  }

  const files: DependencyGraph["files"] = {};
  for (const source of model.source_files) {
    const feature = featureOf.get(source.path);
    files[source.path] = {
      ...(feature ? { feature } : {}),
      documents: [
        ...SWIFT_DOCS,
        ...(feature ? [featureDocPath(feature)] : []),
      ].sort(),
    };
  }
  return { schema_version: 1, generated_at: generatedAt, files };
}

/**
 * Which documents must be regenerated for a set of changed paths. Returns
 * `undefined` when the change set cannot be scoped (an unknown file kind, or
 * nothing to compare against) so callers fall back to a full generation rather
 * than silently skipping work.
 */
export function affectedDocuments(
  model: ProjectModel,
  changed: string[],
  graph?: DependencyGraph,
): Set<string> | undefined {
  if (changed.length === 0) return new Set();
  const docs = new Set<string>([PROJECT_DOCS.index]);
  const featureOf = new Map<string, string>();
  for (const f of model.features) {
    for (const path of f.source_files) featureOf.set(path, f.id);
  }

  for (const path of changed) {
    switch (classifyChange(path)) {
      case "swift": {
        for (const d of SWIFT_DOCS) docs.add(d);
        const feature = featureOf.get(path) ?? graph?.files[path]?.feature;
        if (feature) docs.add(featureDocPath(feature));
        else {
          // A Swift file we cannot attribute may have moved between features;
          // regenerate every feature document rather than guess.
          for (const f of model.features) docs.add(featureDocPath(f.id));
        }
        break;
      }
      case "prd":
        for (const d of PRD_DOCS) docs.add(d);
        for (const f of model.features) docs.add(featureDocPath(f.id));
        break;
      case "plist":
        for (const d of PLIST_DOCS) docs.add(d);
        break;
      case "manifest":
        for (const d of MANIFEST_DOCS) docs.add(d);
        break;
      case "rules":
        for (const d of RULES_DOCS) docs.add(d);
        break;
      case "docs":
        // Hand-written docs feed the "implemented but undocumented" report.
        docs.add(PROJECT_DOCS.implementationGaps);
        docs.add(PROJECT_DOCS.assumptions);
        break;
      default:
        return undefined; // unknown input kind — regenerate everything
    }
  }
  return docs;
}

/** `feature-map.json` — feature id → its files, entry points and documents. */
export function buildFeatureMap(
  model: ProjectModel,
  generatedAt: string,
): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    features: Object.fromEntries(
      model.features.map((f) => [
        f.id,
        {
          name: f.name,
          status: f.status,
          confidence: f.confidence,
          source_files: f.source_files,
          entry_points: f.entry_points.map((e) => e.name),
          requirements: f.requirements,
          document: featureDocPath(f.id),
        },
      ]),
    ),
  };
}

/** `requirement-map.json` — requirement id → feature, status and documents. */
export function buildRequirementMap(
  model: ProjectModel,
  generatedAt: string,
): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    requirements: Object.fromEntries(
      model.requirements.map((r) => [
        r.id,
        {
          description: r.description,
          source_type: r.source_type,
          implementation_status: r.implementation_status,
          feature: r.feature,
          evidence: r.evidence.map((e) => e.file),
          documents: [
            PROJECT_DOCS.prdCoverage,
            ...(r.feature ? [featureDocPath(r.feature)] : []),
          ],
        },
      ]),
    ),
  };
}

/** `generation-state.json` — what was generated, from which inputs. */
export function buildGenerationState(input: {
  model: ProjectModel;
  writtenFiles: string[];
  generatedAt: string;
  fileCount: number;
  scoped?: string[];
}): Record<string, unknown> {
  return {
    schema_version: 1,
    generator_version: input.model.metadata.generator_version,
    generated_at: input.generatedAt,
    source_commit: input.model.metadata.source_commit,
    input_file_count: input.fileCount,
    /** Present when the run only rewrote part of the tree. */
    scoped_documents: input.scoped ?? null,
    written_files: input.writtenFiles,
  };
}
