import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ValidationError, type Logger } from "@xforge/shared";
import {
  addFileToTarget,
  createUiTestTarget,
  detectSharedSchemes,
  loadConfig,
  parsePbxprojTargets,
  scanFiles,
  usesSynchronizedGroups,
  verifyPbxproj,
  type ScannedFile,
} from "@xforge/core";
import {
  GENERATED_FILES,
  findAppEntry,
  generateTestSupportFile,
  loadTestConfig,
  planTestSupportHook,
  writeTestConfig,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";
import { findTargetFolder } from "./xcode-integrate.js";

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
 *
 * It also writes the one edit XForge makes to *product* source: a DEBUG-only
 * `XForgeTestSupport.configure()` call in the `@main` App. A generated hook file
 * nobody calls is dead code, so the alternative to this edit is not "less
 * intrusion", it is "the feature does not work". The intrusion is kept to four
 * lines in one file a reviewer can read at a glance, and the shape has to be one
 * we recognise — a UIKit delegate or a custom initializer is reported, never
 * guessed at. Adding accessibility identifiers is deliberately *not* here: that
 * needs a per-element approval, which is `xforge test a11y`.
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

  // --- 4. The test-support hook, in the app target ------------------------
  // Both remaining steps are gated on a UI test target existing. Without one
  // nothing can run, so editing the project further — and editing the app's own
  // source — would be churn on a project we have just reported as unusable. It
  // also keeps the guarantee that a refused target edit leaves the project
  // byte-identical.
  //
  // Order within the gate matters too: the file has to be compiled into the app
  // before anything calls it, so a failure at step 4 stops step 5 rather than
  // leaving a call to a type that is not in the target.
  if (!uiTestTarget) {
    for (const name of ["Test-support file", "Test-support hook"]) {
      steps.push({
        name,
        status: "skipped",
        detail: "no UI test target — nothing would be able to run it",
      });
    }
  } else {
    const support = await installTestSupport({
      projectRoot,
      projectDir,
      pbxPath,
      appTarget: appTarget.name,
      dryRun,
      alreadyBackedUp: backup !== undefined,
    });
    if (support.backup && !backup) backup = support.backup;
    steps.push(support.step);

    // --- 5. The call site ------------------------------------------------
    steps.push(
      await hookAppEntry({
        projectRoot,
        files,
        dryRun,
        supportAvailable: support.available,
      }),
    );
  }

  // --- 6. Record what we resolved in the QA config ------------------------
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

/**
 * Put `XForgeTestSupport.swift` in the app target.
 *
 * The file is pure scaffolding — every hook body is empty until someone fills it
 * in — but it has to be *compiled into the app* before the entry point can call
 * it, which is why this runs before the call site is written and why a failure
 * here stops that step instead of producing a call to a missing type.
 */
async function installTestSupport(input: {
  projectRoot: string;
  projectDir: string;
  pbxPath: string;
  appTarget: string;
  dryRun: boolean;
  alreadyBackedUp: boolean;
}): Promise<{ step: TestSetupStep; available: boolean; backup?: string }> {
  const { projectRoot, projectDir, pbxPath, appTarget, dryRun } = input;
  const name = "Test-support file";
  const fileName = GENERATED_FILES.testSupport;

  const dir = (await findTargetFolder(projectRoot, appTarget)) ?? projectDir;
  const dest = join(dir, fileName);
  const shown = relative(projectRoot, dest);
  const content = await readFile(pbxPath, "utf8");

  // Folder-backed targets compile whatever is on disk, so there is no project to
  // edit — the safest of the two routes, and the only one with no failure mode.
  if (usesSynchronizedGroups(content)) {
    if (dryRun) {
      return {
        step: { name, status: "done", detail: `would write ${shown}` },
        available: true,
      };
    }
    await mkdir(dir, { recursive: true });
    await writeFile(dest, generateTestSupportFile(), "utf8");
    return {
      step: { name, status: "done", detail: `${shown} (folder-backed target)` },
      available: true,
    };
  }

  const edit = addFileToTarget({
    content,
    targetName: appTarget,
    fileName,
    relativePath: fileName,
  });

  if (edit.skipped === "already-present") {
    if (!dryRun) {
      await mkdir(dir, { recursive: true });
      await writeFile(dest, generateTestSupportFile(), "utf8");
    }
    return {
      step: {
        name,
        status: "skipped",
        detail: `${fileName} is already in ${appTarget}`,
      },
      available: true,
    };
  }
  if (!edit.content) {
    return {
      step: {
        name,
        status: "failed",
        detail: `could not add ${fileName} to ${appTarget}: ${edit.detail ?? edit.skipped}. Add it in Xcode.`,
      },
      available: false,
    };
  }

  const targetCount = (content.match(/isa = PBXNativeTarget;/g) ?? []).length;
  const check = verifyPbxproj(edit.content, { targets: targetCount });
  if (!check.ok) {
    return {
      step: {
        name,
        status: "failed",
        detail: `refused to write: ${check.reason}. Add ${fileName} in Xcode.`,
      },
      available: false,
    };
  }
  if (dryRun) {
    return {
      step: {
        name,
        status: "done",
        detail: `would write ${shown} and add it to ${appTarget} (dry run)`,
      },
      available: true,
    };
  }

  // One backup per run: step 1 may already hold the pre-setup original, and
  // overwriting it here would replace the only copy that predates any edit.
  let backup: string | undefined;
  if (!input.alreadyBackedUp) {
    backup = `${pbxPath}.xforge-backup`;
    await writeFile(backup, content, "utf8");
  }
  await mkdir(dir, { recursive: true });
  await writeFile(dest, generateTestSupportFile(), "utf8");
  await writeFile(pbxPath, edit.content, "utf8");

  const written = await readFile(pbxPath, "utf8");
  const after = verifyPbxproj(written, { targets: targetCount });
  if (!after.ok) {
    await writeFile(pbxPath, content, "utf8");
    return {
      step: {
        name,
        status: "failed",
        detail: `wrote and rolled back (${after.reason}); the project is unchanged`,
      },
      available: false,
    };
  }

  return {
    step: { name, status: "done", detail: `${shown} → ${appTarget}` },
    available: true,
    ...(backup ? { backup: relative(projectRoot, backup) } : {}),
  };
}

/** Swift files that could hold the `@main` entry point. */
function entryCandidates(files: ScannedFile[]): string[] {
  return (
    files
      .map((f) => f.path)
      .filter(
        (p) =>
          p.endsWith(".swift") &&
          !p.includes(".xforge/") &&
          !/Tests?\.swift$/.test(p),
      )
      // `MyApp.swift` first: usually the answer, and it keeps the common case to
      // one file read.
      .sort(
        (a, b) =>
          Number(b.endsWith("App.swift")) - Number(a.endsWith("App.swift")),
      )
  );
}

/**
 * Write `XForgeTestSupport.configure()` into the `@main` App.
 *
 * This is the only edit XForge makes to product source, so it is deliberately
 * the smallest one that works: one file, four lines, `#if DEBUG`, and a refusal
 * with a reason wherever the shape is not the one we recognise. Nothing here
 * blocks a QA run — the hooks are empty stubs — so a refusal is reported as a
 * skip, not a failure.
 */
async function hookAppEntry(input: {
  projectRoot: string;
  files: ScannedFile[];
  dryRun: boolean;
  supportAvailable: boolean;
}): Promise<TestSetupStep> {
  const { projectRoot, dryRun } = input;
  const name = "Test-support hook";

  if (!input.supportAvailable) {
    return {
      name,
      status: "skipped",
      detail: `${GENERATED_FILES.testSupport} is not in the app target, so a call to it would not compile`,
    };
  }

  const found: Array<{ path: string; content: string }> = [];
  const refusals: string[] = [];
  for (const path of entryCandidates(input.files)) {
    const content = await readFile(join(projectRoot, path), "utf8").catch(
      () => undefined,
    );
    if (content === undefined || !content.includes("@main")) continue;
    const located = findAppEntry(content);
    if (located === undefined) continue;
    if ("refused" in located) {
      refusals.push(`${path}: ${located.refused}`);
      continue;
    }
    found.push({ path, content });
  }

  if (found.length === 0) {
    return {
      name,
      status: "skipped",
      detail:
        refusals[0] ??
        "no `@main` SwiftUI App found; call XForgeTestSupport.configure() at app start yourself",
    };
  }
  if (found.length > 1) {
    return {
      name,
      status: "skipped",
      detail:
        `${found.length} files declare a \`@main\` App (${found.map((f) => f.path).join(", ")}); ` +
        "add the call to the one that ships rather than have this pick",
    };
  }

  const entry = found[0]!;
  const plan = planTestSupportHook(entry.content);
  if (plan.status === "already-present") {
    return {
      name,
      status: "skipped",
      detail: `already called at ${entry.path}:${plan.line}`,
    };
  }
  if (plan.status === "refused") {
    return { name, status: "skipped", detail: plan.reason };
  }
  if (dryRun) {
    return {
      name,
      status: "done",
      detail: `would call configure() in ${entry.path} (${plan.entry.name})`,
    };
  }

  await writeFile(join(projectRoot, entry.path), plan.content, "utf8");
  return {
    name,
    status: "done",
    detail: `${entry.path}:${plan.line} (${plan.strategy === "new-init" ? "added init()" : "existing init()"})`,
  };
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

  // The app's own source changed. Say so plainly — a silent product-code edit is
  // the one outcome nobody should discover later from a diff.
  const hook = result.steps.find((s) => s.name === "Test-support hook");
  if (hook?.status === "done" && !result.dryRun) {
    process.stderr.write(
      `\n  Your app's source was edited: ${hook.detail}\n` +
        "  Four lines, inside #if DEBUG, inert without the --xforge-test launch\n" +
        "  argument. Read it before committing:\n" +
        "    git diff -- '*.swift'\n",
    );
  }

  process.stderr.write(
    result.ready
      ? "\n  Next:\n    xforge test plan --level smoke\n"
      : "\n  Fix the failures above, then re-run `xforge test setup`.\n",
  );
}
