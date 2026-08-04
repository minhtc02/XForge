import type { Severity } from "../models/enums.js";
import type { TestExecution } from "../models/result.js";
import type { VisualEscalation } from "../results/escalation.js";
import type { ConformanceFinding } from "./design-conformance.js";

/**
 * Turning conformance findings into a verdict (blueprint §12.5).
 *
 * The severity policy is deliberately asymmetric, because the two kinds of
 * finding differ in how certain they are:
 *
 *   `critical` — the design has an element the app never rendered. There is no
 *                interpretation under which that is fine, so it fails.
 *   `major` / `minor` — a size or token is off by some points. Often a real
 *                bug, sometimes a safe-area inset or a rounding difference the
 *                design did not model. Reported, not failed, until a project
 *                has seen a run and lowered `conformance_fails_at`.
 *
 * Starting stricter would be the wrong default: a suite that goes red on its
 * first design comparison teaches people to ignore it.
 */

export type FailsAt = "critical" | "major" | "minor" | "never";

const RANK: Record<Severity, number> = {
  blocker: 0,
  critical: 1,
  major: 2,
  minor: 3,
  info: 4,
};

const THRESHOLD_RANK: Record<Exclude<FailsAt, "never">, number> = {
  critical: RANK.critical,
  major: RANK.major,
  minor: RANK.minor,
};

/** Whether a finding is severe enough to fail the case, under this policy. */
export function failsCase(finding: ConformanceFinding, at: FailsAt): boolean {
  if (at === "never") return false;
  return RANK[finding.severity] <= THRESHOLD_RANK[at];
}

export interface ConformanceVerdict {
  /** Findings that fail the case under the configured policy. */
  failing: ConformanceFinding[];
  /** Findings reported but not failing. */
  warnings: ConformanceFinding[];
  /** Ready to hand to `applyVisualEscalations`; undefined when nothing failed. */
  escalation?: VisualEscalation;
}

export interface VerdictInput {
  caseId: string;
  findings: ConformanceFinding[];
  failsAt: FailsAt;
  /** Artifacts backing the verdict (probe dump, screenshot). */
  evidence?: TestExecution["evidence"];
}

/**
 * Split findings by the policy and, when something failed, build the escalation
 * that will flip a passing case to `FAIL_VISUAL`. The message names the worst
 * finding, so the failure is readable without opening the report.
 */
export function conformanceVerdict(input: VerdictInput): ConformanceVerdict {
  const failing = input.findings.filter((f) => failsCase(f, input.failsAt));
  const warnings = input.findings.filter((f) => !failsCase(f, input.failsAt));

  if (failing.length === 0) {
    return { failing, warnings };
  }

  const worst = failing[0]!;
  const extra = failing.length - 1;
  return {
    failing,
    warnings,
    escalation: {
      case_id: input.caseId,
      verdict: "VISUAL_FAILURE",
      source: "probe",
      message: `${worst.description}` + (extra > 0 ? ` (+${extra} more)` : ""),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    },
  };
}

/** A compact, readable block for the run report. */
export function renderConformanceMarkdown(
  byCase: Array<{ caseId: string; verdict: ConformanceVerdict }>,
): string {
  const withFindings = byCase.filter(
    (e) => e.verdict.failing.length + e.verdict.warnings.length > 0,
  );
  if (withFindings.length === 0) {
    return "## Design conformance\n\nNo differences from the design reference.\n";
  }

  const lines = ["## Design conformance", ""];
  for (const { caseId, verdict } of withFindings) {
    lines.push(`### ${caseId}`, "");
    for (const finding of verdict.failing) {
      lines.push(`- **FAIL** [${finding.rule}] ${finding.description}`);
    }
    for (const finding of verdict.warnings) {
      lines.push(`- warn [${finding.rule}] ${finding.description}`);
    }
    lines.push("");
  }

  const failing = withFindings.filter((e) => e.verdict.failing.length > 0);
  if (failing.length === 0) {
    lines.push(
      "_All differences are warnings under `visual.conformance_fails_at`._",
      "_Lower it to `major` once you have confirmed these are real._",
      "",
    );
  }
  return lines.join("\n");
}
