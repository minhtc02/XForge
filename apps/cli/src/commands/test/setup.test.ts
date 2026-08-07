import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, ValidationError } from "@xforge/shared";
import { parsePbxprojTargets, verifyPbxproj } from "@xforge/core";
import { loadTestConfig } from "@xforge/test-core";
import { runInit } from "../init.js";
import { runTestSetup } from "./setup.js";
import type { CliContext } from "../../context.js";

/**
 * `test setup` edits `project.pbxproj`, which is the one file where a bad write
 * does not fail loudly — it makes Xcode refuse to open the project. So these
 * cover the write path and, more importantly, every path where it must decline.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

/** A single-target Xcode project: exactly the state that blocks QA. */
const APP_ONLY_PBXPROJ = `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
		AAAAAAAAAAAAAAAAAAAAAA01 /* MyApp.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; path = MyApp.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
		BBBBBBBBBBBBBBBBBBBBBB01 /* Products */ = {
			isa = PBXGroup;
			children = (
				AAAAAAAAAAAAAAAAAAAAAA01 /* MyApp.app */,
			);
			name = Products;
			sourceTree = "<group>";
		};
		BBBBBBBBBBBBBBBBBBBBBB02 = {
			isa = PBXGroup;
			children = (
				BBBBBBBBBBBBBBBBBBBBBB01 /* Products */,
			);
			sourceTree = "<group>";
		};
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
		CCCCCCCCCCCCCCCCCCCCCC01 /* MyApp */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = DDDDDDDDDDDDDDDDDDDDDD01 /* Build configuration list for PBXNativeTarget "MyApp" */;
			buildPhases = (
				EEEEEEEEEEEEEEEEEEEEEE01 /* Sources */,
			);
			name = MyApp;
			productName = MyApp;
			productReference = AAAAAAAAAAAAAAAAAAAAAA01 /* MyApp.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */
/* Begin PBXProject section */
		FFFFFFFFFFFFFFFFFFFFFF01 /* Project object */ = {
			isa = PBXProject;
			attributes = {
				TargetAttributes = {
					CCCCCCCCCCCCCCCCCCCCCC01 = {
						CreatedOnToolsVersion = 15.0;
					};
				};
			};
			mainGroup = BBBBBBBBBBBBBBBBBBBBBB02;
			productRefGroup = BBBBBBBBBBBBBBBBBBBBBB01 /* Products */;
			targets = (
				CCCCCCCCCCCCCCCCCCCCCC01 /* MyApp */,
			);
		};
/* End PBXProject section */
/* Begin PBXResourcesBuildPhase section */
/* End PBXResourcesBuildPhase section */
/* Begin PBXSourcesBuildPhase section */
		EEEEEEEEEEEEEEEEEEEEEE01 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
			);
		};
/* End PBXSourcesBuildPhase section */
/* Begin XCBuildConfiguration section */
		DDDDDDDDDDDDDDDDDDDDDD02 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.acme.myapp;
			};
			name = Debug;
		};
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
		DDDDDDDDDDDDDDDDDDDDDD01 /* Build configuration list for PBXNativeTarget "MyApp" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				DDDDDDDDDDDDDDDDDDDDDD02 /* Debug */,
			);
		};
/* End XCConfigurationList section */
	};
	rootObject = FFFFFFFFFFFFFFFFFFFFFF01 /* Project object */;
}
`;

/** A textbook SwiftUI entry point: no initializer, so one has to be added. */
const APP_ENTRY = `import SwiftUI

@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            HomeScreen()
        }
    }
}
`;

async function scaffold(dir: string, pbxproj = APP_ONLY_PBXPROJ) {
  await mkdir(join(dir, "MyApp/Features/Home"), { recursive: true });
  await mkdir(join(dir, "MyApp.xcodeproj"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(join(dir, "MyApp/MyApp.swift"), APP_ENTRY);
  await writeFile(
    join(dir, "MyApp/Features/Home/HomeScreen.swift"),
    'import SwiftUI\nstruct HomeScreen: View { var body: some View { Text("h") } }\n',
  );
  await writeFile(
    join(dir, "MyApp/Features/Home/Router.swift"),
    "import SwiftUI\nstruct Router { func start() -> some View { HomeScreen() } }\n",
  );
  await writeFile(join(dir, "MyApp.xcodeproj/project.pbxproj"), pbxproj);
}

const pbxPath = () => join(root, "MyApp.xcodeproj/project.pbxproj");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-setup-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("xforge test setup", () => {
  it("creates a UI test target the OS will accept", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});

    const result = await runTestSetup(ctx(root), {});

    expect(result.ready).toBe(true);
    const content = await readFile(pbxPath(), "utf8");
    const uiTest = parsePbxprojTargets(content).find(
      (t) => t.productType === "com.apple.product-type.bundle.ui-testing",
    );
    expect(uiTest?.name).toBe("MyAppUITests");
    // The project must still be structurally sound, or Xcode will not open it.
    expect(verifyPbxproj(content, { targets: 2 })).toEqual({ ok: true });
  });

  it("writes a backup before touching the project", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const before = await readFile(pbxPath(), "utf8");

    const result = await runTestSetup(ctx(root), {});

    expect(result.backup).toBeDefined();
    expect(await readFile(join(root, result.backup!), "utf8")).toBe(before);
  });

  it("writes nothing under --dry-run", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const before = await readFile(pbxPath(), "utf8");

    const result = await runTestSetup(ctx(root), { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(await readFile(pbxPath(), "utf8")).toBe(before);
    expect(existsSync(join(root, "MyApp.xcodeproj/MyAppUITests"))).toBe(false);
  });

  it("creates the Info.plist and a shared scheme", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await runTestSetup(ctx(root), {});

    expect(
      existsSync(join(root, "MyApp.xcodeproj/MyAppUITests/Info.plist")),
    ).toBe(true);
    const scheme = join(
      root,
      "MyApp.xcodeproj/xcshareddata/xcschemes/MyApp.xcscheme",
    );
    expect(existsSync(scheme)).toBe(true);
    // The scheme has to name the test bundle, or `xcodebuild test` runs nothing.
    expect(await readFile(scheme, "utf8")).toContain("MyAppUITests.xctest");
  });

  it("records what it resolved in the QA config", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await runTestSetup(ctx(root), {});

    const config = await loadTestConfig(root);
    expect(config.project.ui_test_target).toBe("MyAppUITests");
    expect(config.project.scheme).toBe("MyApp");
  });

  it("is idempotent — a second run changes nothing", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await runTestSetup(ctx(root), {});
    const after = await readFile(pbxPath(), "utf8");

    const second = await runTestSetup(ctx(root), {});

    expect(await readFile(pbxPath(), "utf8")).toBe(after);
    expect(second.steps.every((s) => s.status !== "failed")).toBe(true);
    expect(second.steps.find((s) => s.name === "UI test target")?.status).toBe(
      "skipped",
    );
  });

  it("puts the test-support file in the app target and calls it once", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});

    await runTestSetup(ctx(root), {});

    // The file has to be compiled into the app, or the call will not build.
    const pbx = await readFile(pbxPath(), "utf8");
    expect(pbx).toContain("XForgeTestSupport.swift");

    const entry = await readFile(join(root, "MyApp/MyApp.swift"), "utf8");
    expect(entry).toContain("XForgeTestSupport.configure()");
    // DEBUG-guarded, because the callee itself only exists in DEBUG.
    const lines = entry.split("\n");
    const call = lines.findIndex((l) => l.includes("configure()"));
    expect(lines[call - 1]?.trim()).toBe("#if DEBUG");
    expect(lines[call + 1]?.trim()).toBe("#endif");
    // Exactly one call site — the app's own code is otherwise untouched.
    expect(entry.match(/configure\(\)/g)).toHaveLength(1);
    expect(entry).toContain("WindowGroup {");
  });

  it("does not touch product source under --dry-run", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const before = await readFile(join(root, "MyApp/MyApp.swift"), "utf8");

    const result = await runTestSetup(ctx(root), { dryRun: true });

    expect(await readFile(join(root, "MyApp/MyApp.swift"), "utf8")).toBe(
      before,
    );
    expect(
      result.steps.find((s) => s.name === "Test-support hook")?.detail,
    ).toContain("would call");
  });

  it("adds the call only once across runs", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await runTestSetup(ctx(root), {});
    const after = await readFile(join(root, "MyApp/MyApp.swift"), "utf8");

    const second = await runTestSetup(ctx(root), {});

    expect(await readFile(join(root, "MyApp/MyApp.swift"), "utf8")).toBe(after);
    expect(
      second.steps.find((s) => s.name === "Test-support hook")?.status,
    ).toBe("skipped");
  });

  it("leaves the app alone when it cannot recognise the entry point", async () => {
    await scaffold(root);
    // A UIKit delegate: the shape varies too much to edit blind.
    await writeFile(
      join(root, "MyApp/MyApp.swift"),
      "import UIKit\n@main\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n}\n",
    );
    await runInit(ctx(root), {});
    const before = await readFile(join(root, "MyApp/MyApp.swift"), "utf8");

    const result = await runTestSetup(ctx(root), {});

    expect(await readFile(join(root, "MyApp/MyApp.swift"), "utf8")).toBe(
      before,
    );
    const step = result.steps.find((s) => s.name === "Test-support hook");
    expect(step?.status).toBe("skipped");
    expect(step?.detail).toContain("didFinishLaunchingWithOptions");
    // A hook it declined to write is not a reason to call the project un-QA-able:
    // the hooks are empty stubs, and the tests run without them.
    expect(result.ready).toBe(true);
  });

  it("keeps the pre-setup pbxproj as the backup, not an intermediate one", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const before = await readFile(pbxPath(), "utf8");

    // Two steps edit the project; only the first backup is the real original.
    const result = await runTestSetup(ctx(root), {});

    expect(await readFile(join(root, result.backup!), "utf8")).toBe(before);
  });

  it("refuses a project with no application target", async () => {
    const noApp = APP_ONLY_PBXPROJ.replace(
      '"com.apple.product-type.application"',
      '"com.apple.product-type.library.static"',
    );
    await scaffold(root, noApp);
    await runInit(ctx(root), {});

    await expect(runTestSetup(ctx(root), {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses an SPM package rather than inventing a project", async () => {
    await mkdir(join(root, "Sources/App"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(
      join(root, "Package.swift"),
      'import PackageDescription\nlet package = Package(name: "App")\n',
    );
    await runInit(ctx(root), {});

    await expect(runTestSetup(ctx(root), {})).rejects.toThrow(/No .xcodeproj/);
  });

  it("leaves the project untouched when the edit cannot be verified", async () => {
    // A project missing its Products group cannot take a product reference;
    // the edit must decline rather than write something half-wired.
    const broken = APP_ONLY_PBXPROJ.replace(
      "BBBBBBBBBBBBBBBBBBBBBB01 /* Products */ = {\n\t\t\tisa = PBXGroup;",
      "BBBBBBBBBBBBBBBBBBBBBB01 /* Products */ = {\n\t\t\tisa = PBXOther;",
    );
    await scaffold(root, broken);
    await runInit(ctx(root), {});

    const result = await runTestSetup(ctx(root), {});

    expect(result.ready).toBe(false);
    expect(result.steps.find((s) => s.name === "UI test target")?.status).toBe(
      "failed",
    );
    expect(await readFile(pbxPath(), "utf8")).toBe(broken);
  });
});
