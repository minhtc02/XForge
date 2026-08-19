import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlreadyExistsError, createLogger } from "@xforge/shared";
import { loadConfig } from "@xforge/core";
import { loadTestConfig } from "@xforge/test-core";
import { runInit } from "./init.js";
import type { CliContext } from "../context.js";

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

async function scaffoldIosFixture(dir: string): Promise<void> {
  await mkdir(join(dir, "Sources/Alarm"), { recursive: true });
  await mkdir(join(dir, "Tests/AlarmTests"), { recursive: true });
  await mkdir(join(dir, ".specify/memory"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "Package.swift"),
    'import PackageDescription\nlet package = Package(name: "Cuckoo")\n',
  );
  await writeFile(
    join(dir, "Sources/Alarm/AlarmView.swift"),
    'import SwiftUI\nstruct AlarmView: View { var body: some View { Text("a") } }\n',
  );
  await writeFile(
    join(dir, "Sources/Alarm/AlarmScheduler.swift"),
    "import UserNotifications\nfinal class AlarmScheduler {}\n",
  );
  await writeFile(
    join(dir, "Tests/AlarmTests/AlarmSchedulerTests.swift"),
    "import XCTest\nfinal class AlarmSchedulerTests: XCTestCase {}\n",
  );
  await writeFile(
    join(dir, ".specify/memory/constitution.md"),
    "# Constitution\n- No force unwrap\n",
  );
  // A secret file that must never be ingested.
  await writeFile(
    join(dir, "GoogleService-Info.plist"),
    "SECRET_API_KEY=abc123",
  );
}

/** A minimal but realistic Xcode project: shared scheme, app + UI test target. */
async function scaffoldXcodeProject(dir: string): Promise<void> {
  await mkdir(join(dir, "Cuckoo.xcodeproj/xcshareddata/xcschemes"), {
    recursive: true,
  });
  await writeFile(
    join(dir, "Cuckoo.xcodeproj/xcshareddata/xcschemes/Cuckoo.xcscheme"),
    "<Scheme/>",
  );
  await writeFile(
    join(dir, "Cuckoo.xcodeproj/project.pbxproj"),
    `// !$*UTF8*$!
{
	objects = {
/* Begin PBXNativeTarget section */
		A1 /* Cuckoo */ = {
			isa = PBXNativeTarget;
			name = Cuckoo;
			productType = "com.apple.product-type.application";
		};
		A2 /* CuckooUITests */ = {
			isa = PBXNativeTarget;
			name = CuckooUITests;
			productType = "com.apple.product-type.bundle.ui-testing";
		};
/* End PBXNativeTarget section */
/* Begin XCBuildConfiguration section */
		B1 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.acme.cuckoo;
			};
		};
/* End XCBuildConfiguration section */
	};
}
`,
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-init-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runInit", () => {
  it("detects an iOS project and writes config + state + output dirs", async () => {
    await scaffoldIosFixture(root);
    const result = await runInit(ctx(root), {});

    expect(result.detection.platform).toBe("iOS");
    expect(result.detection.ui).toContain("SwiftUI");
    expect(result.detection.tests).toContain("XCTest");
    expect(result.detection.hasSpecKit).toBe(true);

    expect(existsSync(join(root, ".xforge/config.yaml"))).toBe(true);
    expect(existsSync(join(root, ".xforge/state"))).toBe(true);
    expect(existsSync(join(root, ".xforge/docs/_meta"))).toBe(true);
    // The input tree is created too, so there is an obvious place for a PRD.
    expect(existsSync(join(root, "docs/project"))).toBe(true);
    expect(result.projectDocsExisted).toBe(false);

    const cfg = await loadConfig(root);
    expect(cfg.project.profile).toBe("ios-swift");
    expect(cfg.project.name).toBe("Cuckoo");
  });

  it("adopts an existing docs/project/ without touching what is in it", async () => {
    await scaffoldIosFixture(root);
    // A project that already keeps its PRD where XForge expects to read it.
    await mkdir(join(root, "docs/project"), { recursive: true });
    await writeFile(
      join(root, "docs/project/prd.md"),
      "# PRD\n- The app must ring an alarm.\n",
    );

    const result = await runInit(ctx(root), {});

    expect(result.projectDocsExisted).toBe(true);
    expect(result.projectDocsDir).toBe("docs/project");
    expect(await readFile(join(root, "docs/project/prd.md"), "utf8")).toContain(
      "must ring an alarm",
    );
  });

  it("does not read secret files into config", async () => {
    await scaffoldIosFixture(root);
    await runInit(ctx(root), {});
    const configText = await readFile(
      join(root, ".xforge/config.yaml"),
      "utf8",
    );
    expect(configText).not.toContain("abc123");
  });

  it("refuses to overwrite an existing config without --force", async () => {
    await scaffoldIosFixture(root);
    await runInit(ctx(root), {});
    await expect(runInit(ctx(root), {})).rejects.toBeInstanceOf(
      AlreadyExistsError,
    );
  });

  it("overwrites with --force", async () => {
    await scaffoldIosFixture(root);
    await runInit(ctx(root), {});
    const result = await runInit(ctx(root), { force: true });
    expect(result.createdConfig).toBe(true);
  });

  it("writes a QA config with the resolved Xcode values", async () => {
    await scaffoldIosFixture(root);
    await scaffoldXcodeProject(root);
    const result = await runInit(ctx(root), {});

    expect(result.detection.xcode?.scheme).toBe("Cuckoo");
    expect(result.detection.xcode?.uiTestTarget).toBe("CuckooUITests");
    expect(result.unresolvedXcodeFields).toEqual([]);

    const testConfig = await loadTestConfig(root);
    expect(testConfig.project.scheme).toBe("Cuckoo");
    expect(testConfig.project.app_bundle_id).toBe("com.acme.cuckoo");
    expect(testConfig.project.ui_test_target).toBe("CuckooUITests");
    expect(testConfig.project.project).toBe("Cuckoo.xcodeproj");
  });

  it("leaves unresolvable fields as `auto` and reports them", async () => {
    // No .xcodeproj at all: an SPM package. Nothing may be invented.
    await scaffoldIosFixture(root);
    const result = await runInit(ctx(root), {});
    expect(result.detection.xcode).toBeUndefined();

    const testConfig = await loadTestConfig(root);
    expect(testConfig.project.scheme).toBe("auto");
    expect(testConfig.project.app_bundle_id).toBe("auto");
  });

  it("does not clobber a QA config the user already wrote", async () => {
    await scaffoldIosFixture(root);
    await scaffoldXcodeProject(root);
    // A hand-written QA config that predates `init` must survive it.
    await mkdir(join(root, ".xforge/test"), { recursive: true });
    await writeFile(
      join(root, ".xforge/test/config.yaml"),
      "version: 1\nproject:\n  scheme: HandEdited\n",
    );

    const result = await runInit(ctx(root), {});
    expect(result.testConfigSkipped).toBe(true);
    expect(result.testConfigPath).toBeUndefined();
    expect((await loadTestConfig(root)).project.scheme).toBe("HandEdited");
  });

  it("regenerates the QA config with --force", async () => {
    await scaffoldIosFixture(root);
    await scaffoldXcodeProject(root);
    await mkdir(join(root, ".xforge/test"), { recursive: true });
    await writeFile(
      join(root, ".xforge/test/config.yaml"),
      "version: 1\nproject:\n  scheme: HandEdited\n",
    );

    await runInit(ctx(root), { force: true });
    expect((await loadTestConfig(root)).project.scheme).toBe("Cuckoo");
  });
});
