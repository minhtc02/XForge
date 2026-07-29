import type { Feature, ProjectModel, Requirement } from "@xforge/core";
import type { TestCase } from "../models/test-case.js";
import type { RunLevel, TestType, Priority } from "../models/enums.js";
import {
  computeRiskScore,
  priorityForScore,
  riskInputsFromFeature,
} from "./risk.js";

/**
 * Deterministic test-case skeleton generation (blueprint §9, master prompt §6).
 *
 * This produces structured, evidence-linked case skeletons from the Canonical
 * Project Model — happy path + core category cases per feature. The LLM layer
 * (Claude plugin, later phases) enriches steps/expected-results with semantic
 * detail; here we guarantee provenance, requirement links, and risk scores so
 * the plan is trustworthy and never invents requirements (§6).
 */

export interface CaseGenInput {
  model: ProjectModel;
  features: Feature[];
  level: RunLevel;
  recentlyChangedFeatures?: ReadonlySet<string>;
}

/** Category templates per run level (broader levels add more categories). */
const LEVEL_TYPES: Record<RunLevel, TestType[]> = {
  smoke: ["functional"],
  critical: ["functional", "persistence"],
  regression: ["functional", "persistence", "visual", "accessibility"],
  full: [
    "functional",
    "persistence",
    "permissions",
    "notifications",
    "visual",
    "accessibility",
    "performance",
  ],
};

function featureRequirements(
  model: ProjectModel,
  feature: Feature,
): Requirement[] {
  return model.requirements.filter((r) => feature.requirements.includes(r.id));
}

function caseId(feature: string, seq: number): string {
  return `TC-${feature.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${String(seq).padStart(3, "0")}`;
}

/** Generate case skeletons for one feature. */
function casesForFeature(
  model: ProjectModel,
  feature: Feature,
  types: TestType[],
  recentlyChanged: boolean,
): TestCase[] {
  const reqs = featureRequirements(model, feature);
  const hasTests = feature.evidence.some((e) => e.kind === "test");
  const systemIntegration = model.technologies.some((t) =>
    ["notifications", "persistence", "location", "health"].includes(t.category),
  );

  const risk = computeRiskScore(
    riskInputsFromFeature({
      featureConfidence: feature.confidence,
      requirementCount: reqs.length,
      hasTests,
      recentlyChanged,
      systemIntegration,
    }),
  );
  const priority: Priority = priorityForScore(risk);

  const codeRefs = feature.source_files.map((f) => ({ file: f }));
  const entry = feature.entry_points[0];
  const cases: TestCase[] = [];
  let seq = 0;

  const push = (
    title: string,
    caseTypes: TestType[],
    steps: TestCase["steps"],
    expected: string[],
  ): void => {
    seq += 1;
    cases.push({
      id: caseId(feature.id, seq),
      title,
      feature: feature.id,
      types: caseTypes,
      priority,
      risk_score: risk,
      requirements: feature.requirements,
      code_references: codeRefs,
      design_references: [],
      preconditions: ["App freshly launched", "Test-support seed data applied"],
      steps,
      expected_results: expected,
      automation: {
        framework: "xcuitest",
        execution_group: `${feature.id}-core`,
        blocked: false,
      },
      confidence: Math.min(feature.confidence, hasTests ? 0.8 : 0.6),
      provenance: reqs.length > 0 ? ["prd", "source"] : ["source", "INFERRED"],
    });
  };

  // Happy-path functional case (always present).
  push(
    `Launch and open ${feature.name}`,
    ["functional"],
    [
      { id: "step-1", action: "launch-app" },
      {
        id: "step-2",
        action: "open",
        target: entry ? entry.name : `${feature.id}-screen`,
      },
    ],
    [`${feature.name} screen is visible`],
  );

  if (types.includes("persistence")) {
    push(
      `${feature.name} state persists across relaunch`,
      ["functional", "persistence"],
      [
        { id: "step-1", action: "launch-app" },
        { id: "step-2", action: "open", target: `${feature.id}-screen` },
        { id: "step-3", action: "create-item" },
        { id: "step-4", action: "relaunch-app" },
      ],
      ["Previously created item is still present after relaunch"],
    );
  }

  if (types.includes("visual") && feature.entry_points.length > 0) {
    push(
      `${feature.name} matches design reference`,
      ["visual"],
      [
        { id: "step-1", action: "launch-app" },
        { id: "step-2", action: "open", target: `${feature.id}-screen` },
        { id: "step-3", action: "capture-screenshot" },
      ],
      ["UI matches the mapped Figma state within tolerance"],
    );
  }

  if (types.includes("accessibility")) {
    push(
      `${feature.name} is accessible`,
      ["accessibility"],
      [
        { id: "step-1", action: "launch-app" },
        { id: "step-2", action: "open", target: `${feature.id}-screen` },
        { id: "step-3", action: "audit-accessibility" },
      ],
      [
        "Interactive elements have accessibility identifiers and labels",
        "Hit targets meet minimum size",
      ],
    );
  }

  if (types.includes("performance")) {
    push(
      `${feature.name} cold launch performance`,
      ["performance"],
      [{ id: "step-1", action: "measure-cold-launch" }],
      ["Cold launch time within regression threshold of baseline"],
    );
  }

  return cases;
}

/** Generate the full case set for the plan. */
export function generateTestCases(input: CaseGenInput): TestCase[] {
  const types = LEVEL_TYPES[input.level];
  const recent = input.recentlyChangedFeatures ?? new Set<string>();
  return input.features.flatMap((f) =>
    casesForFeature(input.model, f, types, recent.has(f.id)),
  );
}
