import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ValidationError, type Logger } from "@xforge/shared";
import {
  createUiTestTarget,
  detectSharedSchemes,
  loadConfig,
  parsePbxprojTargets,
  scanFiles,
  verifyPbxproj,
} from "@xforge/core";
import { loadTestConfig, writeTestConfig } from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

/**
 * `xforge test setup` — make a project QA-able.
 *
 * XCUITest drives the app from a *separate process* through the accessibility
 * APIs, and iOS grants that only to a bundle whose product type is
 * `com.apple.product-type.bundle.ui-testing`. A project without one cannot be
 * tested at all — not a convention, an OS boundary — so `test doctor` reports
 * a blocker and every plan stops there.
 *
 * Creating that target by hand is five clicks in Xcode, which is fine once and
 * tedious as the answer to "why did my plan not run". So this does it, under
 * the rules that make editing `project.pbxproj` survivable:
 *
 *   - the original is backed up before anything is written,
 *   - the result is structurally verified *before* it lands and again after,
 *   - anything unexpected restores the backup and reports why.
 *
 * A broken pbxproj does not fail loudly; it makes Xcode refuse to open the
 * project. That is why every step here would rather do nothing than guess.
 */

export interface TestSetupOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  /** Name for the UI test target; defaults to `<App>UITests`. */
  targetName?: string;
}

export interface TestSetupStep {
  name: string;
  status: "done" | "skipped" | "failed";
  detail: string;
}

export interface TestSetupResult {
  dryRun: boolean;
  steps: TestSetupStep[];
  /** True when the project is ready for `xforge test plan` afterwards. */
  ready: boolean;
  /** Where the pbxproj backup was written, when one was taken. */
  backup?: string;
}

/** The `Info.plist` a UI test bundle needs when the project does not generate one. */
function uiTestInfoPlist(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>CFBundleDevelopmentRegion</key>",
    "\t<string>$(DEVELOPMENT_LANGUAGE)</string>",
    "\t<key>CFBundleExecutable</key>",
    "\t<string>$(EXECUTABLE_NAME)</string>",
    "\t<key>CFBundleIdentifier</key>",
    "\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>",
    "\t<key>CFBundleInfoDictionaryVersion</key>",
    "\t<string>6.0</string>",
    "\t<key>CFBundleName</key>",
    "\t<string>$(PRODUCT_NAME)</string>",
    "\t<key>CFBundlePackageType</key>",
    "\t<string>BNDL</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/** A shared scheme that builds the app and runs the UI test bundle. */
function sharedScheme(appTarget: string, uiTestTarget: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Scheme LastUpgradeVersion = "1500" version = "1.7">',
    '   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">',
    "      <BuildActionEntries>",
    '         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">',
    `            <BuildableReference BuildableIdentifier = "primary" BlueprintName = "${appTarget}" ReferencedContainer = "container:" BuildableName = "${appTarget}.app"></BuildableReference>`,
    "         </BuildActionEntry>",
    "      </BuildActionEntries>",
    "   </BuildAction>",
    '   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">',
    "      <Testables>",
    '         <TestableReference skipped = "NO">',
    `            <BuildableReference BuildableIdentifier = "primary" BlueprintName = "${uiTestTarget}" ReferencedContainer = "container:" BuildableName = "${uiTestTarget}.xctest"></BuildableReference>`,
    "         </TestableReference>",
    "      </Testables>",
    "   </TestAction>",
    '   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" allowLocationSimulation = "YES">',
    '      <BuildableProductRunnable runnableDebuggingMode = "0">',
    `         <BuildableReference BuildableIdentifier = "primary" BlueprintName = "${appTarget}" ReferencedContainer = "container:" BuildableName = "${appTarget}.app"></BuildableReference>`,
    "      </BuildableProductRunnable>",
    "   </LaunchAction>",
    "</Scheme>",
    "",
  ].join("\n");
}

export async function runTestSetup(
  ctx: CliContext,
  options: TestSetupOptions = {},
): Promise<TestSetupResult> {
  const { projectRoot, logger } = ctx;
  await loadConfig(projectRoot); // fails clearly when not initialized

  const steps: TestSetupStep[] = [];
  const dryRun = Boolean(options.dryRun);
  let backup: string | undefined;

  const files = await scanFiles(projectRoot, {});
  const pbxFile = files.find((f) => f.path.endsWith("project.pbxproj"));
  if (!pbxFile) {
    throw new ValidationError(
      "No .xcodeproj found. `test setup` configures an Xcode project; an SPM " +
        "package has no UI test target to create.",
    );
  }
  const pbxPath = join(projectRoot, pbxFile.path);
  const projectDir = dirname(pbxPath);
  const original = await readFile(pbxPath, "utf8");

  const targets = parsePbxprojTargets(original);
  const appTarget = targets.find(
    (t) => t.productType === "com.apple.product-type.application",
  );
  if (!appTarget) {
    throw new ValidationError(
      "No application target found in the Xcode project; nothing to test against.",
    );
  }
  const existingUiTest = targets.find(
    (t) => t.productType === "com.apple.product-type.bundle.ui-testing",
  );
  const uiTestName = options.targetName ?? `${appTarget.name}UITests`;

  // --- 1. The UI test target ---------------------------------------------
  const testConfig = await loadTestConfig(projectRoot);
  let uiTestTarget = existingUiTest?.name;

  if (existingUiTest) {
    steps.push({
      name: "UI test target",
      status: "skipped",
      detail: `${existingUiTest.name} already exists`,
    });
  } else {
    const bundleId = deriveTestBundleId(original, appTarget.name, uiTestName);
    const edit = createUiTestTarget({
      content: original,
      targetName: uiTestName,
      appTargetName: appTarget.name,
      bundleId,
      sourceDir: uiTestName,
      ...(deploymentTarget(original)
        ? { deploymentTarget: deploymentTarget(original)! }
        : {}),
      ...(developmentTeam(original)
        ? { developmentTeam: developmentTeam(original)! }
        : {}),
    });

    if (!edit.content) {
      steps.push({
        name: "UI test target",
        status: "failed",
        detail: `${edit.detail ?? edit.skipped}. Create it in Xcode: File → New → Target → UI Testing Bundle.`,
      });
    } else {
      // Verify before the file is touched. A project that would not open is
      // never written in the first place.
      const check = verifyPbxproj(edit.content, {
        targets: targets.length + 1,
      });
      if (!check.ok) {
        steps.push({
          name: "UI test target",
          status: "failed",
          detail: `refused to write: ${check.reason}. Create the target in Xcode instead.`,
        });
      } else if (dryRun) {
        uiTestTarget = uiTestName;
        steps.push({
          name: "UI test target",
          status: "done",
          detail: `would create ${uiTestName} (dry run — nothing written)`,
        });
      } else {
        backup = `${pbxPath}.xforge-backup`;
        await writeFile(backup, original, "utf8");
        await writeFile(pbxPath, edit.content, "utf8");

        // Re-read what actually landed; restore on any surprise.
        const written = await readFile(pbxPath, "utf8");
        const after = verifyPbxproj(written, { targets: targets.length + 1 });
        if (!after.ok) {
          await writeFile(pbxPath, original, "utf8");
          steps.push({
            name: "UI test target",
            status: "failed",
            detail: `wrote and rolled back (${after.reason}); the project is unchanged`,
          });
        } else {
          uiTestTarget = uiTestName;
          steps.push({
            name: "UI test target",
            status: "done",
            detail: `created ${uiTestName} (backup: ${relative(projectRoot, backup)})`,
          });
        }
      }
    }
  }

  // --- 2. The bundle's source folder and Info.plist -----------------------
  if (uiTestTarget) {
    const dir = join(projectDir, uiTestTarget);
    const plist = join(dir, "Info.plist");
    if (existsSync(plist)) {
      steps.push({
        name: "Test bundle Info.plist",
        status: "skipped",
        detail: `${relative(projectRoot, plist)} already exists`,
      });
    } else if (dryRun) {
      steps.push({
        name: "Test bundle Info.plist",
        status: "done",
        detail: `would write ${relative(projectRoot, plist)}`,
      });
    } else {
      await mkdir(dir, { recursive: true });
      await writeFile(plist, uiTestInfoPlist(), "utf8");
      steps.push({
        name: "Test bundle Info.plist",
        status: "done",
        detail: relative(projectRoot, plist),
      });
    }
  }

  // --- 3. A shared scheme -------------------------------------------------
  // `xcodebuild -scheme` can only see shared schemes; a scheme Xcode created
  // for one developer lives in xcuserdata and is invisible to CI and to us.
  const shared = detectSharedSchemes(files);
  const schemePath = join(
    projectDir,
    "xcshareddata",
    "xcschemes",
    `${appTarget.name}.xcscheme`,
  );
  if (shared.includes(appTarget.name)) {
    steps.push({
      name: "Shared scheme",
      status: "skipped",
      detail: `${appTarget.name} is already shared`,
    });
  } else if (!uiTestTarget) {
    steps.push({
      name: "Shared scheme",
      status: "skipped",
      detail: "no UI test target to reference",
    });
  } else if (dryRun) {
    steps.push({
      name: "Shared scheme",
      status: "done",
      detail: `would write ${relative(projectRoot, schemePath)}`,
    });
  } else {
    await mkdir(dirname(schemePath), { recursive: true });
    await writeFile(
      schemePath,
      sharedScheme(appTarget.name, uiTestTarget),
      "utf8",
    );
    steps.push({
      name: "Shared scheme",
      status: "done",
      detail: relative(projectRoot, schemePath),
    });
  }

  // --- 4. Record what we resolved in the QA config ------------------------
  if (!dryRun && uiTestTarget) {
    let changed = false;
    if (testConfig.project.ui_test_target === "auto") {
      testConfig.project.ui_test_target = uiTestTarget;
      changed = true;
    }
    if (testConfig.project.scheme === "auto") {
      testConfig.project.scheme = appTarget.name;
      changed = true;
    }
    if (changed) {
      await writeTestConfig(projectRoot, testConfig);
      steps.push({
        name: "QA config",
        status: "done",
        detail: `ui_test_target=${uiTestTarget}, scheme=${appTarget.name}`,
      });
    }
  }

  const ready =
    uiTestTarget !== undefined && !steps.some((s) => s.status === "failed");
  const result: TestSetupResult = {
    dryRun,
    steps,
    ready,
    ...(backup ? { backup: relative(projectRoot, backup) } : {}),
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    render(logger, result),
  );
  return result;
}

/** Reuse the app's bundle id as a prefix so signing keeps working. */
function deriveTestBundleId(
  content: string,
  appTarget: string,
  uiTestName: string,
): string {
  const match = /PRODUCT_BUNDLE_IDENTIFIER = "?([^";\n]+)"?;/.exec(content);
  const base = match?.[1]?.trim() ?? `com.example.${appTarget.toLowerCase()}`;
  return `${base}.${uiTestName.replace(/[^A-Za-z0-9]/g, "")}`;
}

function deploymentTarget(content: string): string | undefined {
  return /IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/.exec(content)?.[1];
}

function developmentTeam(content: string): string | undefined {
  return /DEVELOPMENT_TEAM = "?([A-Z0-9]+)"?;/.exec(content)?.[1];
}

function render(logger: Logger, result: TestSetupResult): void {
  if (result.dryRun) {
    logger.info("Dry run — nothing was written");
  } else if (result.ready) {
    logger.success("Project is ready for QA");
  } else {
    logger.warn("Setup incomplete");
  }

  process.stderr.write("\n");
  for (const step of result.steps) {
    const mark =
      step.status === "done" ? "✓" : step.status === "skipped" ? "·" : "✗";
    process.stderr.write(`  ${mark} ${step.name.padEnd(22)} ${step.detail}\n`);
  }

  if (result.backup) {
    process.stderr.write(
      `\n  project.pbxproj was edited. Check it before committing:\n` +
        `    git diff -- '*.pbxproj'\n` +
        `  The original is at ${result.backup} if you want it back.\n`,
    );
  }

  process.stderr.write(
    result.ready
      ? "\n  Next:\n    xforge test plan --level smoke\n"
      : "\n  Fix the failures above, then re-run `xforge test setup`.\n",
  );
}
