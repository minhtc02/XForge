import type {
  Feature,
  ProjectModel,
  Requirement as ModelRequirement,
} from "@xforge/core";
import type {
  EffectiveSpec,
  Requirement,
  SpecDifference,
  UserOverride,
} from "../models/spec.js";
import { parseEffectiveSpec } from "../models/index.js";
import { detectOverrides, type DocFact } from "./overrides.js";

/**
 * Effective Spec resolver (blueprint §13, §14, §4.2).
 *
 *   Effective Spec = Canonical docs + User overrides + Approved plan
 *
 * Docs are the default source of truth; the current user request overrides docs
 * for this run only, and every divergence is recorded as a SpecDifference for
 * the Staged Spec journal. This function is pure and deterministic.
 */

export interface ResolveEffectiveSpecInput {
  feature: string;
  model: ProjectModel;
  /** Raw user request text (may be empty). */
  request?: string;
  /** Documented facts extracted from docs/spec for override comparison. */
  docFacts?: DocFact[];
  /** Doc paths consulted (for hashing/traceability). */
  sourceDocs?: string[];
}

function featureRequirements(
  model: ProjectModel,
  feature: string,
): ModelRequirement[] {
  const f = model.features.find((x) => x.id === feature);
  const ids = new Set(f?.requirements ?? []);
  return model.requirements.filter((r) => ids.has(r.id));
}

function toDevRequirement(r: ModelRequirement): Requirement {
  return {
    id: r.id,
    description: r.description,
    source: "docs",
    acceptance_criteria: [],
    implementation: [],
    test_source: [],
    feature: r.feature,
    confidence: r.confidence,
  };
}

/** Apply an override onto the requirement set (adds a synthetic req if new). */
function applyOverride(
  requirements: Requirement[],
  override: UserOverride,
): Requirement[] {
  const target = requirements.find(
    (r) =>
      r.id.toLowerCase() === override.target.toLowerCase() ||
      r.description.toLowerCase().includes(override.target.toLowerCase()),
  );
  if (target) {
    // Record the override as an acceptance criterion; source becomes user-request.
    return requirements.map((r) =>
      r === target
        ? {
            ...r,
            source: "user-request" as const,
            acceptance_criteria: [
              ...r.acceptance_criteria,
              `${override.target} = ${override.requested_value} (user override)`,
            ],
          }
        : r,
    );
  }
  // New behavior not tied to an existing requirement.
  return [
    ...requirements,
    {
      id: `REQ-OVERRIDE-${override.id}`,
      description: `${override.target}: ${override.requested_value}`,
      source: "user-request",
      acceptance_criteria: [`${override.target} = ${override.requested_value}`],
      implementation: [],
      test_source: [],
      feature: undefined,
      confidence: 0.6,
    },
  ];
}

export function resolveEffectiveSpec(
  input: ResolveEffectiveSpecInput,
): EffectiveSpec {
  const docReqs = featureRequirements(input.model, input.feature).map(
    toDevRequirement,
  );
  const overrides = input.request
    ? detectOverrides(input.request, input.docFacts ?? [])
    : [];

  let requirements = docReqs;
  for (const ov of overrides) requirements = applyOverride(requirements, ov);

  const differences: SpecDifference[] = overrides.map((ov, i) => ({
    id: `SD-${String(i + 1).padStart(3, "0")}`,
    target: ov.target,
    docs_value: ov.docs_value,
    effective_value: ov.requested_value,
    source: "user-request",
    doc_paths: (input.docFacts ?? [])
      .filter((f) => f.key.toLowerCase() === ov.target.toLowerCase())
      .map((f) => f.doc_path),
    status: "RECORDED",
  }));

  const spec: EffectiveSpec = {
    schema_version: 1,
    feature: input.feature,
    requirements,
    overrides,
    differences,
    source_docs: input.sourceDocs ?? [],
    confidence: requirements.length > 0 ? 0.7 : 0.4,
  };
  return parseEffectiveSpec(spec);
}

/** Feature lookup helper used by the planner. */
export function findFeature(
  model: ProjectModel,
  feature: string,
): Feature | undefined {
  return model.features.find(
    (f) => f.id.toLowerCase() === feature.toLowerCase(),
  );
}
