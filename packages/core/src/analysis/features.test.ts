import { describe, expect, it } from "vitest";
import { analyzeSwiftFile } from "../swift/parser.js";
import {
  detectFeatures,
  featureId,
  featureName,
  type AnalyzedSource,
} from "./features.js";

function src(path: string, content: string): AnalyzedSource {
  return { path, analysis: analyzeSwiftFile(path, content) };
}

describe("featureId / featureName", () => {
  it("kebab-cases camel and spaced labels", () => {
    expect(featureId("HabitAlarm")).toBe("habit-alarm");
    expect(featureId("Sleep Tracking")).toBe("sleep-tracking");
    expect(featureName("habit-alarm")).toBe("Habit Alarm");
  });
});

describe("detectFeatures", () => {
  it("clusters by name prefix and records entry points + evidence", () => {
    const sources = [
      src(
        "Sources/AlarmView.swift",
        "import SwiftUI\nstruct AlarmView: View {}",
      ),
      src(
        "Sources/AlarmViewModel.swift",
        "import Foundation\nfinal class AlarmViewModel: ObservableObject {}",
      ),
      src(
        "Sources/AlarmScheduler.swift",
        "import UserNotifications\nfinal class AlarmScheduler {}",
      ),
      src(
        "Tests/AlarmSchedulerTests.swift",
        "import XCTest\n@testable import App\nfinal class AlarmSchedulerTests: XCTestCase {}",
      ),
    ];
    const features = detectFeatures({ sources });
    const alarm = features.find((f) => f.id === "alarm");
    expect(alarm).toBeDefined();
    expect(alarm!.source_files).toEqual([
      "Sources/AlarmScheduler.swift",
      "Sources/AlarmView.swift",
      "Sources/AlarmViewModel.swift",
    ]);
    expect(alarm!.entry_points.some((e) => e.name === "AlarmView")).toBe(true);
    expect(alarm!.evidence.some((e) => e.kind === "test")).toBe(true);
    expect(alarm!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("prefers explicit config paths with high confidence", () => {
    const sources = [
      src("App/Features/Sleep/SleepView.swift", "struct SleepView: View {}"),
      src("App/Features/Sleep/SleepStore.swift", "final class SleepStore {}"),
    ];
    const features = detectFeatures({
      sources,
      explicit: { sleep: { paths: ["App/Features/Sleep/**"] } },
    });
    const sleep = features.find((f) => f.id === "sleep")!;
    expect(sleep.confidence).toBeCloseTo(0.98);
    expect(sleep.source_files).toHaveLength(2);
  });

  it("detects features by Features/<Name>/ convention", () => {
    const sources = [
      src(
        "App/Features/Weather/WeatherView.swift",
        "struct WeatherView: View {}",
      ),
      src(
        "App/Features/Weather/WeatherClient.swift",
        "final class WeatherClient {}",
      ),
    ];
    const features = detectFeatures({ sources });
    const weather = features.find((f) => f.id === "weather")!;
    expect(weather).toBeDefined();
    expect(weather.confidence).toBeCloseTo(0.85);
  });

  it("does not treat a single lone file as a feature", () => {
    const sources = [
      src("Sources/LonelyHelper.swift", "struct LonelyHelper {}"),
    ];
    const features = detectFeatures({ sources });
    expect(features).toHaveLength(0);
  });

  it("excludes test files from feature source lists", () => {
    const sources = [
      src("Sources/NoteView.swift", "struct NoteView: View {}"),
      src("Sources/NoteStore.swift", "final class NoteStore {}"),
      src(
        "Tests/NoteStoreTests.swift",
        "import XCTest\nfinal class NoteStoreTests: XCTestCase {}",
      ),
    ];
    const features = detectFeatures({ sources });
    const note = features.find((f) => f.id === "note")!;
    expect(note.source_files).not.toContain("Tests/NoteStoreTests.swift");
  });
});
