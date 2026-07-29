import { describe, expect, it } from "vitest";
import {
  classifyFailureMessage,
  classifyXcodeStatus,
  normalizeError,
  parseXcresult,
} from "./xcresult.js";
import { fingerprint, triageBugs } from "./triage.js";
import { computeCoverage } from "./coverage.js";
import { parseTestPlan, type TestExecution } from "../models/index.js";

describe("classifyFailureMessage", () => {
  it("classifies simulator/build issues as infrastructure (never product)", () => {
    expect(classifyFailureMessage("Simulator failed to launch")).toBe(
      "INFRASTRUCTURE_FAILURE",
    );
    expect(classifyFailureMessage("xcodebuild: no such scheme")).toBe(
      "INFRASTRUCTURE_FAILURE",
    );
  });
  it("classifies permission/network as environment-blocked", () => {
    expect(
      classifyFailureMessage("Notification permission not determined"),
    ).toBe("ENVIRONMENT_BLOCKED");
  });
  it("classifies by product category", () => {
    expect(classifyFailureMessage("Snapshot pixel diff exceeded")).toBe(
      "FAIL_VISUAL",
    );
    expect(classifyFailureMessage("Missing accessibility identifier")).toBe(
      "FAIL_ACCESSIBILITY",
    );
    expect(classifyFailureMessage("Cold launch time regression")).toBe(
      "FAIL_PERFORMANCE",
    );
    expect(classifyFailureMessage("XCTAssertEqual failed")).toBe(
      "FAIL_FUNCTIONAL",
    );
  });
});

describe("classifyXcodeStatus", () => {
  it("maps success/skipped/expected-failure", () => {
    expect(classifyXcodeStatus("Success")).toBe("PASS");
    expect(classifyXcodeStatus("Skipped")).toBe("SKIPPED");
    expect(classifyXcodeStatus("Expected Failure")).toBe("PASS");
  });
});

describe("normalizeError", () => {
  it("strips numbers, hex and quoted literals for stable fingerprints", () => {
    const a = normalizeError('Failed at line 42 with 0xAB "Alarm A"');
    const b = normalizeError('Failed at line 99 with 0xFF "Alarm B"');
    expect(a).toBe(b);
  });
});

describe("parseXcresult", () => {
  it("maps xcresult tests to executions", () => {
    const execs = parseXcresult(
      {
        tests: [
          { identifier: "TC-ALARM-001", testStatus: "Success", duration: 1.2 },
          {
            identifier: "TC-ALARM-002",
            testStatus: "Failure",
            failureMessages: ["Snapshot pixel diff exceeded"],
          },
        ],
      },
      "shard-alarm",
    );
    expect(execs[0]!.status).toBe("PASS");
    expect(execs[0]!.duration_ms).toBe(1200);
    expect(execs[1]!.status).toBe("FAIL_VISUAL");
    expect(execs[1]!.normalized_error).toBeDefined();
  });
});

function planWithCases() {
  return parseTestPlan({
    id: "XFPLAN-1",
    project_id: "app",
    created_at: "2026-07-29T00:00:00Z",
    level: "critical",
    test_cases: [
      {
        id: "TC-ALARM-001",
        title: "Alarm save",
        feature: "alarm",
        types: ["functional"],
        priority: "P0",
        risk_score: 9,
        requirements: ["PRD-ALARM-001"],
        code_references: [{ file: "AlarmView.swift" }],
        design_references: [{ figma_node_id: "10:23" }],
        preconditions: [],
        steps: [{ id: "s1", action: "tap", target: "save" }],
        expected_results: ["saved"],
        automation: { framework: "xcuitest", blocked: false },
        confidence: 0.7,
        provenance: ["prd"],
      },
      {
        id: "TC-ALARM-002",
        title: "Alarm list",
        feature: "alarm",
        types: ["functional"],
        priority: "P1",
        risk_score: 7,
        requirements: ["PRD-ALARM-001"],
        code_references: [{ file: "AlarmView.swift" }],
        design_references: [],
        preconditions: [],
        steps: [{ id: "s1", action: "tap", target: "save" }],
        expected_results: ["listed"],
        automation: { framework: "xcuitest", blocked: false },
        confidence: 0.7,
        provenance: ["prd"],
      },
    ],
    permissions: {},
    production_modifications: [],
    estimated_duration: { min_minutes: 1, max_minutes: 1 },
    stats: { total_cases: 2, suites: 1, shards: 1, by_type: { functional: 2 } },
    inputs: { config_version: 1 },
  });
}

describe("triageBugs + dedup", () => {
  it("collapses two cases with the same fingerprint into one bug", () => {
    const plan = planWithCases();
    const execs: TestExecution[] = [
      {
        case_id: "TC-ALARM-001",
        status: "FAIL_FUNCTIONAL",
        step_id: "s1",
        normalized_error: "assert failed",
        duration_ms: 0,
        retries: 0,
        evidence: [],
      },
      {
        case_id: "TC-ALARM-002",
        status: "FAIL_FUNCTIONAL",
        step_id: "s1",
        normalized_error: "assert failed",
        duration_ms: 0,
        retries: 0,
        evidence: [],
      },
    ];
    const bugs = triageBugs({ executions: execs, cases: plan.test_cases });
    expect(bugs).toHaveLength(1);
    expect(bugs[0]!.impacted_cases.sort()).toEqual([
      "TC-ALARM-001",
      "TC-ALARM-002",
    ]);
    expect(bugs[0]!.related_requirements).toContain("PRD-ALARM-001");
  });

  it("never creates a bug for infrastructure/environment failures", () => {
    const plan = planWithCases();
    const bugs = triageBugs({
      executions: [
        {
          case_id: "TC-ALARM-001",
          status: "INFRASTRUCTURE_FAILURE",
          duration_ms: 0,
          retries: 0,
          evidence: [],
        },
        {
          case_id: "TC-ALARM-002",
          status: "ENVIRONMENT_BLOCKED",
          duration_ms: 0,
          retries: 0,
          evidence: [],
        },
      ],
      cases: plan.test_cases,
    });
    expect(bugs).toHaveLength(0);
  });

  it("fingerprint differs when the failed step differs", () => {
    const a = fingerprint("alarm", {
      case_id: "x",
      status: "FAIL_FUNCTIONAL",
      step_id: "s1",
      normalized_error: "e",
      duration_ms: 0,
      retries: 0,
      evidence: [],
    });
    const b = fingerprint("alarm", {
      case_id: "y",
      status: "FAIL_FUNCTIONAL",
      step_id: "s2",
      normalized_error: "e",
      duration_ms: 0,
      retries: 0,
      evidence: [],
    });
    expect(a).not.toBe(b);
  });
});

describe("computeCoverage", () => {
  it("reports requirement, feature and design coverage with pass state", () => {
    const plan = planWithCases();
    const cov = computeCoverage(plan, [
      {
        case_id: "TC-ALARM-001",
        status: "PASS",
        duration_ms: 0,
        retries: 0,
        evidence: [],
      },
      {
        case_id: "TC-ALARM-002",
        status: "FAIL_FUNCTIONAL",
        duration_ms: 0,
        retries: 0,
        evidence: [],
      },
    ]);
    expect(cov.feature[0]!.id).toBe("alarm");
    expect(cov.feature[0]!.covered).toBe(true);
    expect(cov.feature[0]!.passed).toBe(false); // one case failed
    expect(cov.requirement[0]!.id).toBe("PRD-ALARM-001");
    expect(cov.design[0]!.id).toBe("10:23");
  });
});
