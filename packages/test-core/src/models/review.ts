import { z } from "zod";
import { Confidence } from "./enums.js";
import { Assertion, TestStep } from "./test-case.js";

/**
 * The LLM write-back path for a test plan (closes the §25.1 step-5 gap).
 *
 * XForge's deterministic planner works from declarations: it sees a screen type
 * and assumes a user can reach it. That is wrong exactly when it matters — an
 * abandoned screen looks identical to a live one, so the planner will generate
 * a confident plan against dead code, and a template case like "create an item,
 * relaunch, check it persisted" against a screen with nothing to create.
 *
 * No amount of static analysis fixes that; answering it needs someone who can
 * grep the repository, read the call sites and judge intent. XForge runs inside
 * Claude Code, so that someone is available — what was missing was a way for
 * their conclusions to reach the plan instead of a side file nobody executes.
 *
 * This is that channel. A **review** is a set of verdicts on generated cases,
 * each carrying its evidence, which `xforge test review apply` merges into the
 * plan deterministically. The properties that make it safe to hand an agent:
 *
 *   - **Evidence is required.** Dropping or retargeting a case without a
 *     `rationale` and at least one `evidence` reference is rejected by the
 *     schema. An agent that cannot say why cannot change the plan.
 *   - **The merge is deterministic and auditable.** The CLI applies verdicts;
 *     the agent never writes `plan.json`. Every applied verdict is recorded in
 *     the plan, so a reader can see what was machine-generated and what was
 *     overridden, by whom, and on what grounds.
 *   - **Approval is invalidated.** Applying a review re-hashes the plan, so a
 *     prior approval goes stale by the existing mechanism rather than a new
 *     one. Nothing runs on a plan a human has not re-approved.
 */

/** What a reviewer decided about one generated case. */
export const CaseVerdict = z.enum([
  /** The case is sound; keep it unchanged. */
  "keep",
  /** The case tests something unreachable or non-existent; remove it. */
  "drop",
  /** The case is aimed at the wrong screen; point it at the right one. */
  "retarget",
  /** The steps or assertions are wrong or too weak; replace them. */
  "revise",
]);
export type CaseVerdict = z.infer<typeof CaseVerdict>;

/**
 * A pointer to what the reviewer actually looked at. Free-form `detail` is
 * allowed, but `file` is not optional: a verdict with no file behind it is an
 * opinion, and opinions do not get to change a test plan.
 */
export const ReviewEvidence = z.object({
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  /** What this file showed, e.g. "only match is the declaration itself". */
  detail: z.string().min(1).optional(),
});
export type ReviewEvidence = z.infer<typeof ReviewEvidence>;

/** One reviewed case. */
export const CaseReview = z
  .object({
    case_id: z.string().min(1),
    verdict: CaseVerdict,
    /** Why. Required for anything other than `keep`. */
    rationale: z.string().min(1).optional(),
    evidence: z.array(ReviewEvidence).default([]),
    /** For `retarget`: the navigation anchor the case should use instead. */
    new_anchor: z.string().min(1).optional(),
    /** For `revise`/`retarget`: replacement steps. */
    steps: z.array(TestStep).optional(),
    /** For `revise`/`retarget`: replacement assertions. */
    assertions: z.array(Assertion).optional(),
    /** For `revise`: replacement expected results. */
    expected_results: z.array(z.string()).optional(),
    /** Reviewer's confidence in the verdict. */
    confidence: Confidence.default(0.8),
  })
  .superRefine((review, ctx) => {
    if (review.verdict === "keep") return;
    if (!review.rationale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rationale"],
        message: `Verdict "${review.verdict}" requires a rationale.`,
      });
    }
    if (review.evidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: `Verdict "${review.verdict}" requires at least one evidence reference.`,
      });
    }
    if (review.verdict === "retarget" && !review.new_anchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["new_anchor"],
        message: 'Verdict "retarget" requires new_anchor.',
      });
    }
  });
export type CaseReview = z.infer<typeof CaseReview>;

/**
 * A case the reviewer wants that the planner never produced.
 *
 * Deliberately more constrained than a full {@link TestCase}: an added case
 * inherits its feature's risk score, priority and requirement links from the
 * plan rather than stating its own, so a reviewer cannot invent a requirement
 * link or inflate a priority. Evidence is required for the same reason as
 * above.
 */
export const AddedCase = z.object({
  /** Suffix appended to a generated id, e.g. `home-lesson-open`. */
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case"),
  title: z.string().min(1),
  feature: z.string().min(1),
  rationale: z.string().min(1),
  evidence: z.array(ReviewEvidence).min(1),
  steps: z.array(TestStep).min(1),
  expected_results: z.array(z.string()).default([]),
  assertions: z.array(Assertion).default([]),
  confidence: Confidence.default(0.7),
});
export type AddedCase = z.infer<typeof AddedCase>;

/** A navigation fact the reviewer confirmed by reading the source. */
export const NavigationFinding = z.object({
  /** Screen type or node the finding is about. */
  screen: z.string().min(1),
  /** True when the reviewer confirmed the app can actually reach it. */
  reachable: z.boolean(),
  rationale: z.string().min(1),
  evidence: z.array(ReviewEvidence).min(1),
});
export type NavigationFinding = z.infer<typeof NavigationFinding>;

/** The full review document an agent writes and the CLI applies. */
export const PlanReview = z.object({
  schema_version: z.literal(1).default(1),
  plan_id: z.string().min(1),
  /**
   * The hash the review was written against. `apply` refuses a review whose
   * plan has changed since — the same staleness rule approvals use, for the
   * same reason: a verdict about case TC-003 is meaningless if TC-003 is now a
   * different case.
   */
  reviewed_plan_hash: z.string().min(1),
  reviewed_at: z.string().optional(),
  reviewed_by: z.string().optional(),
  /** Prose summary for the human reading the plan later. */
  summary: z.string().optional(),
  cases: z.array(CaseReview).default([]),
  added_cases: z.array(AddedCase).default([]),
  navigation_findings: z.array(NavigationFinding).default([]),
  /**
   * Accessibility identifiers the reviewer says the app needs before these
   * cases can work. Recorded, never applied — XForge does not edit product code.
   */
  required_identifiers: z
    .array(
      z.object({
        identifier: z.string().min(1),
        file: z.string().min(1),
        note: z.string().optional(),
      }),
    )
    .default([]),
});
export type PlanReview = z.infer<typeof PlanReview>;

export function parsePlanReview(input: unknown): PlanReview {
  return PlanReview.parse(input);
}

/** Record of an applied review, embedded in the plan for auditability. */
export const AppliedReview = z.object({
  reviewed_at: z.string().optional(),
  reviewed_by: z.string().optional(),
  applied_at: z.string(),
  /** Plan hash before the review was applied. */
  previous_plan_hash: z.string().min(1),
  summary: z.string().optional(),
  dropped: z.array(z.string()).default([]),
  retargeted: z.array(z.string()).default([]),
  revised: z.array(z.string()).default([]),
  added: z.array(z.string()).default([]),
  /** Verdicts in full, so the reasoning survives in the plan itself. */
  verdicts: z.array(CaseReview).default([]),
  navigation_findings: z.array(NavigationFinding).default([]),
});
export type AppliedReview = z.infer<typeof AppliedReview>;
