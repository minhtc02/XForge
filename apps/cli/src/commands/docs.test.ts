import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@xforge/shared";
import { loadConfig } from "@xforge/core";
import { runInit } from "./init.js";
import { runDocs } from "./docs.js";
import type { CliContext } from "../context.js";

/**
 * Which truth `xforge docs` builds from.
 *
 * The distinction is not cosmetic: under `project-docs` a statement in the
 * project's own PRD becomes a requirement the implementation is measured
 * against, and under `code` it does not. These cover that difference, the
 * separation between the tree XForge reads and the tree it writes, and the
 * rule that a non-interactive run never blocks on the confirmation prompt.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    // json: true also stands in for "not a TTY" — canPrompt() refuses either
    // way, which is exactly the CI path these tests exercise.
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

async function scaffoldProject(dir: string): Promise<void> {
  await mkdir(join(dir, "App/Features/Alarm"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmView.swift"),
    'import SwiftUI\nstruct AlarmView: View { var body: some View { Text("a") } }\n',
  );
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmViewModel.swift"),
    "import Foundation\nfinal class AlarmViewModel: ObservableObject {}\n",
  );
}

/** A PRD that lives in the project's tree, not in any of the `sources.prd` globs. */
async function scaffoldProjectDocs(dir: string): Promise<void> {
  await mkdir(join(dir, "docs/project"), { recursive: true });
  await writeFile(
    join(dir, "docs/project/alarm.md"),
    [
      "# Alarm",
      "",
      "- The app must let a user schedule a recurring alarm.",
      "- The app should support snoozing an alarm.",
      "",
    ].join("\n"),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-docs-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("docs source selection", () => {
  it("defaults to the project's documents and turns them into requirements", async () => {
    await scaffoldProject(root);
    await scaffoldProjectDocs(root);
    await runInit(ctx(root), {});

    const result = await runDocs(ctx(root), {});

    expect(result.source).toBe("project-docs");
    expect(result.projectDocCount).toBe(1);
    // Both normative bullets became requirements traceable to the document.
    expect(result.stats.requirements).toBeGreaterThanOrEqual(2);
  });

  it("ignores those same documents as requirements under --from-code", async () => {
    await scaffoldProject(root);
    await scaffoldProjectDocs(root);
    await runInit(ctx(root), {});

    const result = await runDocs(ctx(root), { source: "code" });

    expect(result.source).toBe("code");
    // The document is still found — it is just no longer treated as intent.
    expect(result.projectDocCount).toBe(1);
    expect(result.stats.requirements).toBe(0);
    expect(result.stats.features).toBeGreaterThan(0);
  });

  it("records the code-first choice as an assumption", async () => {
    await scaffoldProject(root);
    await scaffoldProjectDocs(root);
    await runInit(ctx(root), {});
    await runDocs(ctx(root), { source: "code" });

    const model = JSON.parse(
      await readFile(join(root, ".xforge/state/project-model.json"), "utf8"),
    );
    const descriptions = model.assumptions.map(
      (a: { description: string }) => a.description,
    );
    expect(
      descriptions.some((d: string) => d.includes("from source code")),
    ).toBe(true);
  });

  it("honours a configured code-first default without a flag", async () => {
    await scaffoldProject(root);
    await scaffoldProjectDocs(root);
    await runInit(ctx(root), {});
    const cfgPath = join(root, ".xforge/config.yaml");
    const cfg = await readFile(cfgPath, "utf8");
    await writeFile(
      cfgPath,
      cfg.replace("docs_source: project-docs", "docs_source: code"),
    );

    const result = await runDocs(ctx(root), {});
    expect(result.source).toBe("code");
  });

  it("writes to a different tree than the one it reads", async () => {
    await scaffoldProject(root);
    await scaffoldProjectDocs(root);
    await runInit(ctx(root), {});
    await runDocs(ctx(root), {});

    const config = await loadConfig(root);
    expect(config.output.root).toBe(".xforge/docs");
    expect(existsSync(join(root, ".xforge/docs/index.md"))).toBe(true);

    // The source document survives generation byte for byte. If output ever
    // landed in the input tree, the next run would ingest its own prose.
    expect(await readFile(join(root, "docs/project/alarm.md"), "utf8")).toBe(
      [
        "# Alarm",
        "",
        "- The app must let a user schedule a recurring alarm.",
        "- The app should support snoozing an alarm.",
        "",
      ].join("\n"),
    );
    expect(existsSync(join(root, "docs/project/index.md"))).toBe(false);
  });

  it("refuses to silently document the code when project documents are missing", async () => {
    await scaffoldProject(root);
    await runInit(ctx(root), {});

    // A docs-first run with nothing to lead with used to degrade into a
    // code-only tree still labelled "from docs". Now it stops and points at
    // the explicit flag instead.
    await expect(runDocs(ctx(root), {})).rejects.toThrow(/--from-code/);
    expect(existsSync(join(root, ".xforge/docs/index.md"))).toBe(false);
  });

  it("an explicit --from-code runs without documents and records the choice", async () => {
    await scaffoldProject(root);
    await runInit(ctx(root), {});

    const result = await runDocs(ctx(root), { source: "code" });

    expect(result.source).toBe("code");
    expect(result.stats.features).toBeGreaterThan(0);
    // The explicit choice is persisted so `docs sync` and later runs follow
    // it instead of hitting the no-documents refusal.
    const config = await loadConfig(root);
    expect(config.generation.docs_source).toBe("code");
    const rerun = await runDocs(ctx(root), {});
    expect(rerun.source).toBe("code");
  });
});
