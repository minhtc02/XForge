import { describe, expect, it } from "vitest";
import { ValidationError } from "@xforge/shared";
import {
  parseProjectModel,
  parseProjectModelJson,
  serializeProjectModel,
} from "./index.js";

const minimal = {
  project: {
    id: "cuckoo-alarm",
    name: "Cuckoo Alarm",
    type: "ios-application",
  },
  metadata: { generator_version: "0.1.0" },
};

describe("project model", () => {
  it("parses a minimal model and applies defaults", () => {
    const model = parseProjectModel(minimal);
    expect(model.schema_version).toBe(1);
    expect(model.features).toEqual([]);
    expect(model.metadata.generated_by).toBe("xforge");
  });

  it("validates feature status enums and evidence", () => {
    const model = parseProjectModel({
      ...minimal,
      features: [
        {
          id: "alarm",
          name: "Alarm",
          status: "PARTIALLY_IMPLEMENTED",
          confidence: 0.8,
          evidence: [
            {
              file: "Sources/Alarm/AlarmScheduler.swift",
              kind: "source",
              start_line: 24,
              end_line: 98,
            },
          ],
        },
      ],
    });
    expect(model.features[0]!.status).toBe("PARTIALLY_IMPLEMENTED");
    expect(model.features[0]!.evidence[0]!.confidence).toBe(1);
  });

  it("rejects invalid status", () => {
    expect(() =>
      parseProjectModel({
        ...minimal,
        features: [{ id: "x", name: "X", status: "SORTA_DONE" }],
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a non-kebab feature id", () => {
    expect(() =>
      parseProjectModel({
        ...minimal,
        features: [{ id: "Alarm Feature", name: "X", status: "IMPLEMENTED" }],
      }),
    ).toThrow(ValidationError);
  });

  it("rejects confidence out of range", () => {
    expect(() =>
      parseProjectModel({
        ...minimal,
        features: [
          { id: "a", name: "A", status: "IMPLEMENTED", confidence: 1.5 },
        ],
      }),
    ).toThrow(ValidationError);
  });

  it("round-trips through JSON serialization", () => {
    const model = parseProjectModel(minimal);
    const json = serializeProjectModel(model);
    const reparsed = parseProjectModelJson(json);
    expect(reparsed).toEqual(model);
  });

  it("throws a ValidationError on malformed JSON", () => {
    expect(() => parseProjectModelJson("{not json")).toThrow(ValidationError);
  });
});
