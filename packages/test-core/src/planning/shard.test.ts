import { describe, expect, it } from "vitest";
import { buildShards } from "./shard.js";
import type { TestCase, StateBucket } from "../models/test-case.js";
import type { DeviceConfig } from "../config/index.js";

const devices: DeviceConfig[] = [
  { name: "iPhone 15 Pro", runtime: "latest", roles: ["functional"] },
  { name: "iPhone SE", runtime: "latest", roles: ["visual", "accessibility"] },
];

function testCase(
  id: string,
  feature: string,
  state?: Partial<StateBucket>,
): TestCase {
  return {
    id,
    title: id,
    feature,
    types: ["functional"],
    priority: "P1",
    risk_score: 5,
    requirements: [],
    code_references: [],
    design_references: [],
    preconditions: [],
    ...(state
      ? {
          state: {
            fresh_install: false,
            reset_permissions: false,
            grant_permissions: [],
            revoke_permissions: [],
            ...state,
          },
        }
      : {}),
    steps: [],
    expected_results: [],
    assertions: [],
    automation: { framework: "xcuitest", blocked: false },
    confidence: 0.7,
    provenance: ["source"],
  };
}

describe("buildShards", () => {
  it("groups by feature when no case declares state", () => {
    const { shards } = buildShards(
      [
        testCase("TC-1", "alarm"),
        testCase("TC-2", "alarm"),
        testCase("TC-3", "sleep"),
      ],
      devices,
    );
    expect(shards.map((s) => s.id)).toEqual(["shard-alarm", "shard-sleep"]);
    expect(shards[0]?.state_key).toBe("default");
    expect(shards[0]?.case_ids).toEqual(["TC-1", "TC-2"]);
  });

  it("splits a feature into one shard per state bucket", () => {
    const { shards } = buildShards(
      [
        testCase("TC-1", "alarm"),
        testCase("TC-2", "alarm", { fresh_install: true }),
        testCase("TC-3", "alarm", { appearance: "dark" }),
      ],
      devices,
    );
    expect(shards).toHaveLength(3);
    expect(shards.map((s) => s.state_key).sort()).toEqual([
      "default",
      "fresh",
      "ui:dark",
    ]);
    // Each shard carries the state its cases asked for.
    const fresh = shards.find((s) => s.state_key === "fresh");
    expect(fresh?.state?.fresh_install).toBe(true);
    expect(fresh?.case_ids).toEqual(["TC-2"]);
  });

  it("keeps cases with the same state together", () => {
    const { shards } = buildShards(
      [
        testCase("TC-1", "alarm", { appearance: "dark" }),
        testCase("TC-2", "alarm", { appearance: "dark" }),
      ],
      devices,
    );
    expect(shards).toHaveLength(1);
    expect(shards[0]?.case_ids).toEqual(["TC-1", "TC-2"]);
  });

  it("charges each shard the fixed cost of its own xcodebuild invocation", () => {
    const single = buildShards([testCase("TC-1", "alarm")], devices);
    const split = buildShards(
      [
        testCase("TC-1", "alarm"),
        testCase("TC-2", "alarm", { fresh_install: true }),
      ],
      devices,
    );
    // Two shards cost more wall-clock than one, even for the same case count.
    expect(split.estimatedMinutes.max).toBeGreaterThan(
      single.estimatedMinutes.max,
    );
  });

  it("folds excess buckets back and reports them, never dropping cases", () => {
    const cases = [
      testCase("TC-1", "alarm"),
      testCase("TC-2", "alarm", { fresh_install: true }),
      testCase("TC-3", "alarm", { appearance: "dark" }),
      testCase("TC-4", "alarm", { appearance: "light" }),
      testCase("TC-5", "alarm", { content_size: "large" }),
    ];
    const { shards, mergedBuckets } = buildShards(cases, devices, {
      maxBucketsPerFeature: 2,
    });
    expect(shards).toHaveLength(2);
    expect(mergedBuckets.length).toBe(3);
    // No case may be lost to the cap.
    const allIds = shards.flatMap((s) => s.case_ids).sort();
    expect(allIds).toEqual(["TC-1", "TC-2", "TC-3", "TC-4", "TC-5"]);
  });

  it("gives each shard a distinct simulator worker name", () => {
    const { shards } = buildShards(
      [
        testCase("TC-1", "alarm"),
        testCase("TC-2", "alarm", { fresh_install: true }),
      ],
      devices,
    );
    const names = new Set(shards.map((s) => s.simulator_name));
    expect(names.size).toBe(shards.length);
  });
});
