import { describe, expect, it } from "vitest";
import { parseProjectModel, type ProjectModel } from "@xforge/core";
import { detectOverrides, extractRequestedValues } from "./overrides.js";
import { resolveEffectiveSpec } from "./effective-spec.js";

function model(): ProjectModel {
  return parseProjectModel({
    project: {
      id: "app",
      name: "App",
      type: "ios-application",
      languages: ["swift"],
    },
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.8,
        entry_points: [
          { name: "AlarmView", kind: "view", file: "AlarmView.swift" },
        ],
        source_files: ["AlarmView.swift", "AlarmScheduler.swift"],
        requirements: ["PRD-ALARM-001"],
        evidence: [
          { file: "AlarmView.swift", kind: "source", confidence: 0.8 },
        ],
      },
    ],
    requirements: [
      {
        id: "PRD-ALARM-001",
        description: "Maximum alarms is enforced",
        source_type: "prd",
        implementation_status: "IMPLEMENTED",
        confidence: 0.6,
        feature: "alarm",
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
}

describe("extractRequestedValues", () => {
  it("parses change X to Y", () => {
    const v = extractRequestedValues("Please change maximum alarms to 20");
    expect(v.get("maximum alarms")).toBe("20");
  });
  it("parses key: value and key = value", () => {
    const v = extractRequestedValues("maximum alarms: 20\nretry count = 3");
    expect(v.get("maximum alarms")).toBe("20");
    expect(v.get("retry count")).toBe("3");
  });
});

describe("detectOverrides", () => {
  const docFacts = [
    {
      key: "maximum alarms",
      value: "10",
      doc_path: "docs/project/features/alarm.md",
    },
  ];
  it("detects an override when the request differs from docs", () => {
    const overrides = detectOverrides("change maximum alarms to 20", docFacts);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.docs_value).toBe("10");
    expect(overrides[0]!.requested_value).toBe("20");
  });
  it("does NOT create an override when request matches docs", () => {
    const overrides = detectOverrides("maximum alarms: 10", docFacts);
    expect(overrides).toHaveLength(0);
  });
  it("records new behavior with no docs_value when key is undocumented", () => {
    const overrides = detectOverrides("dark mode: enabled", docFacts);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.docs_value).toBeUndefined();
  });
});

describe("resolveEffectiveSpec", () => {
  it("returns docs requirements with no request", () => {
    const spec = resolveEffectiveSpec({ feature: "alarm", model: model() });
    expect(spec.requirements.map((r) => r.id)).toContain("PRD-ALARM-001");
    expect(spec.overrides).toHaveLength(0);
    expect(spec.differences).toHaveLength(0);
  });

  it("applies an override and records a difference (docs unchanged)", () => {
    const spec = resolveEffectiveSpec({
      feature: "alarm",
      model: model(),
      request: "change maximum alarms to 20",
      docFacts: [
        {
          key: "maximum alarms",
          value: "10",
          doc_path: "docs/project/features/alarm.md",
        },
      ],
    });
    expect(spec.overrides).toHaveLength(1);
    expect(spec.differences).toHaveLength(1);
    expect(spec.differences[0]!.docs_value).toBe("10");
    expect(spec.differences[0]!.effective_value).toBe("20");
    expect(spec.differences[0]!.status).toBe("RECORDED");
  });

  it("marks overridden requirement source as user-request", () => {
    const spec = resolveEffectiveSpec({
      feature: "alarm",
      model: model(),
      request: "maximum is: 20",
      docFacts: [
        {
          key: "maximum",
          value: "10",
          doc_path: "docs/project/features/alarm.md",
        },
      ],
    });
    // A new override-only requirement is added since "maximum" != PRD id/desc match.
    expect(spec.requirements.some((r) => r.source === "user-request")).toBe(
      true,
    );
  });
});
