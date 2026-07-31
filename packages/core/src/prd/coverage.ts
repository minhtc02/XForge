import type { Feature, Requirement, Gap } from "../project-model/schema.js";
import { requirementArea } from "./parser.js";
import { featureId } from "../analysis/features.js";

/**
 * Requirement ↔ feature mapping and coverage/gap analysis (blueprint §12).
 *
 * Deterministic mapping is by *area*: a requirement `PRD-ALARM-001` maps to the
 * feature whose id is `alarm`. This is a conservative structural link; the
 * product-analyst LLM agent can refine ambiguous mappings later. Every mapped
 * requirement's implementation_status is set from whether a matching feature
 * exists and whether that feature has test evidence.
 */

export interface CoverageRow {
  requirement: string;
  description: string;
  feature?: string;
  implemented: boolean;
  tested: boolean;
  status: Requirement["implementation_status"];
}

export interface CoverageResult {
  requirements: Requirement[];
  features: Feature[];
  matrix: CoverageRow[];
  gaps: Gap[];
}

export interface CoverageOptions {
  /**
   * Feature ids mentioned by hand-written documentation. Features outside this
   * set produce the fourth §12 report ("implemented but undocumented"). When
   * omitted the report is skipped entirely rather than reported as empty — an
   * empty report would falsely claim everything is documented.
   */
  documentedFeatures?: ReadonlySet<string>;
}

function featureHasTests(feature: Feature): boolean {
  return feature.evidence.some((e) => e.kind === "test");
}

/**
 * Which features an existing document mentions, by id or display name. Used for
 * the "implemented but undocumented" report — generated output must be excluded
 * by the caller, otherwise the check would satisfy itself.
 */
export function detectDocumentedFeatures(
  features: Feature[],
  documents: Array<{ path: string; content: string }>,
): Set<string> {
  const documented = new Set<string>();
  for (const feature of features) {
    const needles = [feature.id, feature.name, feature.name.replace(/ /g, "")]
      .filter((n) => n.length >= 3)
      .map((n) => n.toLowerCase());
    for (const doc of documents) {
      const haystack = doc.content.toLowerCase();
      if (needles.some((n) => haystack.includes(n))) {
        documented.add(feature.id);
        break;
      }
    }
  }
  return documented;
}

/**
 * Link requirements to features by area, update statuses, attach requirement
 * ids back onto features, and compute the four §12 gap reports.
 */
export function analyzeCoverage(
  requirements: Requirement[],
  features: Feature[],
  options: CoverageOptions = {},
): CoverageResult {
  const featureById = new Map(features.map((f) => [f.id, f]));
  const matrix: CoverageRow[] = [];
  const gaps: Gap[] = [];

  const linkedRequirements = requirements.map((req) => {
    const area = requirementArea(req.id);
    const targetId = area ? featureId(area) : undefined;
    const feature = targetId ? featureById.get(targetId) : undefined;

    let status: Requirement["implementation_status"];
    let tested = false;
    if (feature) {
      tested = featureHasTests(feature);
      status = "IMPLEMENTED";
      if (!feature.requirements.includes(req.id)) {
        feature.requirements.push(req.id);
      }
    } else {
      status = "NOT_IMPLEMENTED";
    }

    matrix.push({
      requirement: req.id,
      description: req.description,
      feature: feature?.id,
      implemented: Boolean(feature),
      tested,
      status,
    });

    // §12: planned but not implemented.
    if (!feature) {
      gaps.push({
        requirement: req.id,
        status: "NOT_IMPLEMENTED",
        kind: "planned-not-implemented",
        description: `Requirement ${req.id} has no matching implemented feature.`,
      });
    } else if (!tested) {
      // §12: implemented but not tested.
      gaps.push({
        requirement: req.id,
        feature: feature.id,
        status: "PARTIALLY_IMPLEMENTED",
        kind: "implemented-not-tested",
        description: `Requirement ${req.id} maps to feature "${feature.id}" but no test evidence was found.`,
      });
    }

    return { ...req, implementation_status: status, feature: feature?.id };
  });

  // §12: implemented but not in PRD — features with zero linked requirements.
  for (const feature of features) {
    if (feature.requirements.length === 0) {
      gaps.push({
        feature: feature.id,
        status: "IMPLEMENTED",
        kind: "implemented-not-in-prd",
        description: `Feature "${feature.id}" is implemented but not referenced by any PRD requirement.`,
      });
    }
  }

  // §12: implemented but undocumented — only when we actually inspected the
  // project's hand-written docs, so the report is never a false empty.
  if (options.documentedFeatures) {
    for (const feature of features) {
      if (options.documentedFeatures.has(feature.id)) continue;
      gaps.push({
        feature: feature.id,
        status: "IMPLEMENTED",
        kind: "implemented-not-documented",
        description: `Feature "${feature.id}" is implemented but no hand-written document mentions it.`,
      });
    }
  }

  return { requirements: linkedRequirements, features, matrix, gaps };
}
