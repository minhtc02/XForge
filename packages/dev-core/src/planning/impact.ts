import type { Feature, ProjectModel } from "@xforge/core";
import type { ImpactAnalysis } from "../models/plan.js";
import type { RiskLevel } from "../models/enums.js";

/**
 * Impact analysis (blueprint §11 Impact Analyst). Deterministically estimates
 * the blast radius of implementing a feature: affected files/features and
 * regression/merge-conflict risk, reasoning over the Canonical Project Model.
 */

export interface ImpactInput {
  model: ProjectModel;
  feature: Feature;
}

function overlapsOtherFeatures(
  model: ProjectModel,
  feature: Feature,
): string[] {
  const own = new Set(feature.source_files);
  const affected = new Set<string>();
  for (const other of model.features) {
    if (other.id === feature.id) continue;
    for (const f of other.source_files) {
      if (own.has(f)) affected.add(other.id);
    }
  }
  return [...affected];
}

export function analyzeImpact(input: ImpactInput): ImpactAnalysis {
  const { model, feature } = input;
  const affectedFeatures = overlapsOtherFeatures(model, feature);
  const notes: string[] = [];

  // Regression risk: higher when files are shared and there is no test evidence.
  const hasTests = feature.evidence.some((e) => e.kind === "test");
  let regression: RiskLevel = "low";
  if (affectedFeatures.length > 0 && !hasTests) regression = "high";
  else if (affectedFeatures.length > 0 || !hasTests) regression = "medium";
  if (!hasTests) notes.push("Feature has no existing test evidence.");
  if (affectedFeatures.length > 0)
    notes.push(`Shares files with: ${affectedFeatures.join(", ")}.`);

  // Merge-conflict risk scales with how many files overlap other features.
  const conflict: RiskLevel =
    affectedFeatures.length >= 2
      ? "high"
      : affectedFeatures.length === 1
        ? "medium"
        : "low";

  return {
    affected_files: [...feature.source_files].sort(),
    affected_features: affectedFeatures.sort(),
    regression_risk: regression,
    merge_conflict_risk: conflict,
    notes,
  };
}
