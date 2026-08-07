import { describe, expect, it } from "vitest";
import { evaluateReviewPolicy } from "./review-policy.js";
import { parsePlanReview } from "../models/review.js";
import { parseTestPlan } from "../models/index.js";
import type { TestPlan } from "../models/plan.js";

/**
 * `--approve` exists so an agent can close the loop without a second human
 * approval it has already earned. The whole value of that depends on one thing:
 * it must refuse when the agent did not actually settle the question, because
 * "approved" is a claim about knowledge, not a step in a script.
 */

function planWithOrphanIssue(): TestPlan {
  return parseTestPlan({
    schema_version: 1,
    id: "XFPLAN-1",
    project_id: "demo",
    created_at: "2026-08-07T00:00:00.000Z",
    level: "smoke",
    test_cases: [
      {
        id: "TC-A-001",
        title: "A",
        feature: "discovery",
        types: ["functional"],
        priority: "P1",
        risk_score: 5,
        steps: [{ id: "step-1", action: "launch-app" }],
        expected_results: ["visible"],
        assertions: [{ id: "assert-1", kind: "screen-is", target: "dead" }],
        automation: { framework: "xcuitest", execution_group: "g" },
        confidence: 0.6,
        provenance: ["source"],
      },
    ],
    testability_issues: [
      {
        id: "TI-ORPHANED-SCREEN-001",
        kind: "screen-not-referenced",
        description: "…",
        severity: "critical",
        affected_cases: ["TC-A-001"],
        subjects: ["CategoryDetailScreen"],
        blocks_automation: false,
      },
    ],
    permissions: {},
    estimated_duration: { min_minutes: 1, max_minutes: 2 },
    stats: { total_cases: 1, suites: 1, shards: 1 },
    inputs: { config_version: 1 },
  });
}

const evidence = [{ file: "App/Router.swift", start_line: 3 }];

describe("evaluateReviewPolicy", () => {
  it("refuses when a flagged case was left at a bare keep", () => {
    // The exact failure worth preventing: an agent that could not answer the
    // question, changed nothing, and approved anyway.
    const result = evaluateReviewPolicy(
      planWithOrphanIssue(),
      parsePlanReview({
        plan_id: "XFPLAN-1",
        reviewed_plan_hash: "sha256:x",
        cases: [{ case_id: "TC-A-001", verdict: "keep" }],
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.unresolved[0]).toContain("CategoryDetailScreen");
    expect(result.unresolved[0]).toContain("TC-A-001");
  });

  it("refuses when the review says nothing about the flagged case at all", () => {
    const result = evaluateReviewPolicy(
      planWithOrphanIssue(),
      parsePlanReview({
        plan_id: "XFPLAN-1",
        reviewed_plan_hash: "sha256:x",
        cases: [],
      }),
    );
    expect(result.allowed).toBe(false);
  });

  it("allows a keep that carries a rationale and evidence", () => {
    // "I checked; it is reached by a NavigationLink" is a real answer, and the
    // commonest correct one — the check is lexical and misses live code.
    const result = evaluateReviewPolicy(
      planWithOrphanIssue(),
      parsePlanReview({
        plan_id: "XFPLAN-1",
        reviewed_plan_hash: "sha256:x",
        cases: [
          {
            case_id: "TC-A-001",
            verdict: "keep",
            rationale: "Presented by a NavigationLink the lexical scan missed.",
            evidence,
          },
        ],
      }),
    );
    expect(result.allowed).toBe(true);
    expect(result.unresolved).toEqual([]);
  });

  it("allows a retarget, which already required evidence at the schema", () => {
    const result = evaluateReviewPolicy(
      planWithOrphanIssue(),
      parsePlanReview({
        plan_id: "XFPLAN-1",
        reviewed_plan_hash: "sha256:x",
        cases: [
          {
            case_id: "TC-A-001",
            verdict: "retarget",
            rationale: "Router presents DiscoveryHome.",
            evidence,
            new_anchor: "discovery-home",
          },
        ],
      }),
    );
    expect(result.allowed).toBe(true);
  });

  it("accepts a navigation finding as the answer for every case it covers", () => {
    // Settling the screen settles all its cases at once, which is how a person
    // naturally answers: "I checked, nothing presents it."
    const result = evaluateReviewPolicy(
      planWithOrphanIssue(),
      parsePlanReview({
        plan_id: "XFPLAN-1",
        reviewed_plan_hash: "sha256:x",
        cases: [],
        navigation_findings: [
          {
            screen: "CategoryDetailScreen",
            reachable: false,
            rationale: "Only match is its own declaration.",
            evidence,
          },
        ],
      }),
    );
    expect(result.allowed).toBe(true);
  });

  it("allows anything when the plan raised no dead-code question", () => {
    const plan = planWithOrphanIssue();
    const clean = parseTestPlan({ ...plan, testability_issues: [] });
    const result = evaluateReviewPolicy(
      clean,
      parsePlanReview({
        plan_id: "XFPLAN-1",
        reviewed_plan_hash: "sha256:x",
        cases: [],
      }),
    );
    expect(result.allowed).toBe(true);
  });
});
