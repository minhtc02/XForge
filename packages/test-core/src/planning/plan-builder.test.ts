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
  it("generates cases, suites and one shard per feature", () => {
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
    expect(plan.shards).toHaveLength(2);
    expect(plan.stats.total_cases).toBe(plan.test_cases.length);
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
