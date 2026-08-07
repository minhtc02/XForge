import type { TestPlan } from "../models/plan.js";
import type { PlanReview } from "../models/review.js";

/**
 * Whether a review answered enough to approve the plan without a human.
 *
 * `test plan` withholds approval when a case targets a screen nothing refers
 * to, because a green run against dead code is evidence of nothing. An agent
 * that investigates and writes the verdicts back has removed that doubt — so
 * requiring a second human approval afterwards would be ceremony, not safety.
 *
 * But only if it actually investigated. The failure this guards against is an
 * agent that cannot settle the question, leaves every case at `keep`, and
 * approves anyway — which converts "we do not know whether this tests dead
 * code" into "approved" without anyone learning anything. That is worse than
 * the original problem, because now the doubt is invisible.
 *
 * So the rule is: every question the deterministic layer raised must have been
 * answered *with evidence*. A `keep` verdict is a legitimate answer — plenty of
 * flagged screens turn out to be reachable by reflection or a storyboard — but
 * a `keep` on a flagged case with no rationale and no evidence is not an answer.
 * It is silence, and silence does not get to approve a plan.
 */

export interface ReviewPolicyResult {
  allowed: boolean;
  /** Questions the review left unanswered, in the words the user will read. */
  unresolved: string[];
}

/** Did this review say anything evidence-backed about `caseId`? */
function answered(review: PlanReview, caseId: string): boolean {
  const verdict = review.cases.find((c) => c.case_id === caseId);
  if (!verdict) return false;
  // Any verdict other than `keep` already required rationale + evidence at the
  // schema level, so reaching here means it was justified.
  if (verdict.verdict !== "keep") return true;
  return Boolean(verdict.rationale) && verdict.evidence.length > 0;
}

/** Did the review record a finding about one of an issue's subjects? */
function addressedBySubject(review: PlanReview, subjects: string[]): boolean {
  if (subjects.length === 0) return false;
  return subjects.every((subject) =>
    review.navigation_findings.some(
      (f) => f.screen === subject && f.evidence.length > 0,
    ),
  );
}

export function evaluateReviewPolicy(
  plan: TestPlan,
  review: PlanReview,
): ReviewPolicyResult {
  const unresolved: string[] = [];

  for (const issue of plan.testability_issues) {
    if (issue.kind !== "screen-not-referenced") continue;

    // A navigation finding about every screen the issue names settles it for
    // all of its cases at once — that is the natural shape of the answer
    // ("I checked, nothing presents it").
    if (addressedBySubject(review, issue.subjects)) continue;

    const silent = issue.affected_cases.filter((id) => !answered(review, id));
    if (silent.length > 0) {
      unresolved.push(
        `${issue.subjects.join(", ") || issue.id}: ${silent.length} case(s) ` +
          `(${silent.join(", ")}) were left at \`keep\` with no rationale or ` +
          "evidence, so the dead-code question was never answered.",
      );
    }
  }

  return { allowed: unresolved.length === 0, unresolved };
}
