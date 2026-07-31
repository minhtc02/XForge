import { describe, expect, it } from "vitest";
import { parseProjectModel } from "@xforge/core";
import { buildTestPlan } from "./plan-builder.js";
import { defaultTestConfig } from "../config/index.js";
import { hashPlan, planMatchesHash } from "./hash.js";

function samplePlan(seed = "alarm") {
  const model = parseProjectModel({
    project: {
      id: "app",
      name: "App",
      type: "ios-application",
      languages: ["swift"],
    },
    features: [
      {
        id: seed,
        name: seed,
        status: "IMPLEMENTED",
        confidence: 0.8,
        entry_points: [
          { name: `${seed}View`, kind: "view", file: `${seed}View.swift` },
        ],
        source_files: [`${seed}View.swift`],
        requirements: [],
        evidence: [
          { file: `${seed}View.swift`, kind: "source", confidence: 0.8 },
        ],
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
  return buildTestPlan({
    planId: "XFPLAN-20260729-001",
    model,
    config: defaultTestConfig(),
    level: "critical",
    inputs: { config_version: 1 },
    environment: {
      hasUiTestTarget: true,
      hasAccessibilityIdentifiers: true,
      figmaFrameCount: 0,
      existingTestCount: 0,
    },
    createdAt: "2026-07-29T00:00:00.000Z",
  }).plan;
}

describe("hashPlan", () => {
  it("is stable across re-serialization", () => {
    const plan = samplePlan();
    expect(hashPlan(plan)).toBe(hashPlan(structuredClone(plan)));
  });

  it("ignores the volatile created_at field", () => {
    const a = samplePlan();
    const b = { ...structuredClone(a), created_at: "2099-01-01T00:00:00.000Z" };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it("changes when semantic content changes", () => {
    const a = samplePlan("alarm");
    const b = samplePlan("sleep");
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it("is order-independent for object keys", () => {
    const plan = samplePlan();
    // Rebuild the top-level object with keys in reverse insertion order; the
    // canonicalizing hash must be unaffected by key order.
    const reordered = Object.fromEntries(
      Object.entries(structuredClone(plan)).reverse(),
    ) as typeof plan;
    expect(planMatchesHash(reordered, hashPlan(plan))).toBe(true);
  });

  it("produces a sha256-prefixed digest", () => {
    expect(hashPlan(samplePlan())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
