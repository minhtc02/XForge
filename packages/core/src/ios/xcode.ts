import type { ScannedFile } from "../discovery/scanner.js";

/**
 * Xcode project introspection (blueprint §6.2, §16.2).
 *
 * `xcodebuild` needs a real scheme, and XForge Test additionally needs the app's
 * bundle identifier and the UI test target's name. Leaving those as `auto`
 * produces commands like `xcodebuild -scheme auto`, which fail at run time — so
 * they are resolved here, at `init`, from artifacts already in the repository.
 *
 * `project.pbxproj` is an OpenStep property list, not XML. Rather than pull in a
 * parser for a format only Xcode writes, this reads the few well-delimited
 * sections it needs and reports what it could not resolve, so the config can say
 * `auto` honestly instead of guessing.
 */

/** A native target declared by an Xcode project. */
export interface XcodeTarget {
  name: string;
  /** e.g. `com.apple.product-type.application`. */
  productType: string;
}

export const PRODUCT_TYPE = {
  application: "com.apple.product-type.application",
  uiTest: "com.apple.product-type.bundle.ui-testing",
  unitTest: "com.apple.product-type.bundle.unit-test",
  framework: "com.apple.product-type.framework",
} as const;

const NATIVE_TARGET_SECTION =
  /\/\* Begin PBXNativeTarget section \*\/([\s\S]*?)\/\* End PBXNativeTarget section \*\//;
const TARGET_ENTRY = /=\s*\{([\s\S]*?)\n\t\t\};/g;
const NAME_FIELD = /\n\s*name\s*=\s*"?([^";\n]+)"?;/;
const PRODUCT_TYPE_FIELD = /\n\s*productType\s*=\s*"?([^";\n]+)"?;/;
const BUNDLE_ID_FIELD = /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\n]+)"?;/g;

/** Parse the native targets declared in a `project.pbxproj`. */
export function parsePbxprojTargets(content: string): XcodeTarget[] {
  const section = NATIVE_TARGET_SECTION.exec(content);
  if (!section?.[1]) return [];
  const targets: XcodeTarget[] = [];
  TARGET_ENTRY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TARGET_ENTRY.exec(section[1])) !== null) {
    const body = match[1] ?? "";
    if (!/isa\s*=\s*PBXNativeTarget;/.test(body)) continue;
    const name = NAME_FIELD.exec(body)?.[1]?.trim();
    const productType = PRODUCT_TYPE_FIELD.exec(body)?.[1]?.trim();
    if (name && productType) targets.push({ name, productType });
  }
  return targets;
}

/**
 * Bundle identifiers declared in build settings. Build-variable values such as
 * `$(PRODUCT_BUNDLE_IDENTIFIER)` are skipped — they resolve at build time and
 * are not usable as a literal.
 */
export function parsePbxprojBundleIds(content: string): string[] {
  const ids: string[] = [];
  BUNDLE_ID_FIELD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BUNDLE_ID_FIELD.exec(content)) !== null) {
    const value = match[1]?.trim();
    if (!value || value.includes("$(")) continue;
    if (!ids.includes(value)) ids.push(value);
  }
  return ids;
}

/** Shared scheme names — the only ones `xcodebuild` can use on another machine. */
export function detectSharedSchemes(files: ScannedFile[]): string[] {
  return files
    .filter((f) => /xcshareddata\/xcschemes\/[^/]+\.xcscheme$/.test(f.path))
    .map((f) => (f.path.split("/").pop() ?? "").replace(/\.xcscheme$/, ""))
    .filter((name) => name.length > 0)
    .sort();
}

/** Per-user schemes; present locally but never committed, so CI cannot see them. */
export function detectUserSchemes(files: ScannedFile[]): string[] {
  return files
    .filter((f) =>
      /xcuserdata\/[^/]+\/xcschemes\/[^/]+\.xcscheme$/.test(f.path),
    )
    .map((f) => (f.path.split("/").pop() ?? "").replace(/\.xcscheme$/, ""))
    .filter((name) => name.length > 0)
    .sort();
}

export interface XcodeSetup {
  /** Workspace path, when the project has one (preferred by xcodebuild). */
  workspace?: string;
  /** `.xcodeproj` path, used when there is no workspace. */
  project?: string;
  /** Best-guess scheme for building and testing. */
  scheme?: string;
  sharedSchemes: string[];
  userSchemes: string[];
  appTarget?: string;
  uiTestTarget?: string;
  unitTestTarget?: string;
  appBundleId?: string;
  /**
   * What could not be resolved. Surfaced to the user rather than guessed, since
   * a wrong value fails later and less legibly than a missing one.
   */
  unresolved: string[];
}

export interface XcodeSetupInput {
  files: ScannedFile[];
  /** `project.pbxproj` contents, keyed by their repository path. */
  pbxproj?: Array<{ path: string; content: string }>;
  workspaces?: string[];
  projects?: string[];
  /** Bundle identifier read from an `Info.plist`, if it was a literal. */
  infoPlistBundleId?: string;
}

/** Names that mark a bundle id or target as belonging to a test bundle. */
function isTestName(value: string): boolean {
  return /(UI)?Tests?$/i.test(value) || /\.(ui)?tests?$/i.test(value);
}

/**
 * Resolve everything `xcodebuild` and XForge Test need from an Xcode project.
 * Every field is optional: an SPM-only package legitimately has none of them.
 */
export function detectXcodeSetup(input: XcodeSetupInput): XcodeSetup {
  const targets = (input.pbxproj ?? []).flatMap((p) =>
    parsePbxprojTargets(p.content),
  );
  const bundleIds = (input.pbxproj ?? []).flatMap((p) =>
    parsePbxprojBundleIds(p.content),
  );

  const appTarget = targets.find(
    (t) => t.productType === PRODUCT_TYPE.application,
  )?.name;
  const uiTestTarget = targets.find(
    (t) => t.productType === PRODUCT_TYPE.uiTest,
  )?.name;
  const unitTestTarget = targets.find(
    (t) => t.productType === PRODUCT_TYPE.unitTest,
  )?.name;

  const sharedSchemes = detectSharedSchemes(input.files);
  const userSchemes = detectUserSchemes(input.files);
  // Prefer a shared scheme named after the app target; fall back to the first
  // shared one. User schemes are reported but never chosen: they are not
  // committed, so a plan built on one would not reproduce elsewhere.
  const scheme =
    (appTarget && sharedSchemes.includes(appTarget) ? appTarget : undefined) ??
    sharedSchemes[0];

  // The app's bundle id is the one that is not a test bundle's.
  const appBundleId =
    (input.infoPlistBundleId && !isTestName(input.infoPlistBundleId)
      ? input.infoPlistBundleId
      : undefined) ?? bundleIds.find((id) => !isTestName(id));

  const workspace = input.workspaces?.[0];
  const project = input.projects?.[0];

  const unresolved: string[] = [];
  if (!workspace && !project) unresolved.push("workspace/project");
  if (!scheme) {
    unresolved.push(
      userSchemes.length > 0
        ? "scheme (only per-user schemes found — mark one Shared in Xcode)"
        : "scheme",
    );
  }
  if (!appBundleId) unresolved.push("app_bundle_id");
  if (!uiTestTarget) unresolved.push("ui_test_target");

  return {
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
    ...(scheme ? { scheme } : {}),
    sharedSchemes,
    userSchemes,
    ...(appTarget ? { appTarget } : {}),
    ...(uiTestTarget ? { uiTestTarget } : {}),
    ...(unitTestTarget ? { unitTestTarget } : {}),
    ...(appBundleId ? { appBundleId } : {}),
    unresolved,
  };
}
