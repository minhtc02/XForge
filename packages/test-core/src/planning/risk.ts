import type { Priority } from "../models/enums.js";

/**
 * Risk-based prioritization (blueprint §10, §4.5).
 *
 * Risk Score = BusinessImpact × FailureLikelihood × RecentChangeFactor ×
 *              RequirementCriticality × CoverageGapFactor
 *
 * Each input is normalized to [0,1]; the product is scaled to [0,10]. Using a
 * product (not a sum) means a single dominant factor — e.g. a business-critical
 * flow — keeps the score high, matching the blueprint's examples (alarm fails
 * to fire ≈ 9.8; icon shifted 2pt ≈ 2.1).
 */

export interface RiskInputs {
  /** How business-critical the flow is, 0..1. */
  businessImpact: number;
  /** Estimated likelihood of failure, 0..1. */
  failureLikelihood: number;
  /** Was the code recently changed? 0..1 (1 = changed this cycle). */
  recentChange: number;
  /** Criticality of the mapped requirement(s), 0..1. */
  requirementCriticality: number;
  /** Coverage gap: 1 = no existing tests, 0 = fully covered. */
  coverageGap: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Compute a 0..10 risk score. Factors are blended with a floor so that a zero
 * in one dimension doesn't annihilate the score (a pure product is too brutal);
 * instead each factor is mapped to [0.35, 1.0] before multiplying, then scaled.
 * Business impact and requirement criticality are weighted highest.
 */
export function computeRiskScore(inputs: RiskInputs): number {
  const floorFactor = (n: number, weight: number): number => {
    const v = clamp01(n);
    // weight in [0,1]: higher weight -> lower floor -> more influence.
    const floor = 1 - weight;
    return floor + (1 - floor) * v;
  };

  const business = floorFactor(inputs.businessImpact, 0.65);
  const likelihood = floorFactor(inputs.failureLikelihood, 0.45);
  const recent = floorFactor(inputs.recentChange, 0.35);
  const requirement = floorFactor(inputs.requirementCriticality, 0.55);
  const coverage = floorFactor(inputs.coverageGap, 0.45);

  const product = business * likelihood * recent * requirement * coverage;
  return Math.round(product * 1000) / 100; // 0..10, two decimals
}

/** Map a risk score to a priority bucket (blueprint §10). */
export function priorityForScore(score: number): Priority {
  if (score >= 8) return "P0";
  if (score >= 6) return "P1";
  if (score >= 3.5) return "P2";
  return "P3";
}

export interface FeatureRiskSignals {
  /** Feature confidence from the Project Model (structural certainty). */
  featureConfidence: number;
  /** Number of requirements mapped to the feature. */
  requirementCount: number;
  /** Does the feature have any test evidence? */
  hasTests: boolean;
  /** Was the feature touched recently (git/status heuristic)? */
  recentlyChanged: boolean;
  /** Does the feature integrate with permissions/notifications/persistence? */
  systemIntegration: boolean;
}

/** Derive normalized risk inputs from feature-level signals (deterministic). */
export function riskInputsFromFeature(signals: FeatureRiskSignals): RiskInputs {
  return {
    businessImpact: signals.systemIntegration ? 0.9 : 0.55,
    failureLikelihood: signals.hasTests ? 0.4 : 0.7,
    recentChange: signals.recentlyChanged ? 1 : 0.3,
    requirementCriticality: Math.min(1, signals.requirementCount / 3),
    coverageGap: signals.hasTests ? 0.25 : 1,
  };
}
