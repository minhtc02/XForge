import { describe, expect, it } from "vitest";
import { ValidationError } from "@xforge/shared";
import {
  parseProjectModel,
  type ProjectModel,
} from "../project-model/index.js";
import {
  buildSemanticTemplate,
  mergeSemanticEnrichment,
  parseSemanticEnrichment,
  validateSemanticEvidence,
  type SemanticEnrichment,
} from "./index.js";

/**
 * The enrichment path is only safe because of two rules: a documented claim
 * needs text AND evidence, and every cited file must exist in the model.
 * These lock both in, plus the template/merge mechanics.
 */

const model: ProjectModel = parseProjectModel({
  project: {
    id: "cuckoo-alarm",
    name: "Cuckoo Alarm",
    type: "ios-application",
    platforms: ["ios"],
    languages: ["swift"],
  },
  technologies: [],
  features: [
    {
      id: "alarm",
      name: "Alarm",
      status: "IMPLEMENTED",
      confidence: 0.9,
      entry_points: [
        { name: "AlarmView", kind: "view", file: "Sources/AlarmView.swift" },
      ],
      source_files: ["Sources/AlarmView.swift"],
      requirements: [],
      evidence: [],
      frameworks: [],
    },
  ],
  requirements: [],
  source_files: [
    { path: "Sources/AlarmView.swift", language: "swift", role: "view" },
  ],
  gaps: [],
  assumptions: [],
  test_cases: [],
  data_models: [],
  persistence_entities: [],
  api_endpoints: [],
  analytics_events: [],
  accessibility_identifiers: [],
  metadata: { generator_version: "0.0.0" },
});

function enrichment(
  overrides: Partial<SemanticEnrichment> = {},
): SemanticEnrichment {
  return parseSemanticEnrichment({
    schema_version: 1,
    updated_at: "2026-08-17T00:00:00.000Z",
    features: {
      alarm: {
        user_flows: {
          status: "documented",
          text: "- Open the alarm list, tap +, choose a time.",
          sources: [{ file: "Sources/AlarmView.swift", line: 10 }],
        },
      },
    },
    ...overrides,
  });
}

describe("parseSemanticEnrichment", () => {
  it("applies defaults so a filled-in section may omit status fields", () => {
    const parsed = parseSemanticEnrichment({
      schema_version: 1,
      updated_at: "2026-08-17T00:00:00.000Z",
      features: { alarm: {} },
    });
    expect(parsed.features["alarm"]?.business_rules.status).toBe("unknown");
    expect(parsed.features["alarm"]?.business_rules.sources).toEqual([]);
  });

  it("strips template-only keys like _files and _instructions", () => {
    const parsed = parseSemanticEnrichment({
      _instructions: "fill me",
      schema_version: 1,
      updated_at: "2026-08-17T00:00:00.000Z",
      features: { alarm: { _files: ["Sources/AlarmView.swift"] } },
    });
    expect(Object.keys(parsed.features["alarm"] ?? {})).toEqual([
      "user_flows",
      "business_rules",
      "error_handling",
      "edge_cases",
    ]);
  });

  it("rejects a malformed document", () => {
    expect(() => parseSemanticEnrichment({ schema_version: 2 })).toThrow(
      ValidationError,
    );
  });
});

describe("validateSemanticEvidence", () => {
  it("accepts a documented section that cites a real file", () => {
    expect(validateSemanticEvidence(enrichment(), model)).toEqual([]);
  });

  it("rejects a documented section without text", () => {
    const bad = enrichment();
    const feature = bad.features["alarm"];
    if (!feature) throw new Error("fixture");
    feature.user_flows = {
      status: "documented",
      text: "  ",
      sources: [{ file: "Sources/AlarmView.swift" }],
    };
    const errors = validateSemanticEvidence(bad, model);
    expect(errors.join("\n")).toContain("non-empty text");
  });

  it("rejects a documented section without sources", () => {
    const bad = enrichment();
    const feature = bad.features["alarm"];
    if (!feature) throw new Error("fixture");
    feature.user_flows = { status: "documented", text: "flow", sources: [] };
    const errors = validateSemanticEvidence(bad, model);
    expect(errors.join("\n")).toContain("at least one source");
  });

  it("rejects a source ref to a file the model never saw", () => {
    const bad = enrichment();
    const feature = bad.features["alarm"];
    if (!feature) throw new Error("fixture");
    feature.user_flows.sources = [{ file: "Sources/Hallucinated.swift" }];
    const errors = validateSemanticEvidence(bad, model);
    expect(errors.join("\n")).toContain("Sources/Hallucinated.swift");
  });

  it("rejects an unknown feature id", () => {
    const bad = enrichment();
    const alarm = bad.features["alarm"];
    if (!alarm) throw new Error("fixture");
    bad.features["ghost"] = alarm;
    delete bad.features["alarm"];
    const errors = validateSemanticEvidence(bad, model);
    expect(errors.join("\n")).toContain("unknown feature id");
  });

  it("allows not_applicable with a note and no evidence", () => {
    const parsed = parseSemanticEnrichment({
      schema_version: 1,
      updated_at: "2026-08-17T00:00:00.000Z",
      features: {
        alarm: {
          edge_cases: {
            status: "not_applicable",
            note: "single-user local feature, no edge state",
          },
        },
      },
    });
    expect(validateSemanticEvidence(parsed, model)).toEqual([]);
  });
});

describe("mergeSemanticEnrichment", () => {
  it("merges per feature and takes the patch timestamp", () => {
    const existing = enrichment();
    const patch = parseSemanticEnrichment({
      schema_version: 1,
      updated_at: "2026-08-18T00:00:00.000Z",
      features: {
        alarm: {
          business_rules: {
            status: "documented",
            text: "Alarms repeat daily.",
            sources: [{ file: "Sources/AlarmView.swift" }],
          },
        },
      },
    });
    const merged = mergeSemanticEnrichment(existing, patch);
    expect(merged.updated_at).toBe("2026-08-18T00:00:00.000Z");
    // The patch replaces the whole feature entry — section-level carry-over
    // happens because templates are prefilled with the existing enrichment.
    expect(merged.features["alarm"]?.business_rules.status).toBe("documented");
  });

  it("starts from nothing when nothing was applied before", () => {
    const merged = mergeSemanticEnrichment(null, enrichment());
    expect(Object.keys(merged.features)).toEqual(["alarm"]);
  });
});

describe("buildSemanticTemplate", () => {
  it("covers every feature and section, citing only the feature's own files", () => {
    const template = buildSemanticTemplate(
      model,
      null,
      "2026-08-17T00:00:00.000Z",
    );
    const features = template["features"] as Record<
      string,
      Record<string, unknown>
    >;
    const alarm = features["alarm"];
    expect(alarm).toBeDefined();
    expect(alarm?.["_files"]).toEqual(["Sources/AlarmView.swift"]);
    for (const key of [
      "user_flows",
      "business_rules",
      "error_handling",
      "edge_cases",
    ]) {
      expect((alarm?.[key] as { status: string }).status).toBe("unknown");
    }
    expect(typeof template["_instructions"]).toBe("string");
  });

  it("prefills sections that were already documented", () => {
    const template = buildSemanticTemplate(
      model,
      enrichment(),
      "2026-08-17T00:00:00.000Z",
    );
    const features = template["features"] as Record<
      string,
      Record<string, { status: string }>
    >;
    expect(features["alarm"]?.["user_flows"]?.status).toBe("documented");
    expect(features["alarm"]?.["business_rules"]?.status).toBe("unknown");
  });

  it("emits a template the schema accepts on apply", () => {
    const template = buildSemanticTemplate(
      model,
      null,
      "2026-08-17T00:00:00.000Z",
    );
    expect(() => parseSemanticEnrichment(template)).not.toThrow();
  });
});
