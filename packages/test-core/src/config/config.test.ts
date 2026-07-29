import { describe, expect, it } from "vitest";
import { ConfigError } from "@xforge/shared";
import {
  TEST_CONFIG_VERSION,
  defaultTestConfig,
  validateTestConfig,
} from "./index.js";
import { DesignMap, designNodesForFeature } from "./design-map.js";

describe("test config", () => {
  it("applies defaults from a minimal config", () => {
    const cfg = validateTestConfig({ version: TEST_CONFIG_VERSION });
    expect(cfg.testability.mode).toBe("test-support");
    expect(cfg.workers.strategy).toBe("feature");
    expect(cfg.execution.continue_on_failure).toBe(true);
    expect(cfg.visual.pixel_difference_failure).toBe(0.03);
    expect(cfg.devices.length).toBeGreaterThan(0);
  });

  it("rejects an unsupported version", () => {
    expect(() => validateTestConfig({ version: 99 })).toThrow(ConfigError);
  });

  it("rejects a non-object", () => {
    expect(() => validateTestConfig(42)).toThrow(ConfigError);
  });

  it("preserves overrides", () => {
    const cfg = validateTestConfig({
      version: TEST_CONFIG_VERSION,
      execution: { retry_infrastructure_failure: 5 },
      workers: { strategy: "risk" },
    });
    expect(cfg.execution.retry_infrastructure_failure).toBe(5);
    expect(cfg.workers.strategy).toBe("risk");
  });

  it("defaultTestConfig is valid", () => {
    expect(defaultTestConfig().version).toBe(TEST_CONFIG_VERSION);
  });
});

describe("design map", () => {
  it("flattens screens/states into node references", () => {
    const map = DesignMap.parse({
      version: 1,
      features: {
        alarm: {
          screens: {
            "alarm-list": {
              device: "iPhone-15-Pro",
              states: {
                empty: { node_id: "10:23" },
                populated: { node_id: "10:24" },
              },
            },
          },
        },
      },
    });
    const nodes = designNodesForFeature(map, "alarm");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.device).toBe("iPhone-15-Pro");
    expect(nodes.map((n) => n.node_id).sort()).toEqual(["10:23", "10:24"]);
  });

  it("returns [] for an unknown feature", () => {
    const map = DesignMap.parse({ version: 1, features: {} });
    expect(designNodesForFeature(map, "ghost")).toEqual([]);
  });
});
