import { describe, expect, it } from "vitest";
import {
  conformanceVerdict,
  failsCase,
  renderConformanceMarkdown,
} from "./conformance-verdict.js";
import type { ConformanceFinding } from "./design-conformance.js";

/**
 * The severity policy is the whole point of this module: a suite that goes red
 * the first time it compares against a design teaches people to ignore it. So
 * the default fails only on what is unambiguous.
 */

function finding(
  severity: ConformanceFinding["severity"],
  rule: ConformanceFinding["rule"] = "element-size",
): ConformanceFinding {
  return {
    rule,
    severity,
    element: "save-button",
    expected: "height 44pt",
    actual: "height 32pt",
    description: `${severity} finding`,
  };
}

describe("failsCase", () => {
  it("fails only on critical by default", () => {
    expect(failsCase(finding("critical"), "critical")).toBe(true);
    expect(failsCase(finding("major"), "critical")).toBe(false);
    expect(failsCase(finding("minor"), "critical")).toBe(false);
  });

  it("includes everything at or above the configured level", () => {
    expect(failsCase(finding("critical"), "major")).toBe(true);
    expect(failsCase(finding("major"), "major")).toBe(true);
    expect(failsCase(finding("minor"), "major")).toBe(false);

    expect(failsCase(finding("minor"), "minor")).toBe(true);
  });

  it("fails nothing when set to never", () => {
    for (const severity of ["blocker", "critical", "major", "minor"] as const) {
      expect(failsCase(finding(severity), "never"), severity).toBe(false);
    }
  });

  it("treats blocker as at least as severe as critical", () => {
    expect(failsCase(finding("blocker"), "critical")).toBe(true);
  });
});

describe("conformanceVerdict", () => {
  it("splits findings by the policy without dropping any", () => {
    const findings = [
      finding("critical", "missing-element"),
      finding("major"),
      finding("minor"),
    ];
    const verdict = conformanceVerdict({
      caseId: "TC-1",
      findings,
      failsAt: "critical",
    });
    expect(verdict.failing).toHaveLength(1);
    expect(verdict.warnings).toHaveLength(2);
    expect(verdict.failing.length + verdict.warnings.length).toBe(
      findings.length,
    );
  });

  it("produces no escalation when nothing fails", () => {
    const verdict = conformanceVerdict({
      caseId: "TC-1",
      findings: [finding("major"), finding("minor")],
      failsAt: "critical",
    });
    expect(verdict.escalation).toBeUndefined();
    expect(verdict.warnings).toHaveLength(2);
  });

  it("escalates as a probe-sourced visual failure naming the worst finding", () => {
    const verdict = conformanceVerdict({
      caseId: "TC-1",
      findings: [
        finding("critical", "missing-element"),
        finding("critical"),
        finding("minor"),
      ],
      failsAt: "critical",
    });
    expect(verdict.escalation?.verdict).toBe("VISUAL_FAILURE");
    expect(verdict.escalation?.source).toBe("probe");
    expect(verdict.escalation?.message).toContain("critical finding");
    expect(verdict.escalation?.message).toContain("+1 more");
  });

  it("attaches the evidence it was given", () => {
    const verdict = conformanceVerdict({
      caseId: "TC-1",
      findings: [finding("critical")],
      failsAt: "critical",
      evidence: [{ kind: "figma", path: "snapshots.json" }],
    });
    expect(verdict.escalation?.evidence).toHaveLength(1);
  });

  it("turns warnings into failures once the threshold is lowered", () => {
    const findings = [finding("major")];
    expect(
      conformanceVerdict({ caseId: "TC-1", findings, failsAt: "critical" })
        .escalation,
    ).toBeUndefined();
    expect(
      conformanceVerdict({ caseId: "TC-1", findings, failsAt: "major" })
        .escalation,
    ).toBeDefined();
  });
});

describe("renderConformanceMarkdown", () => {
  it("says so when there is nothing to report", () => {
    expect(renderConformanceMarkdown([])).toContain("No differences");
  });

  it("marks failures and warnings differently", () => {
    const md = renderConformanceMarkdown([
      {
        caseId: "TC-1",
        verdict: conformanceVerdict({
          caseId: "TC-1",
          findings: [finding("critical"), finding("minor")],
          failsAt: "critical",
        }),
      },
    ]);
    expect(md).toContain("**FAIL**");
    expect(md).toContain("warn ");
  });

  it("explains how to act when everything is only a warning", () => {
    const md = renderConformanceMarkdown([
      {
        caseId: "TC-1",
        verdict: conformanceVerdict({
          caseId: "TC-1",
          findings: [finding("major")],
          failsAt: "critical",
        }),
      },
    ]);
    expect(md).toContain("conformance_fails_at");
    expect(md).toContain("`major`");
  });
});
