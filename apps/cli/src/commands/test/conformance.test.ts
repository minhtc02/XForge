import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultTestConfig,
  parseTestPlan,
  snapshotFilePath,
  writeSnapshots,
  type DesignMap,
  type ProbeScreen,
  type SnapshotFile,
  type TestPlan,
} from "@xforge/test-core";
import { runConformance } from "./conformance.js";

/**
 * The join is what can go wrong here: three sources — plan, frozen Figma
 * snapshots, probe measurements — have to line up on the same screen. Every
 * missing piece must degrade to "nothing compared", never to a failure.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-conf-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function plan(): TestPlan {
  return parseTestPlan({
    id: "XFPLAN-1",
    project_id: "cuckoo",
    created_at: "2026-01-01T00:00:00.000Z",
    level: "regression",
    test_cases: [
      {
        id: "TC-ALARM-003",
        title: "Alarm matches design",
        feature: "alarm",
        types: ["visual"],
        priority: "P1",
        risk_score: 5,
        steps: [
          { id: "s1", action: "launch-app" },
          { id: "s2", action: "capture-screenshot", target: "alarm-list" },
        ],
        assertions: [{ id: "a1", kind: "screen-is", target: "alarm-list" }],
        automation: { framework: "xcuitest", blocked: false },
      },
      {
        id: "TC-ALARM-001",
        title: "Open alarm",
        feature: "alarm",
        types: ["functional"],
        priority: "P0",
        risk_score: 8,
        automation: { framework: "xcuitest", blocked: false },
      },
    ],
    permissions: {},
    estimated_duration: { min_minutes: 1, max_minutes: 2 },
    stats: { total_cases: 2, suites: 1, shards: 1, by_type: {} },
    inputs: { config_version: 1 },
  });
}

const designMap: DesignMap = {
  version: 1,
  features: {
    alarm: {
      screens: {
        "alarm-list": {
          device: "iPhone-15-Pro",
          states: { default: { node_id: "10:23" } },
        },
      },
    },
  },
};

function probe(overrides: Partial<ProbeScreen> = {}): ProbeScreen[] {
  return [
    {
      target: "alarm-list",
      reached: true,
      elements: [
        {
          identifier: "alarm-list",
          label: "",
          type: "Other",
          isEnabled: true,
          isHittable: false,
          width: 393,
          height: 852,
        },
        {
          identifier: "save-button",
          label: "Save",
          type: "Button",
          isEnabled: true,
          isHittable: true,
          width: 120,
          height: 32,
        },
      ],
      ...overrides,
    },
  ];
}

async function freeze(
  overrides: Partial<SnapshotFile["snapshots"][string]> = {},
): Promise<void> {
  await writeSnapshots(snapshotFilePath(root, "XFPLAN-1"), {
    schema_version: 1,
    file_key: "abc",
    file_version: "v9",
    source: "mcp",
    captured_at: "2026-01-01T00:00:00.000Z",
    snapshots: {
      "10:23": {
        node_id: "10:23",
        name: "Alarm List",
        width: 393,
        height: 852,
        variables: {},
        elements: { "save-button": { height: 44 } },
        ...overrides,
      },
    },
  });
}

describe("runConformance", () => {
  it("compares a visual case against its frozen design", async () => {
    await freeze();
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });

    expect(result.byCase).toHaveLength(1);
    expect(result.byCase[0]?.caseId).toBe("TC-ALARM-003");
    const warnings = result.byCase[0]!.verdict.warnings;
    expect(warnings.some((w) => w.description.includes("32pt"))).toBe(true);
  });

  it("does not fail a case on a size delta under the default policy", async () => {
    await freeze();
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });
    expect(result.escalations).toEqual([]);
  });

  it("fails a case when the design has an element the app never rendered", async () => {
    await freeze({ elements: { "ghost-button": { width: 100 } } });
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.verdict).toBe("VISUAL_FAILURE");
    expect(result.escalations[0]?.source).toBe("probe");
    expect(result.escalations[0]?.message).toContain("ghost-button");
  });

  it("fails on a size delta once the threshold is lowered", async () => {
    await freeze();
    const config = defaultTestConfig();
    config.visual.conformance_fails_at = "major";
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config,
      probeScreens: probe(),
      designMap,
    });
    expect(result.escalations.length).toBeGreaterThan(0);
  });

  it("only checks visual cases", async () => {
    await freeze();
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });
    expect(result.byCase.map((c) => c.caseId)).toEqual(["TC-ALARM-003"]);
  });

  it("skips quietly when no probe ran", async () => {
    await freeze();
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      designMap,
    });
    expect(result.escalations).toEqual([]);
    expect(result.skippedReason).toContain("probe");
  });

  it("skips quietly when no design was frozen", async () => {
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });
    expect(result.escalations).toEqual([]);
    expect(result.skippedReason).toContain("test design");
  });

  it("skips a screen the probe could not reach", async () => {
    await freeze();
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe({ reached: false }),
      designMap,
    });
    expect(result.byCase).toEqual([]);
  });

  it("skips a node that was templated but never filled in", async () => {
    await writeSnapshots(snapshotFilePath(root, "XFPLAN-1"), {
      schema_version: 1,
      file_key: "abc",
      file_version: "unknown",
      source: "mcp",
      captured_at: "",
      snapshots: {
        "10:23": { node_id: "10:23", name: "", variables: {}, elements: {} },
      },
    });
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });
    // An unfilled node must never be treated as "design says 0×0".
    expect(result.byCase).toEqual([]);
  });

  it("does nothing when conformance is disabled", async () => {
    await freeze();
    const config = defaultTestConfig();
    config.visual.conformance_enabled = false;
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config,
      probeScreens: probe(),
      designMap,
    });
    expect(result.skippedReason).toContain("conformance_enabled");
  });

  it("records the Figma node and source as evidence", async () => {
    await freeze({ elements: { ghost: { width: 10 } } });
    const result = await runConformance({
      projectRoot: root,
      plan: plan(),
      config: defaultTestConfig(),
      probeScreens: probe(),
      designMap,
    });
    const evidence = result.escalations[0]?.evidence?.[0];
    expect(evidence?.kind).toBe("figma");
    expect(evidence?.description).toContain("10:23");
    expect(evidence?.description).toContain("mcp");
  });
});
