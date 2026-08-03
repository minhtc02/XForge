import { describe, expect, it } from "vitest";
import { parseProjectModel, type ProjectModel } from "@xforge/core";
import { buildTestPlan, makePlanId } from "./plan-builder.js";
import { defaultTestConfig } from "../config/index.js";

function alarmModel(): ProjectModel {
  return parseProjectModel({
    project: {
      id: "cuckoo",
      name: "Cuckoo",
      type: "ios-application",
      languages: ["swift"],
    },
    technologies: [
      {
        name: "UserNotifications",
        category: "notifications",
        confidence: 0.9,
        evidence: [],
      },
    ],
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.9,
        entry_points: [
          { name: "AlarmView", kind: "view", file: "AlarmView.swift" },
        ],
        source_files: ["AlarmView.swift", "AlarmScheduler.swift"],
        requirements: ["PRD-ALARM-001"],
        evidence: [
          { file: "AlarmView.swift", kind: "source", confidence: 0.9 },
          { file: "AlarmTests.swift", kind: "test", confidence: 0.9 },
        ],
      },
      {
        id: "sleep",
        name: "Sleep",
        status: "IMPLEMENTED",
        confidence: 0.7,
        entry_points: [
          { name: "SleepView", kind: "view", file: "SleepView.swift" },
        ],
        source_files: ["SleepView.swift"],
        requirements: [],
        evidence: [
          { file: "SleepView.swift", kind: "source", confidence: 0.7 },
        ],
      },
    ],
    requirements: [
      {
        id: "PRD-ALARM-001",
        description: "User can create alarms",
        source_type: "prd",
        implementation_status: "IMPLEMENTED",
        confidence: 0.6,
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
}

const baseEnv = {
  hasUiTestTarget: true,
  hasAccessibilityIdentifiers: true,
  figmaFrameCount: 0,
  existingTestCount: 5,
};

describe("buildTestPlan", () => {
  it("generates cases, suites and shards per feature", () => {
    const plan = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config: defaultTestConfig(),
      level: "regression",
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;
    expect(plan.test_cases.length).toBeGreaterThan(0);
    expect(plan.suites).toHaveLength(2);
    expect(plan.stats.total_cases).toBe(plan.test_cases.length);
    // Two features, each split into a single-device group (functional) and a
    // per-device group (visual/accessibility) across the two configured
    // devices — see the responsive fan-out below.
    expect(plan.shards.length).toBeGreaterThan(2);
    expect(new Set(plan.shards.map((s) => s.device)).size).toBe(2);
  });

  it("runs visual and accessibility cases on every matching device", () => {
    const plan = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config: defaultTestConfig(),
      level: "regression",
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;

    const byCase = new Map(plan.test_cases.map((c) => [c.id, c]));
    const devicesFor = (
      predicate: (types: string[]) => boolean,
    ): Set<string> => {
      const devices = new Set<string>();
      for (const shard of plan.shards) {
        for (const id of shard.case_ids) {
          if (predicate(byCase.get(id)?.types ?? [])) devices.add(shard.device);
        }
      }
      return devices;
    };

    // The bug this exists to catch — layout breaking on the small screen — is
    // only findable if the case actually runs there.
    expect(devicesFor((t) => t.includes("visual")).size).toBe(2);
    // A functional case gains nothing from a second screen, and costs a shard.
    expect(devicesFor((t) => t.join() === "functional").size).toBe(1);
  });

  it("does not fan out when responsive expansion is off", () => {
    const config = defaultTestConfig();
    config.responsive.enabled = false;
    const plan = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config,
      level: "regression",
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;
    expect(plan.shards).toHaveLength(2);
  });

  it("honors the feature filter", () => {
    const plan = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config: defaultTestConfig(),
      level: "smoke",
      featureFilter: ["alarm"],
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;
    expect(plan.scope).toEqual(["Alarm"]);
    expect(plan.test_cases.every((c) => c.feature === "alarm")).toBe(true);
  });

  it("adds more categories at higher levels", () => {
    const smoke = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config: defaultTestConfig(),
      level: "smoke",
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;
    const full = buildTestPlan({
      planId: "XFPLAN-2",
      model: alarmModel(),
      config: defaultTestConfig(),
      level: "full",
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;
    expect(full.test_cases.length).toBeGreaterThan(smoke.test_cases.length);
    expect(Object.keys(full.stats.by_type).length).toBeGreaterThan(
      Object.keys(smoke.stats.by_type).length,
    );
  });

  it("marks cases blocked when read-only mode hits a hard blocker", () => {
    const config = defaultTestConfig();
    config.testability.mode = "read-only";
    const plan = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config,
      level: "smoke",
      inputs: { config_version: 1 },
      environment: { ...baseEnv, hasUiTestTarget: false },
    }).plan;
    expect(plan.test_cases.every((c) => c.automation.blocked)).toBe(true);
  });

  it("requests Figma read permission only when frames exist and figma is enabled", () => {
    const config = defaultTestConfig();
    config.figma.enabled = true;
    const withFrames = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config,
      level: "smoke",
      inputs: { config_version: 1 },
      environment: { ...baseEnv, figmaFrameCount: 3 },
    }).plan;
    expect(withFrames.permissions.readFigmaFrames).toBe(true);
    const noFrames = buildTestPlan({
      planId: "XFPLAN-2",
      model: alarmModel(),
      config,
      level: "smoke",
      inputs: { config_version: 1 },
      environment: { ...baseEnv, figmaFrameCount: 0 },
    }).plan;
    expect(noFrames.permissions.readFigmaFrames).toBe(false);
  });

  it("never declares production modifications in test-support mode", () => {
    const plan = buildTestPlan({
      planId: "XFPLAN-1",
      model: alarmModel(),
      config: defaultTestConfig(),
      level: "full",
      inputs: { config_version: 1 },
      environment: baseEnv,
    }).plan;
    expect(plan.production_modifications).toEqual([]);
  });
});

describe("makePlanId", () => {
  it("formats a date + sequence", () => {
    expect(makePlanId(new Date("2026-07-29T10:00:00Z"), 1)).toBe(
      "XFPLAN-20260729-001",
    );
  });
});
