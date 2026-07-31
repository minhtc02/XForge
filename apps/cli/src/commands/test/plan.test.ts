import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, ValidationError } from "@xforge/shared";
import { runInit } from "../init.js";
import { runDocs } from "../docs.js";
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
