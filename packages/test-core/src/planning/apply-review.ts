import { ValidationError } from "@xforge/shared";
import type { TestPlan, TestSuite } from "../models/plan.js";
import type { TestCase } from "../models/test-case.js";
import type {
  AppliedReview,
  CaseReview,
  PlanReview,
} from "../models/review.js";
import { hashPlan } from "./hash.js";

/**
 * Apply a {@link PlanReview} to a {@link TestPlan}, deterministically.
 *
 * The agent decides; this function performs. Keeping the merge here rather than
 * letting an agent rewrite `plan.json` is what makes the write-back path safe:
 * the schema is enforced, the arithmetic (suites, stats, shard membership) stays
 * consistent, and every verdict is recorded in the plan so a later reader can
 * see which cases a machine produced and which a reviewer overruled, with the
 * evidence attached.
 *
 * Two refusals matter:
 *
 *   - A review written against a different plan hash is rejected outright. A
 *     verdict names a case id, and case ids are only meaningful within the plan
 *     they were read from.
 *   - A review that would drop every case is rejected. That is not a review, it
 *     is a statement that planning failed — and the honest response is to fix
 *     the inputs and re-plan, not to approve an empty plan that passes.
 */

export interface ApplyReviewInput {
  plan: TestPlan;
  review: PlanReview;
  appliedAt?: string;
}

export interface ApplyReviewOutput {
  plan: TestPlan;
  applied: AppliedReview;
  /** Case ids named by the review that the plan does not contain. */
  unknownCaseIds: string[];
}

/** Replace the navigation target of a case's steps and assertions. */
function retargetCase(testCase: TestCase, anchor: string): TestCase {
  const oldAnchor = testCase.assertions.find(
    (a) => a.kind === "screen-is",
  )?.target;
  return {
    ...testCase,
    steps: testCase.steps.map((s) =>
      s.target && oldAnchor && s.target === oldAnchor
        ? { ...s, target: anchor }
        : s,
    ),
    assertions: testCase.assertions.map((a) =>
      a.target && oldAnchor && a.target === oldAnchor
        ? { ...a, target: anchor }
        : a,
    ),
  };
}

/**
 * An added case inherits risk, priority and requirement links from a sibling in
 * the same feature. A reviewer supplies behaviour, not provenance: letting one
 * assert its own requirement link would be a route to inventing requirements,
 * which is the thing XForge exists to prevent.
 */
function materializeAddedCase(
  plan: TestPlan,
  added: PlanReview["added_cases"][number],
): TestCase {
  const sibling = plan.test_cases.find((c) => c.feature === added.feature);
  const id = `TC-${added.feature.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${added.slug.toUpperCase()}`;
  return {
    id,
    title: added.title,
    feature: added.feature,
    types: sibling?.types ?? ["functional"],
    priority: sibling?.priority ?? "P2",
    risk_score: sibling?.risk_score ?? 5,
    requirements: sibling?.requirements ?? [],
    code_references: added.evidence.map((e) => ({
      file: e.file,
      ...(e.start_line ? { start_line: e.start_line } : {}),
    })),
    design_references: [],
    preconditions: sibling?.preconditions ?? ["App freshly launched"],
    steps: added.steps,
    expected_results: added.expected_results,
    assertions: added.assertions,
    automation: {
      framework: "xcuitest",
      execution_group: `${added.feature}-core`,
      blocked: false,
    },
    confidence: added.confidence,
    // `review` marks this as reviewer-authored rather than model-derived, so a
    // reader never mistakes it for something the deterministic layer found.
    provenance: ["review"],
  };
}

export function applyPlanReview(input: ApplyReviewInput): ApplyReviewOutput {
  const { plan, review } = input;
  const previousHash = hashPlan(plan);

  if (review.plan_id !== plan.id) {
    throw new ValidationError(
      `Review targets plan ${review.plan_id}, but this is ${plan.id}.`,
    );
  }
  if (review.reviewed_plan_hash !== previousHash) {
    throw new ValidationError(
      "Review was written against a different version of this plan; its case ids " +
        "may no longer mean the same thing. Re-run `xforge test review " +
        `${plan.id}` +
        "` to regenerate the review template against the current plan.",
      {
        details: {
          reviewedHash: review.reviewed_plan_hash,
          currentHash: previousHash,
        },
      },
    );
  }

  const byId = new Map(plan.test_cases.map((c) => [c.id, c]));
  const unknownCaseIds = review.cases
    .map((r) => r.case_id)
    .filter((id) => !byId.has(id));

  const dropped: string[] = [];
  const retargeted: string[] = [];
  const revised: string[] = [];
  const verdictById = new Map<string, CaseReview>();
  for (const verdict of review.cases) {
    if (byId.has(verdict.case_id)) verdictById.set(verdict.case_id, verdict);
  }

  const kept: TestCase[] = [];
  for (const testCase of plan.test_cases) {
    const verdict = verdictById.get(testCase.id);
    if (!verdict || verdict.verdict === "keep") {
      kept.push(testCase);
      continue;
    }
    if (verdict.verdict === "drop") {
      dropped.push(testCase.id);
      continue;
    }

    let next = testCase;
    if (verdict.verdict === "retarget" && verdict.new_anchor) {
      next = retargetCase(next, verdict.new_anchor);
      retargeted.push(testCase.id);
    } else {
      revised.push(testCase.id);
    }
    if (verdict.steps) next = { ...next, steps: verdict.steps };
    if (verdict.assertions) next = { ...next, assertions: verdict.assertions };
    if (verdict.expected_results) {
      next = { ...next, expected_results: verdict.expected_results };
    }
    kept.push({ ...next, confidence: verdict.confidence });
  }

  const addedCases = review.added_cases.map((a) =>
    materializeAddedCase(plan, a),
  );
  const testCases = [...kept, ...addedCases];

  if (testCases.length === 0) {
    throw new ValidationError(
      "Applying this review would leave the plan with no cases. That is a " +
        "planning failure, not a review: fix the inputs (navigation graph, " +
        "feature scope, accessibility identifiers) and re-plan instead of " +
        "approving an empty plan.",
    );
  }

  // Keep the derived structures consistent with the new case set. Shards keep
  // their identity — re-sharding here would change the execution plan under a
  // reviewer who only meant to fix a case — but they must not reference cases
  // that no longer exist.
  const liveIds = new Set(testCases.map((c) => c.id));
  const addedByFeature = new Map<string, string[]>();
  for (const c of addedCases) {
    addedByFeature.set(c.feature, [
      ...(addedByFeature.get(c.feature) ?? []),
      c.id,
    ]);
  }

  const suites: TestSuite[] = plan.suites.map((s) => ({
    ...s,
    case_ids: [
      ...s.case_ids.filter((id) => liveIds.has(id)),
      ...(addedByFeature.get(s.feature) ?? []),
    ],
  }));

  const shards = plan.shards.map((shard) => {
    const surviving = shard.case_ids.filter((id) => liveIds.has(id));
    // Added cases join the first shard that already covers their feature, so a
    // reviewer's new case runs in the same device/state context as its siblings.
    const featureOfShard = plan.test_cases.find((c) =>
      shard.case_ids.includes(c.id),
    )?.feature;
    const extra =
      featureOfShard && addedByFeature.has(featureOfShard)
        ? addedByFeature.get(featureOfShard)!
        : [];
    return { ...shard, case_ids: [...surviving, ...extra] };
  });
  // Once every case in a shard is gone, so is the shard.
  const liveShards = shards.filter((s) => s.case_ids.length > 0);

  const byType: Record<string, number> = {};
  for (const c of testCases) {
    for (const t of c.types) byType[t] = (byType[t] ?? 0) + 1;
  }

  const applied: AppliedReview = {
    ...(review.reviewed_at ? { reviewed_at: review.reviewed_at } : {}),
    ...(review.reviewed_by ? { reviewed_by: review.reviewed_by } : {}),
    applied_at: input.appliedAt ?? new Date().toISOString(),
    previous_plan_hash: previousHash,
    ...(review.summary ? { summary: review.summary } : {}),
    dropped,
    retargeted,
    revised,
    added: addedCases.map((c) => c.id),
    verdicts: review.cases.filter((r) => byId.has(r.case_id)),
    navigation_findings: review.navigation_findings,
  };

  const nextPlan: TestPlan = {
    ...plan,
    test_cases: testCases,
    suites,
    shards: liveShards,
    stats: {
      ...plan.stats,
      total_cases: testCases.length,
      suites: suites.filter((s) => s.case_ids.length > 0).length,
      shards: liveShards.length,
      by_type: byType,
    },
    applied_reviews: [...(plan.applied_reviews ?? []), applied],
  };

  return { plan: nextPlan, applied, unknownCaseIds };
}
