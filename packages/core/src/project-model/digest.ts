import type { ProjectModel } from "./schema.js";

/**
 * A tiny digest of the Canonical Project Model (blueprint §15.3).
 *
 * The core model answers *everything* about a repository, which on a large
 * project is tens of thousands of tokens — more than an agent should spend
 * before it even knows what it is looking for. The digest answers only the
 * orienting questions:
 *
 *   what is this project, what features exist and in what state,
 *   which requirements are unmet, and where should I look next.
 *
 * It is deliberately lossy and says so: every section carries a `see` pointer
 * to the artifact holding the detail, so following up is a targeted read rather
 * than a full one.
 */

export interface ModelDigest {
  schema_version: 1;
  project: {
    id: string;
    name: string;
    type: string;
    platforms: string[];
    languages: string[];
  };
  counts: Record<string, number>;
  /** One line per feature — no file lists, no evidence. */
  features: Array<{
    id: string;
    name: string;
    status: string;
    confidence: number;
    requirements: number;
    files: number;
    doc: string;
  }>;
  /** Only requirements that are not fully implemented — the actionable ones. */
  open_requirements: Array<{
    id: string;
    status: string;
    feature?: string;
  }>;
  gaps_by_kind: Record<string, number>;
  /** Assumptions still needing confirmation (§3.3). */
  needs_confirmation: string[];
  /** Where to read next, by question. */
  see: Record<string, string>;
}

/** Build the digest. Pure; derived entirely from the model. */
export function buildModelDigest(model: ProjectModel): ModelDigest {
  const gapsByKind: Record<string, number> = {};
  for (const gap of model.gaps) {
    const key = gap.kind ?? "other";
    gapsByKind[key] = (gapsByKind[key] ?? 0) + 1;
  }

  const counts: Record<string, number> = {
    features: model.features.length,
    requirements: model.requirements.length,
    principles: model.principles.length,
    technologies: model.technologies.length,
    dependencies: model.dependencies.length,
    data_models: model.data_models.length,
    persistence_entities: model.persistence_entities.length,
    api_endpoints: model.api_endpoints.length,
    analytics_events: model.analytics_events.length,
    permissions: model.permissions.length,
    test_cases: model.test_cases.length,
    gaps: model.gaps.length,
    // Appendix-backed inventories: report the count even when this model was
    // loaded core-only, so a reader is never told "0 source files".
    source_files:
      model.source_files.length || (model.appendix_counts?.source_files ?? 0),
    symbols: model.symbols.length || (model.appendix_counts?.symbols ?? 0),
    accessibility_identifiers:
      model.accessibility_identifiers.length ||
      (model.appendix_counts?.accessibility_identifiers ?? 0),
  };

  return {
    schema_version: 1,
    project: {
      id: model.project.id,
      name: model.project.name,
      type: model.project.type,
      platforms: model.project.platforms,
      languages: model.project.languages,
    },
    counts,
    features: model.features.map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      confidence: f.confidence,
      requirements: f.requirements.length,
      files: f.source_files.length,
      doc: `features/${f.id}.md`,
    })),
    open_requirements: model.requirements
      .filter((r) => r.implementation_status !== "IMPLEMENTED")
      .map((r) => ({
        id: r.id,
        status: r.implementation_status,
        ...(r.feature ? { feature: r.feature } : {}),
      })),
    gaps_by_kind: gapsByKind,
    needs_confirmation: model.assumptions
      .filter((a) => a.needs_confirmation)
      .map((a) => a.description),
    see: {
      full_model: ".xforge/state/project-model.json",
      source_files: ".xforge/state/model/source-files.json",
      symbols: ".xforge/state/model/symbols.json",
      accessibility_identifiers:
        ".xforge/state/model/accessibility-identifiers.json",
      feature_to_files: ".xforge/state/feature-map.json",
      requirement_to_feature: ".xforge/state/requirement-map.json",
      file_to_documents: ".xforge/state/dependency-graph.json",
      traceability: "docs/project/traceability/prd-coverage.md",
      gaps: "docs/project/traceability/implementation-gaps.md",
    },
  };
}

export function serializeModelDigest(digest: ModelDigest): string {
  return JSON.stringify(digest, null, 2) + "\n";
}
