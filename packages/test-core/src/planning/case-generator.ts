import type { Feature, ProjectModel, Requirement } from "@xforge/core";
import type { TestCase, TestStep } from "../models/test-case.js";
import type { NavigationGraph } from "../models/navigation.js";
import type { RunLevel, TestType, Priority } from "../models/enums.js";
import { nodeForFeature, shortestPath, stepsForPath } from "./navigation.js";
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
  /** Navigation graph used to derive the prefix that reaches each screen (§A). */
  navigation?: {
    graph: NavigationGraph;
    minEdgeConfidence?: number;
    maxPathLength?: number;
  };
}

/** Navigation prefix for a feature, or `undefined` when it is unreachable. */
function navigationPrefix(
  input: CaseGenInput,
  feature: Feature,
): { steps: TestStep[]; anchor: string; confidence: number } | undefined {
  const nav = input.navigation;
  const fallbackAnchor =
    feature.entry_points[0]?.name ?? `${feature.id}-screen`;
  if (!nav) {
    // No graph: keep the original single-hop behaviour.
    return {
      steps: [{ id: "step-2", action: "open", target: fallbackAnchor }],
      anchor: fallbackAnchor,
      confidence: 0.6,
    };
  }

  const node = nodeForFeature(nav.graph, feature.id);
  if (!node) return undefined;
  const path = shortestPath(nav.graph, nav.graph.root, node.id, {
    minEdgeConfidence: nav.minEdgeConfidence,
    maxPathLength: nav.maxPathLength,
  });
  if (!path) return undefined;

  const { steps } = stepsForPath(path, 2);
  return { steps, anchor: node.anchor, confidence: path.confidence };
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
  navInput: CaseGenInput,
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
    assertions: TestCase["assertions"] = [],
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
      assertions,
      automation: {
        framework: "xcuitest",
        execution_group: `${feature.id}-core`,
        blocked: false,
      },
      confidence: Math.min(feature.confidence, hasTests ? 0.8 : 0.6),
      provenance: reqs.length > 0 ? ["prd", "source"] : ["source", "INFERRED"],
    });
  };

  // The navigation prefix: BFS-derived when a graph is available, otherwise the
  // single-hop fallback. `undefined` means the screen is unreachable — every
  // case for this feature is then blocked rather than given a guessed path.
  const prefix = navigationPrefix(navInput, feature);
  if (!prefix) return [];
  const anchor = prefix.anchor;
  const launch: TestStep = { id: "step-1", action: "launch-app" };
  const nav = prefix.steps;
  const afterNav = nav.length + 2;
  void entry;

  // Happy-path functional case (always present).
  const visibleExpectation = `${feature.name} screen is visible`;
  push(
    `Launch and open ${feature.name}`,
    ["functional"],
    [launch, ...nav],
    [visibleExpectation],
    [
      {
        id: "assert-1",
        kind: "screen-is",
        target: anchor,
        source_text: visibleExpectation,
      },
    ],
  );

  if (types.includes("persistence")) {
    const persistExpectation =
      "Previously created item is still present after relaunch";
    push(
      `${feature.name} state persists across relaunch`,
      ["functional", "persistence"],
      [
        launch,
        ...nav,
        { id: `step-${afterNav}`, action: "create-item" },
        { id: `step-${afterNav + 1}`, action: "relaunch-app" },
      ],
      [persistExpectation],
      [
        {
          id: "assert-1",
          kind: "exists",
          target: anchor,
          source_text: persistExpectation,
        },
      ],
    );
  }

  if (types.includes("visual") && feature.entry_points.length > 0) {
    // The visual verdict is decided by the analyzer from the captured image;
    // the in-test assertion only proves the screen we captured was the right
    // one, so a mis-navigated capture cannot silently pass.
    const onScreen = `${feature.name} screen is on display when captured`;
    push(
      `${feature.name} matches design reference`,
      ["visual"],
      [
        launch,
        ...nav,
        {
          id: `step-${afterNav}`,
          action: "capture-screenshot",
          target: anchor,
        },
      ],
      [onScreen, "UI matches the mapped Figma state within tolerance"],
      [
        {
          id: "assert-1",
          kind: "screen-is",
          target: anchor,
          source_text: onScreen,
        },
      ],
    );
  }

  if (types.includes("accessibility")) {
    const reachable = `${feature.name} screen is reachable for the audit`;
    push(
      `${feature.name} is accessible`,
      ["accessibility"],
      [
        launch,
        ...nav,
        { id: `step-${afterNav}`, action: "audit-accessibility" },
      ],
      [
        reachable,
        "Interactive elements have accessibility identifiers and labels",
        "Hit targets meet minimum size",
      ],
      [
        {
          id: "assert-1",
          kind: "screen-is",
          target: anchor,
          source_text: reachable,
        },
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

export interface CaseGenResult {
  cases: TestCase[];
  /** Features the navigation graph could not reach — reported, never guessed. */
  unreachableFeatures: string[];
}

/** Generate the full case set for the plan. */
export function generateTestCases(input: CaseGenInput): TestCase[] {
  return generateTestCasesWithDiagnostics(input).cases;
}

/** Case generation plus the features it had to skip. */
export function generateTestCasesWithDiagnostics(
  input: CaseGenInput,
): CaseGenResult {
  const types = LEVEL_TYPES[input.level];
  const recent = input.recentlyChangedFeatures ?? new Set<string>();
  const cases: TestCase[] = [];
  const unreachable: string[] = [];

  for (const feature of input.features) {
    const generated = casesForFeature(
      input.model,
      feature,
      types,
      recent.has(feature.id),
      input,
    );
    if (generated.length === 0) {
      unreachable.push(feature.id);
      continue;
    }
    cases.push(...generated);
  }
  return { cases, unreachableFeatures: unreachable };
}
