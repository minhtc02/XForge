import { describe, expect, it } from "vitest";
import {
  checkDesignConformance,
  summarizeConformance,
} from "./design-conformance.js";
import type { ProbeElement } from "../generation/probe.js";
import type { FigmaNodeMetadata } from "../figma/adapter.js";

/**
 * These assert the property that makes measurement comparison worth having over
 * a pixel diff: a finding names the element and the number, so it is fixable.
 */

function element(overrides: Partial<ProbeElement> = {}): ProbeElement {
  return {
    identifier: "save-button",
    label: "Save",
    type: "Button",
    isEnabled: true,
    isHittable: true,
    width: 100,
    height: 44,
    ...overrides,
  };
}

const design: FigmaNodeMetadata = {
  node_id: "10:23",
  name: "Alarm List",
  width: 393,
  height: 852,
};

const screenRoot = element({
  identifier: "alarm-list",
  type: "Other",
  width: 393,
  height: 852,
  isHittable: false,
});

describe("checkDesignConformance", () => {
  it("passes a screen that matches its design", () => {
    const findings = checkDesignConformance({
      design,
      actual: [screenRoot, element()],
      screen: "alarm-list",
    });
    expect(findings).toEqual([]);
  });

  it("reports a frame size mismatch with the actual delta", () => {
    const findings = checkDesignConformance({
      design,
      actual: [{ ...screenRoot, width: 375 }, element()],
      screen: "alarm-list",
    });
    const frame = findings.find((f) => f.rule === "frame-size");
    expect(frame?.deltaPoints).toBe(-18);
    expect(frame?.description).toContain("393pt");
    expect(frame?.description).toContain("375pt");
  });

  it("ignores a difference inside the layout tolerance", () => {
    const findings = checkDesignConformance({
      design,
      actual: [{ ...screenRoot, width: 394 }, element()],
      screen: "alarm-list",
    });
    expect(findings.filter((f) => f.rule === "frame-size")).toEqual([]);
  });

  it("escalates a large size difference from minor to major", () => {
    const small = checkDesignConformance({
      design,
      actual: [{ ...screenRoot, width: 388 }],
      screen: "s",
    }).find((f) => f.rule === "frame-size");
    const large = checkDesignConformance({
      design,
      actual: [{ ...screenRoot, width: 300 }],
      screen: "s",
    }).find((f) => f.rule === "frame-size");
    expect(small?.severity).toBe("minor");
    expect(large?.severity).toBe("major");
  });

  it("flags a tap target below the HIG minimum", () => {
    const findings = checkDesignConformance({
      design,
      actual: [screenRoot, element({ width: 30, height: 30 })],
      screen: "alarm-list",
    });
    const tap = findings.find((f) => f.rule === "tap-target");
    expect(tap?.severity).toBe("major");
    expect(tap?.element).toBe("save-button");
    expect(tap?.actual).toBe("30×30pt");
    expect(tap?.description).toContain("44pt");
  });

  it("does not flag a non-interactive element as a tap target", () => {
    const findings = checkDesignConformance({
      design,
      actual: [
        screenRoot,
        element({ width: 10, height: 10, isHittable: false }),
      ],
      screen: "alarm-list",
    });
    expect(findings.filter((f) => f.rule === "tap-target")).toEqual([]);
  });

  it("reports an element the design has but the app did not render", () => {
    const findings = checkDesignConformance({
      design,
      actual: [screenRoot],
      screen: "alarm-list",
      expectedElements: { "save-button": { width: 100, height: 44 } },
    });
    const missing = findings.find((f) => f.rule === "missing-element");
    expect(missing?.severity).toBe("critical");
    expect(missing?.element).toBe("save-button");
  });

  it("names the element and both numbers for a size mismatch", () => {
    const findings = checkDesignConformance({
      design,
      actual: [screenRoot, element({ height: 32 })],
      screen: "alarm-list",
      expectedElements: { "save-button": { height: 44 } },
    });
    const size = findings.find((f) => f.rule === "element-size");
    // This is the whole point: actionable, not "3% different".
    expect(size?.description).toBe(
      "save-button height is 32pt; the design says 44pt (-12pt).",
    );
  });

  it("compares colour tokens across notation", () => {
    const mismatch = checkDesignConformance({
      design: { ...design, variables: { "color/primary": "#FF0000" } },
      actual: [screenRoot],
      screen: "s",
      expectedElements: { "save-button": { color: "rgb(0, 0, 255)" } },
    });
    expect(mismatch.find((f) => f.rule === "color-token")).toBeDefined();

    const match = checkDesignConformance({
      design: { ...design, variables: { "color/primary": "#FF0000" } },
      actual: [screenRoot],
      screen: "s",
      expectedElements: { "save-button": { color: "rgb(255, 0, 0)" } },
    });
    expect(match.find((f) => f.rule === "color-token")).toBeUndefined();
  });

  it("compares font size tokens", () => {
    const findings = checkDesignConformance({
      design: { ...design, variables: { "font/body": 17 } },
      actual: [screenRoot],
      screen: "s",
      expectedElements: { title: { fontSize: 15 } },
    });
    const font = findings.find((f) => f.rule === "font-token");
    expect(font?.deltaPoints).toBe(-2);
  });

  it("orders findings worst-first", () => {
    const findings = checkDesignConformance({
      design,
      actual: [screenRoot, element({ width: 20, height: 20 })],
      screen: "alarm-list",
      expectedElements: { ghost: { width: 10 } },
    });
    expect(findings[0]?.severity).toBe("critical");
  });
});

describe("summarizeConformance", () => {
  it("says so when there is nothing wrong", () => {
    expect(summarizeConformance([])).toBe("Matches the design reference");
  });

  it("leads with the worst finding and counts the rest", () => {
    const findings = checkDesignConformance({
      design,
      actual: [
        { ...screenRoot, width: 300 },
        element({ width: 20, height: 20 }),
      ],
      screen: "alarm-list",
    });
    const summary = summarizeConformance(findings);
    expect(summary).toContain("pt");
    expect(summary).toContain("+1 more");
  });
});
