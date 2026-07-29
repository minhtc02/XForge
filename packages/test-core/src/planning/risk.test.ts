import { describe, expect, it } from "vitest";
import {
  computeRiskScore,
  priorityForScore,
  riskInputsFromFeature,
} from "./risk.js";

describe("computeRiskScore", () => {
  it("returns a value in [0,10]", () => {
    const s = computeRiskScore({
      businessImpact: 0.5,
      failureLikelihood: 0.5,
      recentChange: 0.5,
      requirementCriticality: 0.5,
      coverageGap: 0.5,
    });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(10);
  });

  it("scores a business-critical, recently-changed, uncovered flow high (P0)", () => {
    const s = computeRiskScore({
      businessImpact: 1,
      failureLikelihood: 0.9,
      recentChange: 1,
      requirementCriticality: 1,
      coverageGap: 1,
    });
    expect(s).toBeGreaterThanOrEqual(8);
    expect(priorityForScore(s)).toBe("P0");
  });

  it("scores a low-impact, unchanged, covered cosmetic issue low (P3)", () => {
    const s = computeRiskScore({
      businessImpact: 0.1,
      failureLikelihood: 0.2,
      recentChange: 0,
      requirementCriticality: 0.1,
      coverageGap: 0.2,
    });
    expect(s).toBeLessThan(3.5);
    expect(priorityForScore(s)).toBe("P3");
  });

  it("is monotonic in business impact", () => {
    const base = {
      failureLikelihood: 0.5,
      recentChange: 0.5,
      requirementCriticality: 0.5,
      coverageGap: 0.5,
    };
    const low = computeRiskScore({ ...base, businessImpact: 0.2 });
    const high = computeRiskScore({ ...base, businessImpact: 0.9 });
    expect(high).toBeGreaterThan(low);
  });
});

describe("priorityForScore", () => {
  it.each([
    [9, "P0"],
    [8, "P0"],
    [7, "P1"],
    [6, "P1"],
    [4, "P2"],
    [2, "P3"],
  ] as const)("maps %d -> %s", (score, priority) => {
    expect(priorityForScore(score)).toBe(priority);
  });
});

describe("riskInputsFromFeature", () => {
  it("raises coverage gap and likelihood when there are no tests", () => {
    const withTests = riskInputsFromFeature({
      featureConfidence: 0.8,
      requirementCount: 2,
      hasTests: true,
      recentlyChanged: false,
      systemIntegration: false,
    });
    const withoutTests = riskInputsFromFeature({
      featureConfidence: 0.8,
      requirementCount: 2,
      hasTests: false,
      recentlyChanged: false,
      systemIntegration: false,
    });
    expect(withoutTests.coverageGap).toBeGreaterThan(withTests.coverageGap);
    expect(withoutTests.failureLikelihood).toBeGreaterThan(
      withTests.failureLikelihood,
    );
  });
});
