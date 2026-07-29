import { describe, expect, it } from "vitest";
import {
  computeRunStats,
  renderBugMarkdown,
  renderCoverageMarkdown,
  renderRunSummaryMarkdown,
} from "./report.js";
import type { RunResult, TestExecution } from "../models/result.js";
import type { BugReport } from "../models/bug.js";

const execs: TestExecution[] = [
  { case_id: "a", status: "PASS", duration_ms: 0, retries: 0, evidence: [] },
  {
    case_id: "b",
    status: "FAIL_VISUAL",
    duration_ms: 0,
    retries: 0,
    evidence: [],
  },
  {
    case_id: "c",
    status: "INFRASTRUCTURE_FAILURE",
    duration_ms: 0,
    retries: 0,
    evidence: [],
  },
  { case_id: "d", status: "SKIPPED", duration_ms: 0, retries: 0, evidence: [] },
];

describe("computeRunStats", () => {
  it("counts product failures and gates only on them", () => {
    const stats = computeRunStats(execs);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.infrastructure).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.gate_passed).toBe(false);
  });
  it("gate passes when only infra failures exist", () => {
    const stats = computeRunStats([
      {
        case_id: "c",
        status: "INFRASTRUCTURE_FAILURE",
        duration_ms: 0,
        retries: 0,
        evidence: [],
      },
    ]);
    expect(stats.gate_passed).toBe(true);
  });
});

describe("renderers", () => {
  const run: RunResult = {
    schema_version: 1,
    run_id: "XFRUN-1",
    plan_id: "XFPLAN-1",
    project_id: "app",
    started_at: "2026-07-29T00:00:00Z",
    finished_at: "2026-07-29T00:05:00Z",
    dry_run: false,
    executions: execs,
    stats: computeRunStats(execs),
    gate_passed: false,
  };

  const bug: BugReport = {
    schema_version: 1,
    id: "XFBUG-ALARM-001",
    title: "Save button overlaps home indicator",
    type: "Visual",
    severity: "major",
    priority: "P1",
    reproducibility: "2/2",
    feature: "alarm",
    status: "Triaged",
    fingerprint: "abc123",
    environment: {},
    preconditions: ["No existing alarm"],
    steps: ["open alarm", "tap add"],
    expected_result: "16pt spacing",
    actual_result: "overlaps",
    evidence: [],
    related_requirements: ["PRD-ALARM-003"],
    impacted_cases: ["TC-ALARM-012"],
    suspected_code: ["AlarmEditorView.swift"],
    confidence: 0.6,
  };

  it("run summary shows gate + counts + bug list", () => {
    const md = renderRunSummaryMarkdown(run, [bug]);
    expect(md).toContain("QA Run Summary: XFRUN-1");
    expect(md).toContain("Gate: FAILED");
    expect(md).toContain("XFBUG-ALARM-001");
  });

  it("bug markdown frames root cause as a hypothesis", () => {
    const md = renderBugMarkdown(bug);
    expect(md).toContain("# XFBUG-ALARM-001");
    expect(md).toContain("hypothesis");
    expect(md).toContain("AlarmEditorView.swift");
  });

  it("coverage markdown renders tables", () => {
    const md = renderCoverageMarkdown({
      requirement: [
        {
          id: "PRD-ALARM-003",
          kind: "requirement",
          covered: true,
          passed: false,
          case_ids: ["TC-ALARM-012"],
        },
      ],
      feature: [],
      design: [],
      confidence: 1,
    });
    expect(md).toContain("Requirement coverage");
    expect(md).toContain("PRD-ALARM-003");
  });
});
