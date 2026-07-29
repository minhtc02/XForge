import { describe, expect, it } from "vitest";
import { analyzeSwiftFile } from "../swift/parser.js";
import { detectFeatures } from "../analysis/features.js";
import { parsePrdDocument } from "./parser.js";
import { analyzeCoverage } from "./coverage.js";

describe("parsePrdDocument", () => {
  it("attaches descriptions to explicit id headings", () => {
    const content = [
      "# Cuckoo Alarm — PRD",
      "",
      "## PRD-ALARM-001",
      "Người dùng có thể tạo báo thức lặp lại.",
      "",
      "## PRD-ALARM-002",
      "Người dùng có thể tắt báo thức tạm thời.",
    ].join("\n");
    const reqs = parsePrdDocument({
      path: "_bmad-output/prd.md",
      content,
      sourceType: "bmad",
    });
    expect(reqs.map((r) => r.id)).toEqual(["PRD-ALARM-001", "PRD-ALARM-002"]);
    expect(reqs[0]!.description).toContain("báo thức lặp lại");
    expect(reqs[0]!.line).toBe(3);
  });

  it("parses inline explicit ids", () => {
    const content = "- PRD-SLEEP-001: Ứng dụng theo dõi giấc ngủ.";
    const reqs = parsePrdDocument({
      path: "docs/prd.md",
      content,
      sourceType: "prd",
    });
    expect(reqs[0]!.id).toBe("PRD-SLEEP-001");
    expect(reqs[0]!.description).toBe("Ứng dụng theo dõi giấc ngủ.");
  });

  it("generates ids for un-id'd requirement bullets", () => {
    const content = [
      "# Notes",
      "- User must be able to create a note",
      "- User can pin a note",
      "- Just a random sentence with no modal verb here",
    ].join("\n");
    const reqs = parsePrdDocument({
      path: "docs/notes.md",
      content,
      sourceType: "prd",
    });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.id).toMatch(/^PRD-NOTES-001$/);
    expect(reqs[1]!.id).toMatch(/^PRD-NOTES-002$/);
  });

  it("does not double-count a repeated explicit id", () => {
    const content = "PRD-A-001 first\nPRD-A-001 again";
    const reqs = parsePrdDocument({ path: "p.md", content, sourceType: "prd" });
    expect(reqs).toHaveLength(1);
  });

  it("does not drop an id heading immediately followed by another id heading", () => {
    const content = ["## PRD-ALARM-001", "## PRD-ALARM-002", "Body."].join(
      "\n",
    );
    const reqs = parsePrdDocument({
      path: "prd.md",
      content,
      sourceType: "prd",
    });
    expect(reqs.map((r) => r.id)).toEqual(["PRD-ALARM-001", "PRD-ALARM-002"]);
    // The first, bodyless, falls back to its id as description.
    expect(reqs[0]!.description).toBe("PRD-ALARM-001");
    expect(reqs[1]!.description).toBe("Body.");
  });

  it("flushes a trailing id heading with no body", () => {
    const content = ["## PRD-A-001", "Has body.", "## PRD-A-002"].join("\n");
    const reqs = parsePrdDocument({
      path: "prd.md",
      content,
      sourceType: "prd",
    });
    expect(reqs.map((r) => r.id)).toEqual(["PRD-A-001", "PRD-A-002"]);
  });
});

describe("analyzeCoverage", () => {
  function alarmFeatureWithTests() {
    const sources = [
      {
        path: "Sources/AlarmView.swift",
        analysis: analyzeSwiftFile(
          "Sources/AlarmView.swift",
          "struct AlarmView: View {}",
        ),
      },
      {
        path: "Sources/AlarmScheduler.swift",
        analysis: analyzeSwiftFile(
          "Sources/AlarmScheduler.swift",
          "final class AlarmScheduler {}",
        ),
      },
      {
        path: "Tests/AlarmSchedulerTests.swift",
        analysis: analyzeSwiftFile(
          "Tests/AlarmSchedulerTests.swift",
          "import XCTest\nfinal class AlarmSchedulerTests: XCTestCase {}",
        ),
      },
    ];
    return detectFeatures({ sources });
  }

  it("maps requirements to features by area and marks implemented", () => {
    const features = alarmFeatureWithTests();
    const reqs = parsePrdDocument({
      path: "prd.md",
      content: "## PRD-ALARM-001\nUser can create repeating alarms.",
      sourceType: "prd",
    });
    const result = analyzeCoverage(reqs, features);
    const row = result.matrix.find((r) => r.requirement === "PRD-ALARM-001")!;
    expect(row.feature).toBe("alarm");
    expect(row.implemented).toBe(true);
    expect(row.tested).toBe(true);
    expect(result.requirements[0]!.implementation_status).toBe("IMPLEMENTED");
    expect(features.find((f) => f.id === "alarm")!.requirements).toContain(
      "PRD-ALARM-001",
    );
  });

  it("reports planned-not-implemented for unmatched requirements", () => {
    const features = alarmFeatureWithTests();
    const reqs = parsePrdDocument({
      path: "prd.md",
      content: "## PRD-SYNC-005\nUser can sync alarms across devices.",
      sourceType: "prd",
    });
    const result = analyzeCoverage(reqs, features);
    expect(
      result.gaps.some(
        (g) =>
          g.kind === "planned-not-implemented" &&
          g.requirement === "PRD-SYNC-005",
      ),
    ).toBe(true);
  });

  it("reports implemented-not-in-prd for features without requirements", () => {
    const features = alarmFeatureWithTests();
    const result = analyzeCoverage([], features);
    expect(
      result.gaps.some(
        (g) => g.kind === "implemented-not-in-prd" && g.feature === "alarm",
      ),
    ).toBe(true);
  });

  it("reports implemented-not-tested when a feature has no test evidence", () => {
    const sources = [
      {
        path: "Sources/WeatherView.swift",
        analysis: analyzeSwiftFile(
          "Sources/WeatherView.swift",
          "struct WeatherView: View {}",
        ),
      },
      {
        path: "Sources/WeatherClient.swift",
        analysis: analyzeSwiftFile(
          "Sources/WeatherClient.swift",
          "final class WeatherClient {}",
        ),
      },
    ];
    const features = detectFeatures({ sources });
    const reqs = parsePrdDocument({
      path: "prd.md",
      content: "## PRD-WEATHER-001\nApp must show current weather.",
      sourceType: "prd",
    });
    const result = analyzeCoverage(reqs, features);
    expect(
      result.gaps.some(
        (g) =>
          g.kind === "implemented-not-tested" &&
          g.requirement === "PRD-WEATHER-001",
      ),
    ).toBe(true);
  });
});
