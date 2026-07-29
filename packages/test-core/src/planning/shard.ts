import type { SimulatorShard } from "../models/plan.js";
import type { TestCase } from "../models/test-case.js";
import type { DeviceConfig } from "../config/index.js";

/**
 * Feature-based sharding (blueprint §18). Default strategy groups cases by
 * feature so each Simulator worker owns one feature's cases; cases sharing
 * mutable state stay sequential within a shard (§18, §4.6).
 */

/** ~ per-case wall-clock estimate (minutes) for duration budgeting. */
const MINUTES_PER_CASE = 0.5;

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
}

/** Build feature-based shards from the generated test cases. */
export function buildShards(
  cases: TestCase[],
  devices: DeviceConfig[],
): ShardPlan {
  const byFeature = new Map<string, TestCase[]>();
  for (const c of cases) {
    const list = byFeature.get(c.feature) ?? [];
    list.push(c);
    byFeature.set(c.feature, list);
  }

  const fallbackDevice: DeviceConfig = devices[0] ?? {
    name: "iPhone 15 Pro",
    runtime: "latest",
    roles: [],
  };

  const shards: SimulatorShard[] = [];
  let index = 0;
  for (const [feature, featureCases] of [...byFeature.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const types = [...new Set(featureCases.flatMap((c) => c.types))];
    const device =
      devices.length > 0 ? deviceForTypes(devices, types) : fallbackDevice;
    const estimated = featureCases.length * MINUTES_PER_CASE;
    shards.push({
      id: `shard-${feature}`,
      simulator_name: simulatorName(device.name, index),
      device: device.name,
      runtime: device.runtime,
      roles: device.roles,
      case_ids: featureCases.map((c) => c.id),
      sequential: true,
      estimated_minutes: Math.round(estimated * 100) / 100,
    });
    index += 1;
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
  };
}
