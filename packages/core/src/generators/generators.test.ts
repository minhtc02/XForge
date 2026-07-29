import { describe, expect, it } from "vitest";
import {
  parseProjectModel,
  type ProjectModel,
} from "../project-model/index.js";
import {
  generateArchitecture,
  generateAssumptions,
  generateBuildAndRelease,
  generateCoverageDoc,
  generateEvidenceJsonl,
  generateFeatureDoc,
  generateGapsDoc,
  generateGettingStarted,
  generateOverview,
  generateReport,
  generateTestingStrategy,
  generateUndocumentedCode,
} from "./markdown.js";
import { featureOverviewDiagram } from "./mermaid.js";

const model: ProjectModel = parseProjectModel({
  project: {
    id: "cuckoo-alarm",
    name: "Cuckoo Alarm",
    type: "ios-application",
    platforms: ["ios"],
    languages: ["swift"],
  },
  technologies: [
    { name: "SwiftUI", category: "ui", confidence: 0.8 },
    { name: "XCTest", category: "testing", confidence: 0.9 },
  ],
  features: [
    {
      id: "alarm",
      name: "Alarm",
      status: "IMPLEMENTED",
      confidence: 0.9,
      entry_points: [
        { name: "AlarmView", kind: "view", file: "Sources/AlarmView.swift" },
      ],
      source_files: ["Sources/AlarmView.swift", "Sources/AlarmScheduler.swift"],
      requirements: ["PRD-ALARM-001"],
      evidence: [
        {
          file: "Sources/AlarmScheduler.swift",
          kind: "source",
          start_line: 1,
          end_line: 20,
          confidence: 0.9,
        },
        {
          file: "Tests/AlarmSchedulerTests.swift",
          kind: "test",
          confidence: 0.9,
        },
      ],
    },
  ],
  requirements: [
    {
      id: "PRD-ALARM-001",
      description: "User can create repeating alarms",
      source_type: "prd",
      implementation_status: "IMPLEMENTED",
      confidence: 0.6,
    },
  ],
  source_files: [
    { path: "Sources/AlarmView.swift", language: "swift", role: "view" },
    {
      path: "Sources/AlarmScheduler.swift",
      language: "swift",
      role: "scheduler",
    },
  ],
  gaps: [
    {
      requirement: "PRD-SYNC-005",
      status: "NOT_IMPLEMENTED",
      kind: "planned-not-implemented",
      description:
        "Requirement PRD-SYNC-005 has no matching implemented feature.",
    },
  ],
  metadata: {
    generator_version: "0.1.0",
    last_generated_at: "2026-07-29T00:00:00Z",
  },
});

describe("markdown generators", () => {
  it("overview lists features and counts", () => {
    const md = generateOverview({ model, language: "en" });
    expect(md).toContain("# Cuckoo Alarm — Project Overview");
    expect(md).toContain("**Alarm**");
    expect(md).toContain("<!-- xforge:generated:start -->");
    expect(md).toMatch(/generator_version: 0\.1\.0/);
  });

  it("feature doc includes source references for every claim", () => {
    const md = generateFeatureDoc(model.features[0]!, {
      model,
      language: "en",
    });
    expect(md).toContain("# Alarm");
    expect(md).toContain("`Sources/AlarmScheduler.swift:1-20`");
    expect(md).toContain("PRD-ALARM-001");
    expect(md).toContain('xforge:manual:start id="alarm-notes"');
  });

  it("architecture embeds a mermaid diagram", () => {
    const md = generateArchitecture({ model, language: "en" });
    expect(md).toContain("```mermaid");
    expect(md).toContain("Cuckoo Alarm");
  });

  it("coverage doc renders a matrix", () => {
    const md = generateCoverageDoc({
      model,
      language: "en",
      matrix: [
        {
          requirement: "PRD-ALARM-001",
          description: "x",
          feature: "alarm",
          implemented: true,
          tested: true,
          status: "IMPLEMENTED",
        },
      ],
    });
    expect(md).toContain(
      "| Requirement | Feature | Implemented | Tested | Status |",
    );
    expect(md).toContain("`PRD-ALARM-001`");
  });

  it("gaps doc groups by kind", () => {
    const md = generateGapsDoc({ model, language: "en" });
    expect(md).toContain("## planned-not-implemented");
    expect(md).toContain("PRD-SYNC-005");
  });

  it("evidence jsonl emits one row per evidence with owner", () => {
    const jsonl = generateEvidenceJsonl(model);
    const rows = jsonl
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(
      rows.some((r) => r.owner === "feature:alarm" && r.kind === "test"),
    ).toBe(true);
  });

  it("generation report summarizes stats and coverage", () => {
    const report = JSON.parse(generateReport(model, ["docs/project/index.md"]));
    expect(report.stats.features).toBe(1);
    expect(report.coverage.planned_not_implemented).toContain("PRD-SYNC-005");
    expect(report.written_files).toContain("docs/project/index.md");
  });

  it("mermaid diagram is well-formed for empty features", () => {
    expect(featureOverviewDiagram("X", [])).toContain("No features detected");
  });

  it("testing strategy splits tested vs untested features", () => {
    const md = generateTestingStrategy({ model, language: "en" });
    expect(md).toContain("Tested features (1)");
    expect(md).toContain("Untested features (0)");
    expect(md).toContain("Alarm");
  });

  it("undocumented code lists source files not in any feature", () => {
    const md = generateUndocumentedCode({ model, language: "en" });
    // Both source files belong to the alarm feature -> none orphaned.
    expect(md).toContain("Not detected");
  });

  it("getting-started and build-and-release render", () => {
    expect(generateGettingStarted({ model, language: "en" })).toContain(
      "Getting Started",
    );
    expect(generateBuildAndRelease({ model, language: "en" })).toContain(
      "Build & Release",
    );
  });

  it("assumptions doc renders empty state", () => {
    expect(generateAssumptions({ model, language: "en" })).toContain(
      "Not detected",
    );
  });
});
