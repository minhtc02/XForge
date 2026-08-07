import { describe, expect, it } from "vitest";
import { ValidationError } from "@xforge/shared";
import { applyPlanReview } from "./apply-review.js";
import { hashPlan } from "./hash.js";
import { parsePlanReview } from "../models/review.js";
import { parseTestPlan } from "../models/index.js";
import type { TestPlan } from "../models/plan.js";

/**
 * The write-back path is the one place an agent's judgement changes an artifact
 * that gets executed, so the guard rails matter more than the merge arithmetic:
 * evidence is mandatory, a stale review is refused, and no review may empty the
 * plan.
 */

function plan(): TestPlan {
  return parseTestPlan({
    schema_version: 1,
    id: "XFPLAN-20260807-001",
    project_id: "demo",
    created_at: "2026-08-07T00:00:00.000Z",
    level: "smoke",
    test_cases: [
      {
        id: "TC-HOME-001",
        title: "Launch and open Home",
        feature: "home",
        types: ["functional"],
        priority: "P1",
        risk_score: 6,
        requirements: ["PRD-HOME-001"],
        steps: [
          { id: "step-1", action: "launch-app" },
          { id: "step-2", action: "open", target: "category-detail" },
        ],
        expected_results: ["Home screen is visible"],
        assertions: [
          { id: "assert-1", kind: "screen-is", target: "category-detail" },
        ],
        automation: { framework: "xcuitest", execution_group: "home-core" },
        confidence: 0.6,
        provenance: ["source"],
      },
      {
        id: "TC-HOME-002",
        title: "Home state persists across relaunch",
        feature: "home",
        types: ["functional", "persistence"],
        priority: "P1",
        risk_score: 6,
        requirements: [],
        steps: [
          { id: "step-1", action: "launch-app" },
          { id: "step-2", action: "create-item" },
        ],
        expected_results: ["Item persists"],
        assertions: [{ id: "assert-1", kind: "exists", target: "row" }],
        automation: { framework: "xcuitest", execution_group: "home-core" },
        confidence: 0.6,
        provenance: ["source"],
      },
    ],
    suites: [
      {
        id: "suite-home",
        name: "Home suite",
        feature: "home",
        case_ids: ["TC-HOME-001", "TC-HOME-002"],
      },
    ],
    shards: [
      {
        id: "shard-1",
        simulator_name: "XForge-iPhone15Pro-Worker-01",
        device: "iPhone 15 Pro",
        case_ids: ["TC-HOME-001", "TC-HOME-002"],
      },
    ],
    testability_issues: [],
    permissions: {},
    estimated_duration: { min_minutes: 1, max_minutes: 2 },
    stats: { total_cases: 2, suites: 1, shards: 1 },
    inputs: { config_version: 1 },
  });
}

const evidence = [
  {
    file: "App/CategoryDetailScreen.swift",
    start_line: 12,
    detail: "only match is the declaration",
  },
];

describe("applyPlanReview", () => {
  it("drops a case that tests dead code and keeps the plan consistent", () => {
    const p = plan();
    const result = applyPlanReview({
      plan: p,
      review: parsePlanReview({
        plan_id: p.id,
        reviewed_plan_hash: hashPlan(p),
        cases: [
          {
            case_id: "TC-HOME-002",
            verdict: "drop",
            rationale: "Home has no create action; template artifact.",
            evidence,
          },
        ],
      }),
    });

    expect(result.plan.test_cases.map((c) => c.id)).toEqual(["TC-HOME-001"]);
    // Suites, shards and stats follow the case set, not the other way round.
    expect(result.plan.suites[0]?.case_ids).toEqual(["TC-HOME-001"]);
    expect(result.plan.shards[0]?.case_ids).toEqual(["TC-HOME-001"]);
    expect(result.plan.stats.total_cases).toBe(1);
    expect(result.applied.dropped).toEqual(["TC-HOME-002"]);
  });

  it("retargets a case's steps and assertions to the real screen", () => {
    const p = plan();
    const result = applyPlanReview({
      plan: p,
      review: parsePlanReview({
        plan_id: p.id,
        reviewed_plan_hash: hashPlan(p),
        cases: [
          {
            case_id: "TC-HOME-001",
            verdict: "retarget",
            rationale:
              "The live home screen is HomeScreen, not CategoryDetail.",
            evidence,
            new_anchor: "home-lesson-list",
          },
        ],
      }),
    });

    const c = result.plan.test_cases.find((x) => x.id === "TC-HOME-001")!;
    expect(c.steps.find((s) => s.action === "open")?.target).toBe(
      "home-lesson-list",
    );
    expect(c.assertions[0]?.target).toBe("home-lesson-list");
    expect(result.applied.retargeted).toEqual(["TC-HOME-001"]);
  });

  it("adds a reviewer case that inherits provenance instead of asserting it", () => {
    const p = plan();
    const result = applyPlanReview({
      plan: p,
      review: parsePlanReview({
        plan_id: p.id,
        reviewed_plan_hash: hashPlan(p),
        added_cases: [
          {
            slug: "open-lesson",
            title: "Opening a lesson shows the ArtTrace canvas",
            feature: "home",
            rationale: "This is what HomeScreen actually does.",
            evidence: [{ file: "App/HomeScreen.swift", start_line: 393 }],
            steps: [{ id: "step-1", action: "launch-app" }],
            expected_results: ["Canvas is visible"],
            assertions: [
              { id: "assert-1", kind: "screen-is", target: "art-trace-canvas" },
            ],
          },
        ],
      }),
    });

    const added = result.plan.test_cases.find((c) =>
      c.id.endsWith("OPEN-LESSON"),
    )!;
    expect(added.provenance).toEqual(["review"]);
    // Inherited from the sibling, not invented by the reviewer.
    expect(added.requirements).toEqual(["PRD-HOME-001"]);
    expect(added.priority).toBe("P1");
    // It joins its feature's existing shard rather than creating a new one.
    expect(result.plan.shards[0]?.case_ids).toContain(added.id);
  });

  it("records every verdict in the plan so the reasoning survives", () => {
    const p = plan();
    const result = applyPlanReview({
      plan: p,
      review: parsePlanReview({
        plan_id: p.id,
        reviewed_plan_hash: hashPlan(p),
        summary: "One screen was dead.",
        cases: [
          {
            case_id: "TC-HOME-002",
            verdict: "drop",
            rationale: "No create action.",
            evidence,
          },
        ],
        navigation_findings: [
          {
            screen: "CategoryDetailScreen",
            reachable: false,
            rationale: "Nothing presents it.",
            evidence,
          },
        ],
      }),
    });

    const applied = result.plan.applied_reviews[0]!;
    expect(applied.summary).toBe("One screen was dead.");
    expect(applied.verdicts[0]?.rationale).toBe("No create action.");
    expect(applied.navigation_findings[0]?.screen).toBe("CategoryDetailScreen");
    expect(applied.previous_plan_hash).toBe(hashPlan(p));
  });

  it("changes the plan hash, so a prior approval goes stale", () => {
    const p = plan();
    const before = hashPlan(p);
    const result = applyPlanReview({
      plan: p,
      review: parsePlanReview({
        plan_id: p.id,
        reviewed_plan_hash: before,
        cases: [
          {
            case_id: "TC-HOME-002",
            verdict: "drop",
            rationale: "Template artifact.",
            evidence,
          },
        ],
      }),
    });
    expect(hashPlan(result.plan)).not.toBe(before);
  });

  it("refuses a review written against a different version of the plan", () => {
    const p = plan();
    expect(() =>
      applyPlanReview({
        plan: p,
        review: parsePlanReview({
          plan_id: p.id,
          reviewed_plan_hash: "sha256:stale",
          cases: [
            {
              case_id: "TC-HOME-001",
              verdict: "drop",
              rationale: "x",
              evidence,
            },
          ],
        }),
      }),
    ).toThrow(ValidationError);
  });

  it("refuses a review that would leave no cases at all", () => {
    const p = plan();
    expect(() =>
      applyPlanReview({
        plan: p,
        review: parsePlanReview({
          plan_id: p.id,
          reviewed_plan_hash: hashPlan(p),
          cases: p.test_cases.map((c) => ({
            case_id: c.id,
            verdict: "drop" as const,
            rationale: "dead",
            evidence,
          })),
        }),
      }),
    ).toThrow(/no cases/);
  });

  it("reports verdicts for case ids the plan does not contain", () => {
    const p = plan();
    const result = applyPlanReview({
      plan: p,
      review: parsePlanReview({
        plan_id: p.id,
        reviewed_plan_hash: hashPlan(p),
        cases: [
          {
            case_id: "TC-GHOST-999",
            verdict: "drop",
            rationale: "x",
            evidence,
          },
        ],
      }),
    });
    expect(result.unknownCaseIds).toEqual(["TC-GHOST-999"]);
    expect(result.plan.test_cases).toHaveLength(2);
  });
});

describe("review schema", () => {
  it("rejects a drop with no rationale", () => {
    expect(() =>
      parsePlanReview({
        plan_id: "P",
        reviewed_plan_hash: "sha256:x",
        cases: [{ case_id: "TC-1", verdict: "drop", evidence }],
      }),
    ).toThrow(/rationale/);
  });

  it("rejects a drop with no evidence", () => {
    // An opinion does not get to change a test plan.
    expect(() =>
      parsePlanReview({
        plan_id: "P",
        reviewed_plan_hash: "sha256:x",
        cases: [{ case_id: "TC-1", verdict: "drop", rationale: "trust me" }],
      }),
    ).toThrow(/evidence/);
  });

  it("rejects a retarget with no new anchor", () => {
    expect(() =>
      parsePlanReview({
        plan_id: "P",
        reviewed_plan_hash: "sha256:x",
        cases: [
          {
            case_id: "TC-1",
            verdict: "retarget",
            rationale: "wrong screen",
            evidence,
          },
        ],
      }),
    ).toThrow(/new_anchor/);
  });

  it("accepts a keep with nothing attached", () => {
    const review = parsePlanReview({
      plan_id: "P",
      reviewed_plan_hash: "sha256:x",
      cases: [{ case_id: "TC-1", verdict: "keep" }],
    });
    expect(review.cases[0]?.verdict).toBe("keep");
  });
});
