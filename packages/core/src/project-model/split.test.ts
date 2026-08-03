import { describe, expect, it } from "vitest";
import {
  APPENDIX_FIELDS,
  isCoreOnly,
  mergeProjectModel,
  splitProjectModel,
} from "./split.js";
import { buildModelDigest } from "./digest.js";
import { parseProjectModel } from "./index.js";
import type { ProjectModel } from "./schema.js";

function model(fileCount = 3): ProjectModel {
  return parseProjectModel({
    project: { id: "app", name: "App", type: "ios-application" },
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.9,
        source_files: Array.from(
          { length: fileCount },
          (_, i) => `App/Alarm/F${i}.swift`,
        ),
        requirements: ["PRD-ALARM-001"],
      },
      {
        id: "sleep",
        name: "Sleep",
        status: "IMPLEMENTED",
        confidence: 0.8,
      },
    ],
    requirements: [
      {
        id: "PRD-ALARM-001",
        description: "Repeating alarms",
        source_type: "prd",
        implementation_status: "IMPLEMENTED",
        feature: "alarm",
      },
      {
        id: "PRD-SYNC-001",
        description: "Cloud sync",
        source_type: "prd",
        implementation_status: "NOT_IMPLEMENTED",
      },
    ],
    source_files: Array.from({ length: fileCount }, (_, i) => ({
      path: `App/Alarm/F${i}.swift`,
      language: "swift",
    })),
    symbols: Array.from({ length: fileCount }, (_, i) => ({
      name: `T${i}`,
      kind: "struct",
      file: `App/Alarm/F${i}.swift`,
    })),
    accessibility_identifiers: [
      {
        value: "alarm-list",
        expression: '"alarm-list"',
        file: "App/Alarm/F0.swift",
        dynamic: false,
        feature: "alarm",
      },
    ],
    gaps: [
      {
        requirement: "PRD-SYNC-001",
        status: "NOT_IMPLEMENTED",
        kind: "planned-not-implemented",
        description: "no impl",
      },
    ],
    assumptions: [
      {
        id: "assumption-001",
        description: "Feature boundary guessed",
        confidence: 0.7,
        needs_confirmation: true,
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
}

describe("splitProjectModel", () => {
  it("moves the per-file inventories out of the core", () => {
    const { core, appendices } = splitProjectModel(model(5));
    for (const field of APPENDIX_FIELDS) {
      expect(core[field], field).toEqual([]);
      expect(appendices[field].length, field).toBeGreaterThan(0);
    }
    // Everything else survives untouched.
    expect(core.features).toHaveLength(2);
    expect(core.requirements).toHaveLength(2);
  });

  it("records counts so 'listed separately' is not read as 'none'", () => {
    const { core } = splitProjectModel(model(5));
    expect(core.appendix_counts?.source_files).toBe(5);
    expect(core.appendix_counts?.symbols).toBe(5);
    expect(core.appendix_counts?.accessibility_identifiers).toBe(1);
  });

  it("round-trips through merge", () => {
    const original = model(4);
    const { core, appendices } = splitProjectModel(original);
    const merged = mergeProjectModel(core, appendices);
    expect(merged).toEqual(original);
  });

  it("merges what it has and leaves the rest empty", () => {
    const { core, appendices } = splitProjectModel(model(4));
    const partial = mergeProjectModel(core, { symbols: appendices.symbols });
    expect(partial.symbols).toHaveLength(4);
    expect(partial.source_files).toEqual([]);
  });

  it("shrinks the core substantially on a file-heavy model", () => {
    const original = model(500);
    const { core } = splitProjectModel(original);
    const before = JSON.stringify(original).length;
    const after = JSON.stringify(core).length;
    expect(after).toBeLessThan(before * 0.3);
  });
});

describe("isCoreOnly", () => {
  it("detects a core model whose appendices were not merged back", () => {
    const { core, appendices } = splitProjectModel(model(3));
    expect(isCoreOnly(core)).toBe(true);
    expect(isCoreOnly(mergeProjectModel(core, appendices))).toBe(false);
  });

  it("is false for a model that genuinely has no inventories", () => {
    const empty = parseProjectModel({
      project: { id: "app", name: "App", type: "ios-application" },
      metadata: { generator_version: "0.1.0" },
    });
    const { core } = splitProjectModel(empty);
    expect(isCoreOnly(core)).toBe(false);
  });
});

describe("buildModelDigest", () => {
  it("summarizes features without their file lists", () => {
    const digest = buildModelDigest(model(5));
    expect(digest.features).toHaveLength(2);
    expect(digest.features[0]).toMatchObject({
      id: "alarm",
      status: "IMPLEMENTED",
      files: 5,
      doc: "features/alarm.md",
    });
    // No file paths, no evidence — that is the point.
    expect(JSON.stringify(digest)).not.toContain("F0.swift");
  });

  it("lists only requirements that are not implemented", () => {
    const digest = buildModelDigest(model());
    expect(digest.open_requirements.map((r) => r.id)).toEqual(["PRD-SYNC-001"]);
  });

  it("reports appendix counts even when loaded core-only", () => {
    const { core } = splitProjectModel(model(7));
    const digest = buildModelDigest(core);
    // Reading a core model must not report "0 source files".
    expect(digest.counts.source_files).toBe(7);
    expect(digest.counts.symbols).toBe(7);
  });

  it("carries unconfirmed assumptions and a pointer map", () => {
    const digest = buildModelDigest(model());
    expect(digest.needs_confirmation).toHaveLength(1);
    expect(digest.see.full_model).toContain("project-model.json");
    expect(digest.see.source_files).toContain("model/source-files.json");
  });

  it("stays small relative to the model it summarizes", () => {
    const big = model(1000);
    const ratio =
      JSON.stringify(buildModelDigest(big)).length / JSON.stringify(big).length;
    expect(ratio).toBeLessThan(0.05);
  });
});
