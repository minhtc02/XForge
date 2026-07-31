import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { AlreadyExistsError, type Logger } from "@xforge/shared";
import {
  configPath,
  defaultConfig,
  detectProject,
  ensureStateDirs,
  loadConfig,
  parsePlist,
  plistFacts,
  readTextFileSafe,
  scanFiles,
  writeConfig,
  type DetectionResult,
} from "@xforge/core";
import {
  defaultTestConfig,
  ensureTestDirs,
  testConfigPath,
  writeTestConfig,
  type TestConfig,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../context.js";

export interface InitOptions {
  profile?: "ios-swift" | "generic";
  output?: string;
  nonInteractive?: boolean;
  force?: boolean;
}

export interface InitResult {
  projectRoot: string;
  configPath: string;
  detection: DetectionResult;
  createdConfig: boolean;
  createdOutputDir: string;
  stateDirs: string[];
  /** Where the QA module's config was written, when init wrote one. */
  testConfigPath?: string;
  /** True when an existing test config was preserved instead of overwritten. */
  testConfigSkipped: boolean;
  /** Xcode fields that stayed `auto` because they could not be resolved. */
  unresolvedXcodeFields: string[];
}

/**
 * Build the QA config from what detection resolved. Anything unresolved is left
 * at its `auto` default rather than guessed — a wrong scheme fails later and
 * less legibly than a missing one.
 */
function testConfigFor(detection: DetectionResult): TestConfig {
  const config = defaultTestConfig();
  const xcode = detection.xcode;
  if (!xcode) return config;

  if (xcode.workspace) config.project.workspace = xcode.workspace;
  if (xcode.project) config.project.project = xcode.project;
  if (xcode.scheme) config.project.scheme = xcode.scheme;
  if (xcode.appBundleId) config.project.app_bundle_id = xcode.appBundleId;
  if (xcode.uiTestTarget) config.project.ui_test_target = xcode.uiTestTarget;
  return config;
}

/**
 * `xforge init` (blueprint §5.2, §24.1, master prompt §4).
 *
 * Deterministically scans the repository, detects project type, writes
 * `.xforge/config.yaml` + `.xforge/state/` and creates the docs output dir.
 * Refuses to overwrite an existing config unless `--force`.
 */
export async function runInit(
  ctx: CliContext,
  options: InitOptions,
): Promise<InitResult> {
  const { projectRoot, logger } = ctx;
  const cfgPath = configPath(projectRoot);
  const configExists = existsSync(cfgPath);

  if (configExists && !options.force) {
    throw new AlreadyExistsError(
      "XForge is already initialized here. Re-run with --force to overwrite the config.",
      { details: { configPath: cfgPath } },
    );
  }

  logger.info("Scanning repository", { root: projectRoot });
  const files = await scanFiles(projectRoot);

  // Read a couple of lightweight signal files (never sensitive ones).
  const packageSwiftEntry = files.find((f) => f.path.endsWith("Package.swift"));
  const podfileEntry = files.find((f) => basename(f.path) === "Podfile");

  // `project.pbxproj` + Info.plist resolve the scheme, targets and bundle id
  // that `xcodebuild` needs — without them the test config would say `auto`
  // and every generated command would fail at run time.
  const pbxproj: Array<{ path: string; content: string }> = [];
  for (const file of files.filter((f) => f.path.endsWith("project.pbxproj"))) {
    const content = await readTextFileSafe(projectRoot, file.path);
    if (content !== null) pbxproj.push({ path: file.path, content });
  }
  const infoPlistEntry = files.find(
    (f) => /(^|\/)Info\.plist$/.test(f.path) && !f.sensitive,
  );
  const infoPlistBundleId = infoPlistEntry
    ? plistFacts(
        parsePlist(
          (await readTextFileSafe(projectRoot, infoPlistEntry.path)) ?? "",
        ),
      ).bundleIdentifier
    : undefined;

  const detection = detectProject(files, {
    packageSwift: packageSwiftEntry
      ? await readTextFileSafe(projectRoot, packageSwiftEntry.path)
      : null,
    podfile: podfileEntry
      ? await readTextFileSafe(projectRoot, podfileEntry.path)
      : null,
    pbxproj,
    ...(infoPlistBundleId ? { infoPlistBundleId } : {}),
  });

  const profile = options.profile ?? detection.profile;
  const projectName =
    detection.platform === "iOS"
      ? deriveProjectName(projectRoot, detection)
      : basename(projectRoot);

  const config = defaultConfig({ name: projectName, profile });
  if (options.output) config.output.root = options.output;

  const writtenConfigPath = await writeConfig(projectRoot, config);
  const stateDirs = await ensureStateDirs(projectRoot);

  const outputDir = join(projectRoot, config.output.root);
  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, "_meta"), { recursive: true });

  // Seed the QA module's config with the resolved Xcode facts, so `xforge test`
  // is usable without hand-editing. Existing configs are left alone unless
  // --force: they may carry user edits we must not clobber.
  const testConfigTarget = testConfigPath(projectRoot);
  const testConfigExisted = existsSync(testConfigTarget);
  let testConfigPathWritten: string | undefined;
  if (!testConfigExisted || options.force) {
    await ensureTestDirs(projectRoot);
    testConfigPathWritten = await writeTestConfig(
      projectRoot,
      testConfigFor(detection),
    );
  }

  const result: InitResult = {
    projectRoot,
    configPath: writtenConfigPath,
    detection,
    createdConfig: true,
    createdOutputDir: config.output.root,
    stateDirs,
    ...(testConfigPathWritten ? { testConfigPath: testConfigPathWritten } : {}),
    testConfigSkipped: testConfigExisted && !options.force,
    unresolvedXcodeFields: detection.xcode?.unresolved ?? [],
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderInitSummary(logger, result),
  );
  return result;
}

function deriveProjectName(
  projectRoot: string,
  detection: DetectionResult,
): string {
  if (detection.packageName) return detection.packageName;
  const proj = detection.xcodeProjects[0] ?? detection.xcodeWorkspaces[0];
  if (proj) {
    return basename(proj).replace(/\.(xcodeproj|xcworkspace)$/, "");
  }
  return basename(projectRoot);
}

function renderInitSummary(logger: Logger, result: InitResult): void {
  const d = result.detection;
  logger.success("XForge initialized");
  const x = d.xcode;
  const lines = [
    ["Platform", d.platform],
    ["Languages", d.languages.join(", ") || "—"],
    ["UI", d.ui.join(", ") || "—"],
    ["Dependency manager", d.dependencyManagers.join(", ") || "—"],
    ["Tests", d.tests.join(", ") || "—"],
    ["Xcode projects", d.xcodeProjects.join(", ") || "—"],
    ["Workspace", x?.workspace ?? "—"],
    ["Scheme", x?.scheme ?? "— (not resolved)"],
    ["App target", x?.appTarget ?? "—"],
    ["UI test target", x?.uiTestTarget ?? "— (not resolved)"],
    ["App bundle id", x?.appBundleId ?? "— (not resolved)"],
    ["Spec Kit", d.hasSpecKit ? "Found" : "Not found"],
    ["BMAD", d.hasBmad ? "Found" : "Not found"],
    ["PRD candidates", d.prdCandidates.slice(0, 3).join(", ") || "None"],
    ["Swift files", String(d.swiftFileCount)],
    ["Documentation output", result.createdOutputDir],
  ];
  const width = Math.max(...lines.map(([k]) => k!.length));
  process.stderr.write("\nDetected:\n");
  for (const [k, v] of lines) {
    process.stderr.write(`  ${k!.padEnd(width)}  ${v}\n`);
  }
  process.stderr.write(`\nConfig written to ${result.configPath}\n`);
  if (result.testConfigPath) {
    process.stderr.write(`QA config written to ${result.testConfigPath}\n`);
  } else if (result.testConfigSkipped) {
    process.stderr.write(
      "QA config already exists — left untouched (use --force to regenerate).\n",
    );
  }

  if (result.unresolvedXcodeFields.length > 0) {
    process.stderr.write(
      `\n! Could not resolve: ${result.unresolvedXcodeFields.join(", ")}.\n` +
        "  These stay `auto` in .xforge/test/config.yaml and `xforge test run\n" +
        "  --execute` will fail until you fill them in. Find the real values with:\n" +
        "    xcodebuild -list\n",
    );
    if (x && x.sharedSchemes.length === 0 && x.userSchemes.length > 0) {
      process.stderr.write(
        `  Schemes exist but none are shared (${x.userSchemes.join(", ")}).\n` +
          "  In Xcode: Product → Scheme → Manage Schemes → tick 'Shared'.\n",
      );
    }
  }

  process.stderr.write(
    "\nNext: run `xforge docs` to generate documentation.\n",
  );
}

/** Load config after init for verification/inspection. */
export async function loadInitializedConfig(projectRoot: string) {
  return loadConfig(projectRoot);
}
