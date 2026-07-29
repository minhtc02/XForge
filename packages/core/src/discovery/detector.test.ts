import { describe, expect, it } from "vitest";
import { detectProject } from "./detector.js";
import type { ScannedFile } from "./scanner.js";

function f(path: string, sensitive = false): ScannedFile {
  return { path, size: 10, sensitive };
}

describe("detectProject", () => {
  it("detects an iOS SwiftUI SPM project with tests, Spec Kit and BMAD", () => {
    const files: ScannedFile[] = [
      f("Package.swift"),
      f("Sources/App/CuckooApp.swift"),
      f("Sources/Alarm/AlarmView.swift"),
      f("Sources/Alarm/AlarmScheduler.swift"),
      f("Tests/AlarmTests/AlarmSchedulerTests.swift"),
      f(".specify/memory/constitution.md"),
      f("specs/001-alarm/spec.md"),
      f("_bmad-output/prd.md"),
      f("docs/product/prd.md"),
    ];
    const result = detectProject(files, {
      packageSwift:
        'import PackageDescription\nlet package = Package(name: "Cuckoo")',
    });
    expect(result.platform).toBe("iOS");
    expect(result.languages).toContain("swift");
    expect(result.ui).toContain("SwiftUI");
    expect(result.dependencyManagers).toContain("Swift Package Manager");
    expect(result.tests).toContain("XCTest");
    expect(result.hasSpecKit).toBe(true);
    expect(result.hasBmad).toBe(true);
    expect(result.prdCandidates.length).toBeGreaterThan(0);
    expect(result.profile).toBe("ios-swift");
    expect(result.swiftFileCount).toBe(4);
  });

  it("detects UIKit and CocoaPods", () => {
    const files: ScannedFile[] = [
      f("Podfile"),
      f("MyApp.xcodeproj/project.pbxproj"),
      f("MyApp/AppDelegate.swift"),
      f("MyApp/LoginViewController.swift"),
      f("MyApp/Main.storyboard"),
    ];
    const result = detectProject(files);
    expect(result.ui).toContain("UIKit");
    expect(result.dependencyManagers).toContain("CocoaPods");
    expect(result.xcodeProjects).toEqual(["MyApp.xcodeproj"]);
  });

  it("returns unknown for a non-iOS repo", () => {
    const files: ScannedFile[] = [f("index.js"), f("README.md")];
    const result = detectProject(files);
    expect(result.platform).toBe("unknown");
    expect(result.profile).toBe("generic");
  });

  it("does not surface sensitive files as PRD candidates", () => {
    const files: ScannedFile[] = [
      f("Package.swift"),
      f("docs/prd-secret.md", true),
    ];
    const result = detectProject(files);
    expect(result.prdCandidates).not.toContain("docs/prd-secret.md");
  });
});
