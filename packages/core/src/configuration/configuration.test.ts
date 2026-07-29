import { describe, expect, it } from "vitest";
import { ConfigError } from "@xforge/shared";
import {
  CONFIG_VERSION,
  defaultConfig,
  serializeConfig,
  validateConfig,
} from "./index.js";

describe("config validation", () => {
  it("applies defaults from a minimal config", () => {
    const cfg = validateConfig({ version: CONFIG_VERSION });
    expect(cfg.project.profile).toBe("ios-swift");
    expect(cfg.output.root).toBe("docs/project");
    expect(cfg.output.language).toBe("vi");
    expect(cfg.generation.minimum_confidence).toBe(0.75);
    expect(cfg.exclude).toContain("Pods/**");
    expect(cfg.exclude).toContain("**/GoogleService-Info.plist");
  });

  it("rejects a config that is not an object", () => {
    expect(() => validateConfig("nope")).toThrow(ConfigError);
  });

  it("rejects an unsupported (older) version", () => {
    expect(() => validateConfig({ version: 0 })).toThrow(ConfigError);
  });

  it("rejects a newer version with a helpful message", () => {
    try {
      validateConfig({ version: CONFIG_VERSION + 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).toContain("newer than supported");
    }
  });

  it("preserves user overrides", () => {
    const cfg = validateConfig({
      version: CONFIG_VERSION,
      output: { root: "documentation", language: "en" },
      generation: { minimum_confidence: 0.9 },
    });
    expect(cfg.output.root).toBe("documentation");
    expect(cfg.output.language).toBe("en");
    expect(cfg.generation.minimum_confidence).toBe(0.9);
  });

  it("accepts explicit feature path config", () => {
    const cfg = validateConfig({
      version: CONFIG_VERSION,
      features: { alarm: { paths: ["App/Features/Alarm/**"] } },
    });
    expect(cfg.features.alarm?.paths).toEqual(["App/Features/Alarm/**"]);
  });

  it("rejects minimum_confidence out of range", () => {
    expect(() =>
      validateConfig({
        version: CONFIG_VERSION,
        generation: { minimum_confidence: 2 },
      }),
    ).toThrow(ConfigError);
  });
});

describe("defaultConfig + serializeConfig", () => {
  it("round-trips a default config through YAML validation", () => {
    const cfg = defaultConfig({ name: "Cuckoo Alarm" });
    expect(cfg.project.name).toBe("Cuckoo Alarm");
    const yaml = serializeConfig(cfg);
    expect(yaml).toContain("version: 1");
    expect(yaml.startsWith("# XForge configuration")).toBe(true);
  });
});
