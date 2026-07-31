import type { ScannedFile } from "./scanner.js";
import { detectXcodeSetup, type XcodeSetup } from "../ios/xcode.js";

/**
 * Deterministic project-type detection (blueprint §5.2, Phase 2).
 *
 * Purely structural: inspects the file listing (paths + extensions) to decide
 * platform, language, UI frameworks, dependency managers, and test setup. No
 * file contents are required beyond a few lightweight signal reads the caller
 * may pass in.
 */

export interface DetectionSignals {
  /** Content of Package.swift, if present and safe to read. */
  packageSwift?: string | null;
  /** Content of any Podfile, if present. */
  podfile?: string | null;
  /** `project.pbxproj` contents, for scheme/target/bundle-id resolution. */
  pbxproj?: Array<{ path: string; content: string }>;
  /** Literal `CFBundleIdentifier` from an Info.plist, when there is one. */
  infoPlistBundleId?: string;
}

export interface DetectionResult {
  platform: "iOS" | "unknown";
  languages: string[];
  ui: string[];
  dependencyManagers: string[];
  tests: string[];
  xcodeProjects: string[];
  xcodeWorkspaces: string[];
  hasSpecKit: boolean;
  hasBmad: boolean;
  prdCandidates: string[];
  swiftFileCount: number;
  profile: "ios-swift" | "generic";
  /** Package/product name parsed from Package.swift, if available. */
  packageName?: string;
  /**
   * Scheme / targets / bundle id resolved from the Xcode project, when there is
   * one. `init` writes these into the test config so `xcodebuild` is never
   * invoked with placeholder values.
   */
  xcode?: XcodeSetup;
}

function anyMatch(files: ScannedFile[], re: RegExp): boolean {
  return files.some((f) => re.test(f.path));
}

function collect(files: ScannedFile[], re: RegExp): string[] {
  return files.filter((f) => re.test(f.path)).map((f) => f.path);
}

/** Run structural detection over a scanned file list. */
export function detectProject(
  files: ScannedFile[],
  signals: DetectionSignals = {},
): DetectionResult {
  // Package.swift is a manifest, not source — exclude it from source counts.
  const swiftFiles = files.filter(
    (f) => f.path.endsWith(".swift") && !/(^|\/)Package\.swift$/.test(f.path),
  );
  const swiftFileCount = swiftFiles.length;

  const xcodeProjects = collect(files, /\.xcodeproj\//).reduce<string[]>(
    (acc, p) => {
      const base = p.slice(0, p.indexOf(".xcodeproj") + ".xcodeproj".length);
      if (!acc.includes(base)) acc.push(base);
      return acc;
    },
    [],
  );
  const xcodeWorkspaces = collect(files, /\.xcworkspace\//).reduce<string[]>(
    (acc, p) => {
      const base = p.slice(
        0,
        p.indexOf(".xcworkspace") + ".xcworkspace".length,
      );
      if (!acc.includes(base)) acc.push(base);
      return acc;
    },
    [],
  );

  const hasPackageSwift = anyMatch(files, /(^|\/)Package\.swift$/);
  const hasPodfile = anyMatch(files, /(^|\/)Podfile$/);

  const languages: string[] = [];
  if (swiftFileCount > 0) languages.push("swift");
  if (anyMatch(files, /\.m$|\.mm$|\.h$/)) languages.push("objective-c");

  const ui: string[] = [];
  const swiftContentHints = swiftFiles.length > 0;
  // Heuristic UI detection from filenames + package hints; contents parsed later.
  if (swiftContentHints) {
    if (anyMatch(files, /View\.swift$|App\.swift$|Screen\.swift$/))
      ui.push("SwiftUI");
    if (anyMatch(files, /ViewController\.swift$|\.xib$|\.storyboard$/))
      ui.push("UIKit");
  }

  const dependencyManagers: string[] = [];
  if (hasPackageSwift) dependencyManagers.push("Swift Package Manager");
  if (hasPodfile) dependencyManagers.push("CocoaPods");
  if (signals.packageSwift && /Package\(/.test(signals.packageSwift)) {
    if (!dependencyManagers.includes("Swift Package Manager"))
      dependencyManagers.push("Swift Package Manager");
  }

  const tests: string[] = [];
  if (
    anyMatch(files, /Tests?\//i) ||
    anyMatch(files, /Tests?\.swift$/) ||
    anyMatch(files, /XCTest/)
  ) {
    tests.push("XCTest");
  }
  if (anyMatch(files, /UITests?\//i)) tests.push("XCUITest");

  const hasSpecKit =
    anyMatch(files, /\.specify\//) || anyMatch(files, /(^|\/)specs\/.*\.md$/);
  const hasBmad = anyMatch(files, /_bmad-output\//);

  const prdCandidates = files
    .filter((f) => /prd.*\.md$/i.test(f.path) && !f.sensitive)
    .map((f) => f.path);

  const packageName = signals.packageSwift
    ? (signals.packageSwift.match(/Package\(\s*name:\s*"([^"]+)"/)?.[1] ??
      undefined)
    : undefined;

  const isIos =
    swiftFileCount > 0 ||
    xcodeProjects.length > 0 ||
    xcodeWorkspaces.length > 0 ||
    hasPackageSwift;

  const xcode =
    xcodeProjects.length > 0 || xcodeWorkspaces.length > 0
      ? detectXcodeSetup({
          files,
          ...(signals.pbxproj ? { pbxproj: signals.pbxproj } : {}),
          workspaces: xcodeWorkspaces,
          projects: xcodeProjects,
          ...(signals.infoPlistBundleId
            ? { infoPlistBundleId: signals.infoPlistBundleId }
            : {}),
        })
      : undefined;

  return {
    platform: isIos ? "iOS" : "unknown",
    languages,
    ui: [...new Set(ui)],
    dependencyManagers,
    tests: [...new Set(tests)],
    xcodeProjects,
    xcodeWorkspaces,
    hasSpecKit,
    hasBmad,
    prdCandidates,
    swiftFileCount,
    profile: isIos ? "ios-swift" : "generic",
    packageName,
    ...(xcode ? { xcode } : {}),
  };
}
