import type { TestExecution } from "../models/result.js";
import type { VisualVerdict } from "../models/enums.js";
import { isVisualFailure } from "../analysis/visual.js";

/**
 * Post-run verdict escalation (optimization plan §D, "avoiding the exit-0
 * trap").
 *
 * `xcodebuild` can exit 0 while the UI is visibly wrong, so a later layer — the
 * visual comparison, or the probe — may overrule a PASS. The rule is one-way:
 *
 *   PASS  →  FAIL_VISUAL     allowed (an escalation, with evidence)
 *   FAIL  →  PASS            never
 *
 * A downgrade would let a probabilistic judgement erase a deterministic failure,
 * which is exactly backwards. `verdict_source` records who escalated so the
 * report can separate "the test asserted this" from "an agent judged this".
 */

export interface VisualEscalation {
  case_id: string;
  verdict: VisualVerdict;
  /** Artifact paths backing the verdict (screenshot, diff image). */
  evidence?: TestExecution["evidence"];
  /** Human-readable reason, surfaced as the execution message. */
  message?: string;
  source?: "visual-agent" | "probe";
}

export interface EscalationResult {
  executions: TestExecution[];
  /** Executions whose status changed. */
  escalated: string[];
  /** Escalations that were refused because they would downgrade a failure. */
  refused: string[];
}

/**
 * Apply visual verdicts to a run's executions. Pure: takes executions and
 * verdicts, returns new executions — no I/O, fully unit-testable.
 */
export function applyVisualEscalations(
  executions: TestExecution[],
  escalations: VisualEscalation[],
): EscalationResult {
  const byCase = new Map(escalations.map((e) => [e.case_id, e]));
  const escalated: string[] = [];
  const refused: string[] = [];

  const next = executions.map((execution) => {
    const escalation = byCase.get(execution.case_id);
    if (!escalation) return execution;

    // Record the verdict regardless — it is evidence even when it changes
    // nothing (a PASS verdict on a passing test is a confirmation).
    const withVerdict: TestExecution = {
      ...execution,
      visual_verdict: escalation.verdict,
      evidence: [...execution.evidence, ...(escalation.evidence ?? [])],
    };

    if (!isVisualFailure(escalation.verdict)) return withVerdict;

    if (execution.status !== "PASS") {
      // Already failing: keep the original, more specific status. Escalating
      // would overwrite a deterministic result with a judged one.
      refused.push(execution.case_id);
      return withVerdict;
    }

    escalated.push(execution.case_id);
    return {
      ...withVerdict,
      status: "FAIL_VISUAL" as const,
      verdict_source: escalation.source ?? ("visual-agent" as const),
      message: escalation.message ?? "UI does not match the design reference",
    };
  });

  return { executions: next, escalated, refused };
}

/** Executions whose status was decided by something other than the test itself. */
export function judgedExecutions(executions: TestExecution[]): TestExecution[] {
  return executions.filter(
    (e) => e.verdict_source && e.verdict_source !== "xcuitest",
  );
}
