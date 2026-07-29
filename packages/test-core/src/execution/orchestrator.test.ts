import { describe, expect, it } from "vitest";
import { parseProjectModel } from "@xforge/core";
import { buildTestPlan } from "../planning/plan-builder.js";
import { defaultTestConfig } from "../config/index.js";
import { DryRunCommandRunner } from "./runner.js";
import {
  extractResultBundlePath,
  makeRunId,
  orchestrateRun,
} from "./orchestrator.js";
import type { CommandRunner, CommandResult, CommandSpec } from "./runner.js";
import type { TestExecution } from "../models/result.js";

function plan() {
  const model = parseProjectModel({
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
        source_files: ["AlarmView.swift"],
        requirements: [],
        evidence: [
          { file: "AlarmView.swift", kind: "source", confidence: 0.8 },
        ],
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
  return buildTestPlan({
    planId: "XFPLAN-1",
    model,
    config: defaultTestConfig(),
    level: "smoke",
    inputs: { config_version: 1 },
    environment: {
      hasUiTestTarget: true,
      hasAccessibilityIdentifiers: true,
      figmaFrameCount: 0,
      existingTestCount: 0,
    },
    createdAt: "2026-07-29T00:00:00Z",
  });
}

describe("orchestrateRun", () => {
  it("dry-run records build + shard commands and marks cases skipped", async () => {
    const runner = new DryRunCommandRunner();
    const result = await orchestrateRun({
      plan: plan(),
      config: defaultTestConfig(),
      runId: "XFRUN-1",
      runner,
      dryRun: true,
      now: () => new Date("2026-07-29T00:00:00Z"),
    });
    expect(result.dry_run).toBe(true);
    expect(runner.recorded.some((c) => c.label === "build-for-testing")).toBe(
      true,
    );
    expect(result.executions.every((e) => e.status === "SKIPPED")).toBe(true);
    // Dry run has no product failures -> gate passes.
    expect(result.gate_passed).toBe(true);
  });

  it("marks every case as infrastructure failure when the build fails", async () => {
    const failingBuild: CommandRunner = {
      async run(spec: CommandSpec): Promise<CommandResult> {
        return {
          spec,
          code: spec.label === "build-for-testing" ? 65 : 0,
          stdout: "",
          stderr: "build failed",
          durationMs: 1,
        };
      },
    };
    const result = await orchestrateRun({
      plan: plan(),
      config: defaultTestConfig(),
      runId: "XFRUN-1",
      runner: failingBuild,
      dryRun: false,
      now: () => new Date("2026-07-29T00:00:00Z"),
    });
    expect(result.executions.length).toBeGreaterThan(0);
    expect(
      result.executions.every((e) => e.status === "INFRASTRUCTURE_FAILURE"),
    ).toBe(true);
    expect(result.gate_passed).toBe(true); // infra failures are not product failures
  });

  it("collects shard results when the test command succeeds", async () => {
    const okRunner: CommandRunner = {
      async run(spec) {
        return { spec, code: 0, stdout: "", stderr: "", durationMs: 1 };
      },
    };
    const collect = async (shardId: string): Promise<TestExecution[]> => [
      {
        case_id: "TC-ALARM-001",
        shard_id: shardId,
        status: "PASS",
        duration_ms: 10,
        retries: 0,
        evidence: [],
      },
      {
        case_id: "TC-ALARM-002",
        shard_id: shardId,
        status: "FAIL_FUNCTIONAL",
        duration_ms: 10,
        retries: 0,
        evidence: [],
      },
    ];
    const result = await orchestrateRun({
      plan: plan(),
      config: defaultTestConfig(),
      runId: "XFRUN-1",
      runner: okRunner,
      dryRun: false,
      collectShardResults: collect,
      now: () => new Date("2026-07-29T00:00:00Z"),
    });
    expect(result.stats.passed).toBe(1);
    expect(result.stats.failed).toBe(1);
    expect(result.gate_passed).toBe(false);
  });

  it("retries infrastructure failures up to the configured limit", async () => {
    let calls = 0;
    const flaky: CommandRunner = {
      async run(spec) {
        if (spec.label.startsWith("test-without-building")) calls += 1;
        return {
          spec,
          code: spec.label.startsWith("test-without-building") ? 70 : 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
        };
      },
    };
    const config = defaultTestConfig();
    config.execution.retry_infrastructure_failure = 2;
    const result = await orchestrateRun({
      plan: plan(),
      config,
      runId: "XFRUN-1",
      runner: flaky,
      dryRun: false,
      collectShardResults: async () => [],
      now: () => new Date("2026-07-29T00:00:00Z"),
    });
    // 1 initial + 2 retries = 3 attempts per shard (1 shard).
    expect(calls).toBe(3);
    expect(
      result.executions.every((e) => e.status === "INFRASTRUCTURE_FAILURE"),
    ).toBe(true);
  });
});

describe("helpers", () => {
  it("extractResultBundlePath finds the bundle arg", () => {
    expect(
      extractResultBundlePath([
        "test-without-building",
        "-resultBundlePath",
        "a.xcresult",
      ]),
    ).toBe("a.xcresult");
  });
  it("makeRunId formats date + sequence", () => {
    expect(makeRunId(new Date("2026-07-29T00:00:00Z"), 1)).toBe(
      "XFRUN-20260729-001",
    );
  });
});
