import { describe, expect, it } from "vitest";
import { classifyVisual } from "./visual.js";
import { auditAccessibility } from "./accessibility.js";
import { analyzePerformance, summarizeSamples } from "./performance.js";
import { defaultTestConfig } from "../config/index.js";

const visualThresholds = defaultTestConfig().visual;

describe("classifyVisual", () => {
  const base = {
    pixelDifference: 0,
    layoutOffsetPoints: 0,
    colorDelta: 0,
    referencePresent: true,
    stateMapped: true,
  };
  it("passes when everything is within tolerance", () => {
    expect(classifyVisual(base, visualThresholds)).toBe("PASS");
  });
  it("warns above the warning pixel threshold", () => {
    expect(
      classifyVisual({ ...base, pixelDifference: 0.02 }, visualThresholds),
    ).toBe("VISUAL_WARNING");
  });
  it("fails above the failure pixel threshold", () => {
    expect(
      classifyVisual({ ...base, pixelDifference: 0.05 }, visualThresholds),
    ).toBe("VISUAL_FAILURE");
  });
  it("reports a missing reference", () => {
    expect(
      classifyVisual({ ...base, referencePresent: false }, visualThresholds),
    ).toBe("DESIGN_REFERENCE_MISSING");
  });
  it("reports an unmapped state", () => {
    expect(
      classifyVisual({ ...base, stateMapped: false }, visualThresholds),
    ).toBe("DESIGN_STATE_UNMAPPED");
  });
});

describe("auditAccessibility", () => {
  it("flags interactive elements without identifiers/labels", () => {
    const findings = auditAccessibility("alarm-list", [
      { isInteractive: true },
    ]);
    expect(findings.some((f) => f.rule === "missing-identifier")).toBe(true);
    expect(findings.some((f) => f.rule === "missing-label")).toBe(true);
  });
  it("flags small hit targets", () => {
    const findings = auditAccessibility("s", [
      {
        identifier: "x",
        label: "X",
        isInteractive: true,
        frame: { width: 20, height: 20 },
      },
    ]);
    expect(findings.some((f) => f.rule === "small-hit-target")).toBe(true);
  });
  it("flags duplicate labels", () => {
    const findings = auditAccessibility("s", [
      {
        identifier: "a",
        label: "Save",
        isInteractive: true,
        frame: { width: 44, height: 44 },
      },
      {
        identifier: "b",
        label: "Save",
        isInteractive: true,
        frame: { width: 44, height: 44 },
      },
    ]);
    expect(findings.some((f) => f.rule === "duplicate-label")).toBe(true);
  });
  it("passes a well-formed element", () => {
    const findings = auditAccessibility("s", [
      {
        identifier: "save",
        label: "Save",
        isInteractive: true,
        frame: { width: 48, height: 48 },
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe("analyzePerformance", () => {
  const cfg = defaultTestConfig().performance;
  const baseline = {
    feature: "alarm",
    deviceProfile: "iphone-15-pro-simulator",
    metrics: { coldLaunchMs: 1000, peakMemoryMb: 100 },
  };
  it("passes when within warning threshold", () => {
    const a = analyzePerformance(
      "alarm",
      { coldLaunchMs: 1050 },
      baseline,
      cfg,
    );
    expect(a.results[0]!.verdict).toBe("PASS");
  });
  it("warns past the warning percent", () => {
    const a = analyzePerformance(
      "alarm",
      { coldLaunchMs: 1150 },
      baseline,
      cfg,
    );
    expect(a.results[0]!.verdict).toBe("WARNING");
  });
  it("regresses past the failure percent", () => {
    const a = analyzePerformance(
      "alarm",
      { coldLaunchMs: 1300 },
      baseline,
      cfg,
    );
    expect(a.results[0]!.verdict).toBe("REGRESSION");
    expect(a.worst).toBe("REGRESSION");
  });
  it("reports NO_BASELINE for an unknown metric", () => {
    const a = analyzePerformance("alarm", { newMetric: 5 }, baseline, cfg);
    expect(a.results[0]!.verdict).toBe("NO_BASELINE");
  });
});

describe("summarizeSamples", () => {
  it("returns null below the minimum sample count", () => {
    expect(
      summarizeSamples([1, 2], { discardOutliers: true, minimumSamples: 5 }),
    ).toBeNull();
  });
  it("discards outliers then averages", () => {
    const v = summarizeSamples([1, 10, 10, 10, 100], {
      discardOutliers: true,
      minimumSamples: 5,
    });
    expect(v).toBe(10);
  });
});
