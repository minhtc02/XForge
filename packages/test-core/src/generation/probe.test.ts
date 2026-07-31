import { describe, expect, it } from "vitest";
import {
  generateProbeFile,
  inventoryFromProbe,
  probeTargets,
  unreachableScreens,
  type ProbeScreen,
} from "./probe.js";
import {
  collectAttachments,
  probeAttachment,
  screenshotAttachments,
  xcresultExportCommand,
} from "../results/artifacts.js";
import type { TestCase } from "../models/test-case.js";

const cases: TestCase[] = [
  {
    id: "TC-ALARM-001",
    title: "Open Alarm",
    feature: "alarm",
    types: ["functional"],
    priority: "P0",
    risk_score: 8,
    requirements: [],
    code_references: [],
    design_references: [],
    preconditions: [],
    steps: [
      { id: "s1", action: "launch-app" },
      { id: "s2", action: "open", target: "alarm-list" },
      { id: "s3", action: "tap", target: "add-button" },
    ],
    expected_results: [],
    assertions: [{ id: "a1", kind: "screen-is", target: "alarm-detail" }],
    automation: { framework: "xcuitest", blocked: false },
    confidence: 0.7,
    provenance: ["source"],
  },
];

describe("probeTargets", () => {
  it("collects screens to visit from open steps and screen assertions", () => {
    // `tap` is an interaction, not a screen — it must not become a probe target.
    expect(probeTargets(cases)).toEqual(["alarm-detail", "alarm-list"]);
  });
});

describe("generateProbeFile", () => {
  it("emits a self-contained XCTestCase that attaches a JSON dump", () => {
    const src = generateProbeFile(cases);
    expect(src).toContain("import XCTest");
    expect(src).toContain("final class XForgeProbeTests: XCTestCase");
    expect(src).toContain("func test_XForgeProbe()");
    expect(src).toContain('"alarm-list"');
    expect(src).toContain('attachment.name = "xforge-probe"');
    expect(src).toContain("JSONEncoder()");
  });

  it("records unreachable screens instead of throwing on the first one", () => {
    const src = generateProbeFile(cases);
    expect(src).toContain("let reached = entry.waitForExistence");
    expect(src).not.toContain("XCTAssertTrue(reached");
  });
});

describe("inventoryFromProbe", () => {
  const screens: ProbeScreen[] = [
    {
      target: "alarm-list",
      reached: true,
      elements: [
        {
          identifier: "alarm-list",
          label: "Alarms",
          type: "table",
          isEnabled: true,
          isHittable: true,
          width: 300,
          height: 500,
        },
        {
          identifier: "alarm-row-1",
          label: "Wake up",
          type: "cell",
          isEnabled: true,
          isHittable: true,
          width: 300,
          height: 44,
        },
        {
          identifier: "",
          label: "decoration",
          type: "image",
          isEnabled: true,
          isHittable: false,
          width: 10,
          height: 10,
        },
      ],
    },
  ];

  it("turns a live dump into inventory entries the reconciler accepts", () => {
    const inventory = inventoryFromProbe(screens, "alarm");
    expect(inventory.map((i) => i.value)).toEqual([
      "alarm-list",
      "alarm-row-1",
    ]);
    // Live-observed identifiers are literal by definition: the dynamic
    // expression already evaluated, so nothing is left unresolvable.
    expect(inventory.every((i) => !i.dynamic)).toBe(true);
    expect(inventory[0]?.feature).toBe("alarm");
  });

  it("skips unidentified elements rather than inventing ids", () => {
    expect(inventoryFromProbe(screens)).toHaveLength(2);
  });
});

describe("unreachableScreens", () => {
  it("reports targets the probe could not open, ignoring the root", () => {
    expect(
      unreachableScreens([
        { target: "__root__", reached: true, elements: [] },
        { target: "alarm-list", reached: true, elements: [] },
        { target: "alarm-detail", reached: false, elements: [] },
      ]),
    ).toEqual(["alarm-detail"]);
  });
});

describe("xcresult artifacts", () => {
  const root = {
    actions: {
      _values: [
        {
          actionResult: {
            testsRef: {
              summaries: {
                _values: [
                  {
                    identifier: { _value: "XForgeUITests/test_TC_ALARM_001" },
                    attachments: {
                      _values: [
                        {
                          name: { _value: "alarm-list.png" },
                          uniformTypeIdentifier: { _value: "public.png" },
                          payloadRef: { id: { _value: "ATT-1" } },
                        },
                        {
                          name: { _value: "xforge-probe" },
                          uniformTypeIdentifier: { _value: "public.json" },
                          payloadRef: { id: { _value: "ATT-2" } },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };

  it("finds attachments however deeply they are nested", () => {
    const attachments = collectAttachments(root);
    expect(attachments.map((a) => a.id).sort()).toEqual(["ATT-1", "ATT-2"]);
    expect(attachments[0]?.testIdentifier).toContain("TC_ALARM_001");
  });

  it("separates screenshots from the probe dump", () => {
    const attachments = collectAttachments(root);
    expect(screenshotAttachments(attachments).map((a) => a.name)).toEqual([
      "alarm-list.png",
    ]);
    expect(probeAttachment(attachments)?.id).toBe("ATT-2");
  });

  it("returns nothing for an unexpected shape instead of crashing", () => {
    expect(collectAttachments({ unexpected: true })).toEqual([]);
    expect(collectAttachments(null)).toEqual([]);
  });

  it("builds an export command with no shell metacharacters", () => {
    const spec = xcresultExportCommand("/r/a.xcresult", "ATT-1", "/out/a.png");
    expect(spec.command).toBe("xcrun");
    expect(spec.args).toContain("--output-path");
    expect(spec.args).toContain("/out/a.png");
  });
});
