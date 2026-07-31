import { describe, expect, it } from "vitest";
import { applyVisualEscalations, judgedExecutions } from "./escalation.js";
import type { TestExecution } from "../models/result.js";

function exec(overrides: Partial<TestExecution> = {}): TestExecution {
  return {
    case_id: "TC-ALARM-001",
    status: "PASS",
    duration_ms: 100,
    retries: 0,
    evidence: [],
    verdict_source: "xcuitest",
    ...overrides,
  };
}

describe("applyVisualEscalations", () => {
  it("escalates a passing test when the visual verdict is a failure", () => {
    const result = applyVisualEscalations(
      [exec()],
      [{ case_id: "TC-ALARM-001", verdict: "VISUAL_FAILURE" }],
    );
    expect(result.executions[0]?.status).toBe("FAIL_VISUAL");
    expect(result.executions[0]?.verdict_source).toBe("visual-agent");
    expect(result.escalated).toEqual(["TC-ALARM-001"]);
  });

  it("never downgrades an existing failure to a pass", () => {
    const result = applyVisualEscalations(
      [exec({ status: "FAIL_FUNCTIONAL", message: "button missing" })],
      [{ case_id: "TC-ALARM-001", verdict: "PASS" }],
    );
    expect(result.executions[0]?.status).toBe("FAIL_FUNCTIONAL");
    expect(result.executions[0]?.message).toBe("button missing");
  });

  it("refuses to overwrite a specific failure with a visual one", () => {
    const result = applyVisualEscalations(
      [exec({ status: "FAIL_ACCESSIBILITY" })],
      [{ case_id: "TC-ALARM-001", verdict: "VISUAL_FAILURE" }],
    );
    expect(result.executions[0]?.status).toBe("FAIL_ACCESSIBILITY");
    expect(result.refused).toEqual(["TC-ALARM-001"]);
    // The verdict is still recorded as evidence, just not acted on.
    expect(result.executions[0]?.visual_verdict).toBe("VISUAL_FAILURE");
  });

  it("records a passing verdict as confirmation without changing status", () => {
    const result = applyVisualEscalations(
      [exec()],
      [{ case_id: "TC-ALARM-001", verdict: "PASS" }],
    );
    expect(result.executions[0]?.status).toBe("PASS");
    expect(result.executions[0]?.visual_verdict).toBe("PASS");
    expect(result.executions[0]?.verdict_source).toBe("xcuitest");
    expect(result.escalated).toEqual([]);
  });

  it("does not escalate on a warning — only on a failure", () => {
    const result = applyVisualEscalations(
      [exec()],
      [{ case_id: "TC-ALARM-001", verdict: "VISUAL_WARNING" }],
    );
    expect(result.executions[0]?.status).toBe("PASS");
    expect(result.executions[0]?.visual_verdict).toBe("VISUAL_WARNING");
  });

  it("leaves untouched executions alone and attaches evidence when escalating", () => {
    const result = applyVisualEscalations(
      [exec(), exec({ case_id: "TC-ALARM-002" })],
      [
        {
          case_id: "TC-ALARM-002",
          verdict: "VISUAL_FAILURE",
          evidence: [{ kind: "visual-diff", path: "diffs/002.png" }],
          message: "Header colour differs",
        },
      ],
    );
    expect(result.executions[0]?.status).toBe("PASS");
    expect(result.executions[1]?.status).toBe("FAIL_VISUAL");
    expect(result.executions[1]?.evidence).toHaveLength(1);
    expect(result.executions[1]?.message).toBe("Header colour differs");
  });

  it("can attribute an escalation to the probe instead of the agent", () => {
    const result = applyVisualEscalations(
      [exec()],
      [
        {
          case_id: "TC-ALARM-001",
          verdict: "VISUAL_FAILURE",
          source: "probe",
        },
      ],
    );
    expect(result.executions[0]?.verdict_source).toBe("probe");
  });
});

describe("judgedExecutions", () => {
  it("separates judged results from ones the test itself decided", () => {
    const executions = [
      exec(),
      exec({ case_id: "TC-2", verdict_source: "visual-agent" }),
      exec({ case_id: "TC-3", verdict_source: "probe" }),
    ];
    expect(judgedExecutions(executions).map((e) => e.case_id)).toEqual([
      "TC-2",
      "TC-3",
    ]);
  });
});
