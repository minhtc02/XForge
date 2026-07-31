import type { SimulatorShard } from "../models/plan.js";
import type { TestCase } from "../models/test-case.js";
import { stateBucketKey } from "../models/test-case.js";
import type { DeviceConfig } from "../config/index.js";

/**
 * Sharding (blueprint §18, optimization plan §B).
 *
 * The default strategy groups cases by feature so each Simulator worker owns one
 * feature's cases. When cases declare OS-level state (fresh install, granted
 * permissions, appearance), the grouping key becomes `(feature, state)` — a
 * shard is the smallest unit `simctl` can act on, because simctl runs in the
 * host process and cannot be interleaved between the cases of a single
 * `xcodebuild` invocation.
 *
 * Splitting by state costs one extra xcodebuild invocation per bucket, so the
 * split is capped and any folding is reported rather than done silently.
 */

/** ~ per-case wall-clock estimate (minutes) for duration budgeting. */
const MINUTES_PER_CASE = 0.5;

/** Fixed overhead of one extra `xcodebuild test-without-building` invocation. */
const MINUTES_PER_INVOCATION = 0.5;

function simulatorName(device: string, index: number): string {
  const compact = device.replace(/[^A-Za-z0-9]+/g, "");
  return `XForge-${compact}-Worker-${String(index + 1).padStart(2, "0")}`;
}

/** Pick the device best matching a set of test types via device roles. */
function deviceForTypes(
  devices: DeviceConfig[],
  types: string[],
): DeviceConfig {
  const scored = devices.map((d) => ({
    d,
    score: d.roles.filter((r) => types.includes(r)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.d ?? devices[0]!;
}

export interface ShardPlan {
  shards: SimulatorShard[];
  estimatedMinutes: { min: number; max: number };
  /** Buckets folded back into `default` because the cap was exceeded. */
  mergedBuckets: string[];
}

export interface ShardOptions {
  /** Cap on distinct state buckets per feature (bucket-explosion guard). */
  maxBucketsPerFeature?: number;
}

/** Build shards from the generated test cases, grouped by feature and state. */
export function buildShards(
  cases: TestCase[],
  devices: DeviceConfig[],
  options: ShardOptions = {},
): ShardPlan {
  const maxBuckets = options.maxBucketsPerFeature ?? 4;

  // Group by feature first so the cap can be applied per feature.
  const byFeature = new Map<string, TestCase[]>();
  for (const c of cases) {
    byFeature.set(c.feature, [...(byFeature.get(c.feature) ?? []), c]);
  }

  const fallbackDevice: DeviceConfig = devices[0] ?? {
    name: "iPhone 15 Pro",
    runtime: "latest",
    roles: [],
  };

  const shards: SimulatorShard[] = [];
  const mergedBuckets: string[] = [];
  let index = 0;

  for (const [feature, featureCases] of [...byFeature.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    // Group this feature's cases by their state bucket.
    let byState = new Map<string, TestCase[]>();
    for (const c of featureCases) {
      const key = stateBucketKey(c.state);
      byState.set(key, [...(byState.get(key) ?? []), c]);
    }

    // Bucket-explosion guard: keep the largest buckets and fold the rest into
    // `default`. Folding is reported — a silently dropped bucket would mean
    // cases running in a state they did not ask for.
    if (byState.size > maxBuckets) {
      const ordered = [...byState.entries()].sort(
        ([, a], [, b]) => b.length - a.length,
      );
      const keep = new Map(ordered.slice(0, maxBuckets));
      for (const [key, list] of ordered.slice(maxBuckets)) {
        mergedBuckets.push(`${feature}:${key}`);
        keep.set("default", [...(keep.get("default") ?? []), ...list]);
      }
      byState = keep;
    }

    for (const [stateKey, stateCases] of [...byState.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const types = [...new Set(stateCases.flatMap((c) => c.types))];
      const device =
        devices.length > 0 ? deviceForTypes(devices, types) : fallbackDevice;
      const estimated =
        stateCases.length * MINUTES_PER_CASE + MINUTES_PER_INVOCATION;
      const state = stateCases.find((c) => c.state)?.state;
      shards.push({
        id:
          stateKey === "default"
            ? `shard-${feature}`
            : `shard-${feature}-${slug(stateKey)}`,
        simulator_name: simulatorName(device.name, index),
        device: device.name,
        runtime: device.runtime,
        roles: device.roles,
        case_ids: stateCases.map((c) => c.id),
        sequential: true,
        estimated_minutes: Math.round(estimated * 100) / 100,
        ...(state ? { state } : {}),
        state_key: stateKey,
      });
      index += 1;
    }
  }

  // Wall-clock is the slowest shard (parallel) .. sum (fully sequential).
  const perShard = shards.map((s) => s.estimated_minutes);
  const max = perShard.reduce((a, b) => a + b, 0);
  const min = perShard.length > 0 ? Math.max(...perShard) : 0;
  return {
    shards,
    estimatedMinutes: {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
    },
    mergedBuckets,
  };
}

function slug(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
