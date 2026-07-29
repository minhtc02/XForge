import type { BugReport } from "../models/bug.js";
import type {
  CoverageReport,
  RunResult,
  TestExecution,
} from "../models/result.js";
import type { TestStatus } from "../models/enums.js";

/**
 * QA report renderers (blueprint §23, §24). Deterministic string/JSON builders
 * over already-computed run results, coverage and bugs. No secrets flow in.
 */

/** Compute run stats + gate from executions. */
export function computeRunStats(
  executions: TestExecution[],
): RunResult["stats"] & { gate_passed: boolean } {
  const count = (s: TestStatus): number =>
    executions.filter((e) => e.status === s).length;
  const failed =
    count("FAIL_FUNCTIONAL") +
    count("FAIL_VISUAL") +
    count("FAIL_ACCESSIBILITY") +
    count("FAIL_PERFORMANCE");
  const stats = {
    total: executions.length,
    passed: count("PASS"),
    failed,
    flaky: count("FLAKY"),
    blocked: count("BLOCKED"),
    infrastructure:
      count("INFRASTRUCTURE_FAILURE") + count("ENVIRONMENT_BLOCKED"),
    skipped: count("SKIPPED"),
  };
  // Gate passes only when there are no product failures.
  return { ...stats, gate_passed: failed === 0 };
}

export function renderRunSummaryMarkdown(
  run: RunResult,
  bugs: BugReport[],
): string {
  const s = run.stats;
  return [
    `# QA Run Summary: ${run.run_id}`,
    "",
    `- Plan: ${run.plan_id}`,
    `- Project: ${run.project_id}`,
    `- Started: ${run.started_at}`,
    `- Finished: ${run.finished_at}`,
    run.dry_run ? "- Mode: DRY RUN (no simulators executed)" : "- Mode: live",
    `- Gate: ${run.gate_passed ? "PASSED" : "FAILED"}`,
    "",
    "## Results",
    "",
    `| Status | Count |`,
    `|---|---|`,
    `| Passed | ${s.passed} |`,
    `| Failed (product) | ${s.failed} |`,
    `| Flaky | ${s.flaky} |`,
    `| Blocked | ${s.blocked} |`,
    `| Infrastructure/Env | ${s.infrastructure} |`,
    `| Skipped | ${s.skipped} |`,
    `| **Total** | **${s.total}** |`,
    "",
    "## Bugs",
    "",
    bugs.length === 0
      ? "No product bugs triaged."
      : bugs
          .map(
            (b) =>
              `- **${b.id}** [${b.severity}/${b.priority}] ${b.title} — impacts ${b.impacted_cases.length} case(s)`,
          )
          .join("\n"),
    "",
  ].join("\n");
}

export function renderBugMarkdown(bug: BugReport): string {
  return [
    `# ${bug.id}`,
    "",
    "## Title",
    "",
    bug.title,
    "",
    "## Classification",
    "",
    `- Type: ${bug.type}`,
    `- Severity: ${bug.severity}`,
    `- Priority: ${bug.priority}`,
    `- Reproducibility: ${bug.reproducibility ?? "unknown"}`,
    `- Feature: ${bug.feature}`,
    `- Status: ${bug.status}`,
    `- Fingerprint: ${bug.fingerprint}`,
    "",
    "## Steps to reproduce",
    "",
    bug.steps.length > 0
      ? bug.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none recorded)",
    "",
    "## Expected result",
    "",
    bug.expected_result ?? "(unspecified)",
    "",
    "## Actual result",
    "",
    bug.actual_result ?? "(unspecified)",
    "",
    "## Impacted test cases",
    "",
    bug.impacted_cases.map((c) => `- ${c}`).join("\n") || "(none)",
    "",
    "## Related requirements",
    "",
    bug.related_requirements.map((r) => `- ${r}`).join("\n") || "(none)",
    "",
    "## Suspected code locations",
    "",
    bug.suspected_code.map((c) => `- ${c}`).join("\n") || "(none)",
    "",
    `## Confidence`,
    "",
    `${bug.confidence.toFixed(2)} — suspected locations are a hypothesis, not confirmed root cause.`,
    "",
  ].join("\n");
}

export function renderCoverageMarkdown(coverage: CoverageReport): string {
  const section = (
    title: string,
    entries: CoverageReport["requirement"],
  ): string => {
    if (entries.length === 0) return `## ${title}\n\n(none)`;
    const rows = entries
      .map(
        (e) =>
          `| \`${e.id}\` | ${e.covered ? "✅" : "❌"} | ${e.passed ? "✅" : "❌"} | ${e.case_ids.length} |`,
      )
      .join("\n");
    return `## ${title}\n\n| Id | Covered | Passed | Cases |\n|---|---|---|---|\n${rows}`;
  };
  return [
    "# QA Coverage",
    "",
    section("Requirement coverage", coverage.requirement),
    "",
    section("Feature coverage", coverage.feature),
    "",
    section("Design coverage", coverage.design),
    "",
  ].join("\n");
}
