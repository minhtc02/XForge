import { describe, expect, it } from "vitest";
import {
  affectedDocuments,
  buildDependencyGraph,
  buildFeatureMap,
  buildGenerationState,
  buildRequirementMap,
  classifyChange,
  featureDocPath,
  PROJECT_DOCS,
} from "./index.js";
import { parseProjectModel } from "../project-model/index.js";
import type { ProjectModel } from "../project-model/schema.js";

function model(): ProjectModel {
  return parseProjectModel({
    project: { id: "cuckoo", name: "Cuckoo", type: "ios-application" },
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.9,
        source_files: ["Sources/Alarm/AlarmView.swift"],
        requirements: ["PRD-ALARM-001"],
      },
      {
        id: "sleep",
        name: "Sleep",
        status: "IMPLEMENTED",
        confidence: 0.8,
        source_files: ["Sources/Sleep/SleepView.swift"],
      },
    ],
    requirements: [
      {
        id: "PRD-ALARM-001",
        description: "Create a repeating alarm",
        source_type: "prd",
        implementation_status: "IMPLEMENTED",
        feature: "alarm",
      },
    ],
    source_files: [
      { path: "Sources/Alarm/AlarmView.swift", language: "swift" },
      { path: "Sources/Sleep/SleepView.swift", language: "swift" },
    ],
    metadata: { generator_version: "0.1.0" },
  });
}

describe("classifyChange", () => {
  it("classifies each input family", () => {
    expect(classifyChange("Sources/A.swift")).toBe("swift");
    expect(classifyChange("Package.swift")).toBe("manifest");
    expect(classifyChange("Podfile")).toBe("manifest");
    expect(classifyChange("App/Info.plist")).toBe("plist");
    expect(classifyChange("App/App.entitlements")).toBe("plist");
    expect(classifyChange(".specify/memory/constitution.md")).toBe("rules");
    expect(classifyChange("CLAUDE.md")).toBe("rules");
    expect(classifyChange("docs/prd.md")).toBe("prd");
    expect(classifyChange("README.md")).toBe("docs");
    expect(classifyChange("assets/icon.png")).toBe("other");
  });

  it("treats Package.swift as a manifest, not Swift source", () => {
    expect(classifyChange("Package.swift")).not.toBe("swift");
  });
});

describe("affectedDocuments", () => {
  it("scopes a feature's Swift change to that feature's document", () => {
    const docs = affectedDocuments(model(), ["Sources/Alarm/AlarmView.swift"]);
    expect(docs?.has(featureDocPath("alarm"))).toBe(true);
    expect(docs?.has(featureDocPath("sleep"))).toBe(false);
  });

  it("regenerates every feature document when a file cannot be attributed", () => {
    const docs = affectedDocuments(model(), ["Sources/New/Thing.swift"]);
    expect(docs?.has(featureDocPath("alarm"))).toBe(true);
    expect(docs?.has(featureDocPath("sleep"))).toBe(true);
  });

  it("maps a manifest change to dependency-facing documents only", () => {
    const docs = affectedDocuments(model(), ["Package.swift"]);
    expect(docs?.has(PROJECT_DOCS.thirdParty)).toBe(true);
    expect(docs?.has(PROJECT_DOCS.technologyStack)).toBe(true);
    expect(docs?.has(PROJECT_DOCS.accessibility)).toBe(false);
  });

  it("maps a plist change to security and notification documents", () => {
    const docs = affectedDocuments(model(), ["App/Info.plist"]);
    expect(docs?.has(PROJECT_DOCS.security)).toBe(true);
    expect(docs?.has(PROJECT_DOCS.notifications)).toBe(true);
    expect(docs?.has(PROJECT_DOCS.dataModels)).toBe(false);
  });

  it("falls back to a full regeneration for an unknown input kind", () => {
    expect(affectedDocuments(model(), ["assets/icon.png"])).toBeUndefined();
  });

  it("returns an empty set when nothing changed", () => {
    expect(affectedDocuments(model(), [])?.size).toBe(0);
  });

  it("always includes the index so navigation stays current", () => {
    const docs = affectedDocuments(model(), ["Sources/Alarm/AlarmView.swift"]);
    expect(docs?.has(PROJECT_DOCS.index)).toBe(true);
  });
});

describe("state artifacts", () => {
  it("builds a file → documents dependency graph", () => {
    const graph = buildDependencyGraph(model(), "2026-07-31T00:00:00.000Z");
    const entry = graph.files["Sources/Alarm/AlarmView.swift"];
    expect(entry?.feature).toBe("alarm");
    expect(entry?.documents).toContain(featureDocPath("alarm"));
    expect(entry?.documents).not.toContain(featureDocPath("sleep"));
  });

  it("builds a feature map keyed by feature id", () => {
    const map = buildFeatureMap(model(), "t") as {
      features: Record<string, { document: string }>;
    };
    expect(Object.keys(map.features).sort()).toEqual(["alarm", "sleep"]);
    expect(map.features.alarm?.document).toBe("features/alarm.md");
  });

  it("builds a requirement map linking to its feature document", () => {
    const map = buildRequirementMap(model(), "t") as {
      requirements: Record<string, { documents: string[] }>;
    };
    expect(map.requirements["PRD-ALARM-001"]?.documents).toContain(
      "features/alarm.md",
    );
  });

  it("records whether a run was scoped", () => {
    const full = buildGenerationState({
      model: model(),
      writtenFiles: ["a.md"],
      generatedAt: "t",
      fileCount: 2,
    }) as { scoped_documents: unknown };
    expect(full.scoped_documents).toBeNull();

    const scoped = buildGenerationState({
      model: model(),
      writtenFiles: ["a.md"],
      generatedAt: "t",
      fileCount: 2,
      scoped: ["a.md"],
    }) as { scoped_documents: unknown };
    expect(scoped.scoped_documents).toEqual(["a.md"]);
  });
});
