import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, ValidationError } from "@xforge/shared";
import { runInit } from "../init.js";
import { runDocs } from "../docs.js";
import { verifyPbxproj } from "@xforge/core";
import { runTestPlan } from "./plan.js";
import type { CliContext } from "../../context.js";

/**
 * `xforge test plan` is a pipeline: preflight -> scaffold navigation -> plan ->
 * generate. These cover the seams between those steps, especially the failure
 * paths — a plan that was written must never be lost because a later step
 * could not run.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

/** An iOS project with two feature files and a UI test target. */
async function scaffoldProject(dir: string): Promise<void> {
  await mkdir(join(dir, "App/Features/Alarm"), { recursive: true });
  await mkdir(join(dir, "AppUITests"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmView.swift"),
    'import SwiftUI\nstruct AlarmView: View {\n  var body: some View { Text("a").accessibilityIdentifier("alarm-list") }\n}\n',
  );
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmViewModel.swift"),
    "import Foundation\nfinal class AlarmViewModel: ObservableObject {}\n",
  );
  await writeFile(
    join(dir, "AppUITests/AlarmUITests.swift"),
    "import XCTest\nfinal class AlarmUITests: XCTestCase { func testLaunch() {} }\n",
  );
}

/** A minimal but structurally complete Xcode project with two targets. */
async function scaffoldXcode(dir: string): Promise<void> {
  await mkdir(join(dir, "MyApp.xcodeproj/xcshareddata/xcschemes"), {
    recursive: true,
  });
  await writeFile(
    join(dir, "MyApp.xcodeproj/xcshareddata/xcschemes/MyApp.xcscheme"),
    "<Scheme/>",
  );
  await writeFile(
    join(dir, "MyApp.xcodeproj/project.pbxproj"),
    `// !$*UTF8*$!
{
	objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
/* End PBXFileReference section */
/* Begin PBXGroup section */
		DDDDDDDDDDDDDDDDDDDDDD01 /* AppUITests */ = {
			isa = PBXGroup;
			children = (
			);
			path = AppUITests;
			sourceTree = "<group>";
		};
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
		EEEEEEEEEEEEEEEEEEEEEE01 /* MyApp */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				FFFFFFFFFFFFFFFFFFFFFF01 /* Sources */,
			);
			name = MyApp;
			productType = "com.apple.product-type.application";
		};
		EEEEEEEEEEEEEEEEEEEEEE02 /* AppUITests */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				FFFFFFFFFFFFFFFFFFFFFF02 /* Sources */,
			);
			name = AppUITests;
			productType = "com.apple.product-type.bundle.ui-testing";
		};
/* End PBXNativeTarget section */
/* Begin PBXSourcesBuildPhase section */
		FFFFFFFFFFFFFFFFFFFFFF01 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
			);
		};
		FFFFFFFFFFFFFFFFFFFFFF02 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
			);
		};
/* End PBXSourcesBuildPhase section */
/* Begin XCBuildConfiguration section */
		B1 = { isa = XCBuildConfiguration; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = com.acme.myapp; }; };
/* End XCBuildConfiguration section */
	};
}
`,
  );
}

async function initAndDocs(dir: string): Promise<void> {
  await runInit(ctx(dir), {});
  await runDocs(ctx(dir), {});
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-plan-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("published model", () => {
  it("publishes the complete model under _meta by default", async () => {
    await scaffoldProject(root);
    await initAndDocs(root);

    const published = JSON.parse(
      await readFile(
        join(root, "docs/project/_meta/project-model.json"),
        "utf8",
      ),
    );
    // Complete: the inventories are inline, not split out to appendices.
    expect(published.source_files.length).toBeGreaterThan(0);
    expect(published.symbols.length).toBeGreaterThan(0);
    expect(published.appendix_counts).toBeUndefined();

    // Working state stays split, so an agent still reads a small file.
    const core = JSON.parse(
      await readFile(join(root, ".xforge/state/project-model.json"), "utf8"),
    );
    expect(core.source_files).toEqual([]);
    expect(core.appendix_counts.source_files).toBeGreaterThan(0);
  });

  it("publishes the core when publish_full_model is off", async () => {
    await scaffoldProject(root);
    await runInit(ctx(root), {});
    const cfgPath = join(root, ".xforge/config.yaml");
    const cfg = await readFile(cfgPath, "utf8");
    expect(cfg).toContain("publish_full_model: true");
    await writeFile(
      cfgPath,
      cfg.replace("publish_full_model: true", "publish_full_model: false"),
    );
    await runDocs(ctx(root), {});

    const published = JSON.parse(
      await readFile(
        join(root, "docs/project/_meta/project-model.json"),
        "utf8",
      ),
    );
    expect(published.source_files).toEqual([]);
    expect(published.appendix_counts.source_files).toBeGreaterThan(0);
  });
});

describe("runTestPlan pipeline", () => {
  it("scaffolds navigation, plans and generates in one call", async () => {
    await scaffoldProject(root);
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), { level: "smoke" });

    expect(result.preflight?.ok).toBe(true);
    expect(result.navigationScaffolded).toBeDefined();
    expect(existsSync(join(root, ".xforge/test/navigation.yaml"))).toBe(true);
    expect(result.stats.total_cases).toBeGreaterThan(0);
    expect(result.generated?.cases).toBe(result.stats.total_cases);
    expect(
      existsSync(
        join(
          root,
          ".xforge/test/generated-tests",
          result.planId,
          "XForgeUITests.swift",
        ),
      ),
    ).toBe(true);
  });

  it("refuses to plan when the preflight finds a hard failure", async () => {
    await scaffoldProject(root);
    await runInit(ctx(root), {}); // no `docs`, so there is no Project Model
    await expect(runTestPlan(ctx(root), {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("keeps the plan when generation cannot run", async () => {
    await scaffoldProject(root);
    // Removing the UI test target blocks every case, so generation must fail.
    await rm(join(root, "AppUITests"), { recursive: true, force: true });
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), { level: "smoke" });

    expect(result.generated).toBeUndefined();
    expect(result.generateSkippedReason).toContain("blocked");
    // The plan itself survived.
    expect(
      existsSync(join(root, ".xforge/test/plans", result.planId, "plan.json")),
    ).toBe(true);
  });

  it("honours --no-navigation and --no-generate", async () => {
    await scaffoldProject(root);
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), {
      level: "smoke",
      navigation: false,
      generate: false,
    });

    expect(result.navigationScaffolded).toBeUndefined();
    expect(existsSync(join(root, ".xforge/test/navigation.yaml"))).toBe(false);
    expect(result.generated).toBeUndefined();
    // The plan is still produced.
    expect(result.stats.total_cases).toBeGreaterThan(0);
  });

  it("skips the preflight when asked", async () => {
    await scaffoldProject(root);
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), {
      level: "smoke",
      doctor: false,
    });
    expect(result.preflight).toBeUndefined();
  });

  it("approves the plan and wires sources into Xcode by default", async () => {
    await scaffoldProject(root);
    await scaffoldXcode(root);
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), { level: "smoke" });

    expect(result.approved).toBe(true);
    expect(result.planHash).toMatch(/^sha256:/);
    expect(
      existsSync(
        join(root, ".xforge/test/plans", result.planId, "approval.json"),
      ),
    ).toBe(true);

    // Sources landed in the project, and the project is still valid.
    expect(result.xcodeIntegration?.method).toBe("pbxproj");
    expect(result.xcodeIntegration?.added.map((a) => a.file)).toContain(
      "XForgeUITests.swift",
    );
    const pbx = await readFile(
      join(root, "MyApp.xcodeproj/project.pbxproj"),
      "utf8",
    );
    expect(verifyPbxproj(pbx, { targets: 2 })).toEqual({ ok: true });
    expect(
      existsSync(join(root, "MyApp.xcodeproj/project.pbxproj.xforge-backup")),
    ).toBe(true);
  });

  it("adds each source exactly once when re-planned", async () => {
    await scaffoldProject(root);
    await scaffoldXcode(root);
    await initAndDocs(root);
    await runTestPlan(ctx(root), { level: "smoke" });
    await runTestPlan(ctx(root), { level: "smoke", force: true });

    const pbx = await readFile(
      join(root, "MyApp.xcodeproj/project.pbxproj"),
      "utf8",
    );
    const refs = pbx.match(
      /isa = PBXFileReference;[^\n]*XForgeUITests\.swift/g,
    );
    expect(refs).toHaveLength(1);
    expect(verifyPbxproj(pbx, { targets: 2 }).ok).toBe(true);
  });

  it("honours --no-approve and --no-xcode", async () => {
    await scaffoldProject(root);
    await scaffoldXcode(root);
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), {
      level: "smoke",
      approve: false,
      xcode: false,
    });

    expect(result.approved).toBe(false);
    expect(result.xcodeIntegration).toBeUndefined();
    const pbx = await readFile(
      join(root, "MyApp.xcodeproj/project.pbxproj"),
      "utf8",
    );
    expect(pbx).not.toContain("XForgeUITests.swift");
  });

  it("declines to touch a project it cannot edit safely", async () => {
    await scaffoldProject(root);
    await scaffoldXcode(root);
    // Remove the UI test target's sources phase: there is nowhere valid to add.
    const pbxPath = join(root, "MyApp.xcodeproj/project.pbxproj");
    const pbx = await readFile(pbxPath, "utf8");
    await writeFile(
      pbxPath,
      pbx.replace("\t\t\t\tFFFFFFFFFFFFFFFFFFFFFF02 /* Sources */,\n", ""),
    );
    await initAndDocs(root);

    const result = await runTestPlan(ctx(root), { level: "smoke" });

    // Partial success is the right outcome: the app target is intact, so the
    // support file goes in; only the file with nowhere valid to land is
    // declined, and it says so rather than failing silently.
    expect(result.xcodeIntegration?.added.map((a) => a.file)).toEqual([
      "XForgeTestSupport.swift",
    ]);
    const warning = result.xcodeIntegration?.warnings.join(" ") ?? "";
    expect(warning).toContain("XForgeUITests.swift");
    expect(warning).toContain("Add it in Xcode");

    // Whatever happened, the project must still open.
    const after = await readFile(pbxPath, "utf8");
    expect(verifyPbxproj(after, { targets: 2 }).ok).toBe(true);
  });

  it("does not re-scaffold an existing navigation graph", async () => {
    await scaffoldProject(root);
    await initAndDocs(root);
    await mkdir(join(root, ".xforge/test"), { recursive: true });
    const authored =
      "schema_version: 1\nroot: root\nnodes:\n  - id: root\n    anchor: root\n    provenance: explicit\n    confidence: 0.9\nedges: []\n";
    await writeFile(join(root, ".xforge/test/navigation.yaml"), authored);

    const result = await runTestPlan(ctx(root), {
      level: "smoke",
      generate: false,
    });
    expect(result.navigationScaffolded).toBeUndefined();
  });
});
