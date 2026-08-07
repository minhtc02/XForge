import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@xforge/shared";
import { loadConfig } from "@xforge/core";
import { loadTestConfig, testConfigPath } from "@xforge/test-core";
import { runInit } from "./init.js";
import { runDocs } from "./docs.js";
import { runUpgrade } from "./upgrade.js";
import type { CliContext } from "../context.js";

/**
 * Upgrading must never cost a user their settings. These lock in the one
 * property that makes `upgrade` safe where `init --force` is not: it only adds.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

async function scaffold(dir: string): Promise<void> {
  await mkdir(join(dir, "App/Features/Alarm"), { recursive: true });
  await mkdir(join(dir, "AppUITests"), { recursive: true });
  await mkdir(join(dir, "MyApp.xcodeproj/xcshareddata/xcschemes"), {
    recursive: true,
  });
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmView.swift"),
    'import SwiftUI\nstruct AlarmView: View { var body: some View { Text("a").accessibilityIdentifier("alarm-list") } }\n',
  );
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmViewModel.swift"),
    "import Foundation\nfinal class AlarmViewModel: ObservableObject {}\n",
  );
  await writeFile(
    join(dir, "AppUITests/T.swift"),
    "import XCTest\nfinal class T: XCTestCase { func testA() {} }\n",
  );
  await writeFile(
    join(dir, "MyApp.xcodeproj/xcshareddata/xcschemes/MyApp.xcscheme"),
    "<Scheme/>",
  );
  await writeFile(
    join(dir, "MyApp.xcodeproj/project.pbxproj"),
    `{ objects = {
/* Begin PBXNativeTarget section */
		A1 /* MyApp */ = {
			isa = PBXNativeTarget;
			name = MyApp;
			productType = "com.apple.product-type.application";
		};
		A2 /* AppUITests */ = {
			isa = PBXNativeTarget;
			name = AppUITests;
			productType = "com.apple.product-type.bundle.ui-testing";
		};
/* End PBXNativeTarget section */
/* Begin XCBuildConfiguration section */
		B1 = { isa = XCBuildConfiguration; buildSettings = { PRODUCT_BUNDLE_IDENTIFIER = com.acme.myapp; }; };
/* End XCBuildConfiguration section */
}; }
`,
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-upgrade-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runUpgrade", () => {
  it("creates a QA config and fills the values it can resolve", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await rm(testConfigPath(root), { force: true }); // as an older init left it

    const result = await runUpgrade(ctx(root), {});

    expect(result.createdTestConfig).toBe(true);
    const filled = Object.fromEntries(
      result.filled.map((f) => [f.key, f.value]),
    );
    expect(filled["project.scheme"]).toBe("MyApp");
    expect(filled["project.app_bundle_id"]).toBe("com.acme.myapp");
    expect(filled["project.ui_test_target"]).toBe("AppUITests");
    expect((await loadTestConfig(root)).project.scheme).toBe("MyApp");
  });

  it("never overwrites a value the project already set", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await writeFile(
      testConfigPath(root),
      "version: 1\nproject:\n  scheme: MyCustomScheme\n",
    );

    const result = await runUpgrade(ctx(root), {});

    expect(result.kept.map((k) => k.key)).toContain("project.scheme");
    expect(result.filled.map((f) => f.key)).not.toContain("project.scheme");
    expect((await loadTestConfig(root)).project.scheme).toBe("MyCustomScheme");
    // The fields left at `auto` are still filled in.
    expect((await loadTestConfig(root)).project.app_bundle_id).toBe(
      "com.acme.myapp",
    );
  });

  it("leaves the main config — including hand edits — untouched", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const edited = (await readFile(join(root, ".xforge/config.yaml"), "utf8"))
      .replace(
        "features: {}",
        "features:\n  alarm:\n    paths:\n      - App/Features/Alarm/**",
      )
      .replace("language: vi", "language: en");
    await writeFile(join(root, ".xforge/config.yaml"), edited);

    await runUpgrade(ctx(root), {});

    const config = await loadConfig(root);
    expect(config.output.language).toBe("en");
    expect(config.features.alarm?.paths).toEqual(["App/Features/Alarm/**"]);
  });

  it("writes nothing on a dry run", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await rm(testConfigPath(root), { force: true });

    const result = await runUpgrade(ctx(root), { dryRun: true });

    expect(result.filled.length).toBeGreaterThan(0);
    expect(result.createdTestConfig).toBe(false);
    await expect(readFile(testConfigPath(root), "utf8")).rejects.toThrow();
  });

  it("detects state that predates this build by its missing artifacts", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await runDocs(ctx(root), {});
    // An older build wrote no digest and no appendices.
    await rm(join(root, ".xforge/state/model-digest.json"), { force: true });
    await rm(join(root, ".xforge/state/model"), {
      recursive: true,
      force: true,
    });

    const result = await runUpgrade(ctx(root), { dryRun: true });
    const docsAction = result.actions.find((a) => a.run === "xforge docs");
    expect(docsAction?.what).toContain("model-digest.json");
    expect(docsAction?.what).toContain("state/model/");
  });

  it("reports nothing to do once the project is current", async () => {
    await scaffold(root);
    await writeFile(
      join(root, ".gitignore"),
      "qa-runs/\n.xforge/cache/\n.xforge/logs/\n",
    );
    await runInit(ctx(root), {});
    await runDocs(ctx(root), {});

    const result = await runUpgrade(ctx(root), {});
    expect(result.actions).toEqual([]);
    expect(result.filled).toEqual([]);
  });

  it("flags a .gitignore missing XForge run artifacts", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const result = await runUpgrade(ctx(root), { dryRun: true });
    const ignoreAction = result.actions.find((a) =>
      a.what.includes(".gitignore"),
    );
    expect(ignoreAction?.what).toContain("qa-runs/");
  });

  it("flags a pre-split layout that writes into the tree it now reads", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    // What every project initialized before the input/output split looks like:
    // output.root is the same tree `docs` now treats as the source of truth.
    const cfgPath = join(root, ".xforge/config.yaml");
    const cfg = await readFile(cfgPath, "utf8");
    await writeFile(
      cfgPath,
      cfg.replace("root: docs/xforge", "root: docs/project"),
    );

    const result = await runUpgrade(ctx(root), { dryRun: true });
    const action = result.actions.find((a) => a.what.includes("output.root"));
    expect(action?.what).toContain("read its own output");
    expect(action?.run).toContain("docs/xforge");
  });

  it("does not flag the default layout", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    const result = await runUpgrade(ctx(root), { dryRun: true });
    expect(result.actions.some((a) => a.what.includes("output.root"))).toBe(
      false,
    );
  });
});
