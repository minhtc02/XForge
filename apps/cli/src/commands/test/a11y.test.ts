import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, ValidationError } from "@xforge/shared";
import { runInit } from "../init.js";
import { runDocs } from "../docs.js";
import { runTestPlan } from "./plan.js";
import { runTestA11y } from "./a11y.js";
import type { CliContext } from "../../context.js";

/**
 * The end-to-end shape of the identifier path, on a project with the problem it
 * was built for: a feature whose plan anchors on a locator no view declares.
 *
 * The assertion that matters most is the negative one — an unapproved proposal
 * must leave product source byte-identical. That is the whole safety story.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

const HOME_SCREEN = `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        VStack {
            Button("Save") {
                save()
            }
        }
    }
}
`;

/**
 * Home declares no identifiers, so its cases anchor on the entry-point *type*
 * name — a locator that exists nowhere in source. Settings declares one, which
 * is what keeps the inventory non-empty: with nothing to compare against,
 * reconciliation reports nothing rather than "everything is missing".
 */
async function scaffold(dir: string): Promise<void> {
  await mkdir(join(dir, "App/Features/Home"), { recursive: true });
  await mkdir(join(dir, "App/Features/Settings"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(join(dir, "App/Features/Home/HomeScreen.swift"), HOME_SCREEN);
  await writeFile(
    join(dir, "App/Features/Home/HomeRouter.swift"),
    "import SwiftUI\nstruct HomeRouter {\n  func start() -> some View { HomeScreen() }\n}\n",
  );
  await writeFile(
    join(dir, "App/Features/Settings/SettingsScreen.swift"),
    'import SwiftUI\nstruct SettingsScreen: View {\n  var body: some View { Text("s").accessibilityIdentifier("settings-root") }\n}\n',
  );
  await writeFile(
    join(dir, "App/Features/Settings/SettingsRouter.swift"),
    "import SwiftUI\nstruct SettingsRouter {\n  func start() -> some View { SettingsScreen() }\n}\n",
  );
}

async function planned(): Promise<string> {
  await scaffold(root);
  await runInit(ctx(root), {});
  await runDocs(ctx(root), {});
  const plan = await runTestPlan(ctx(root), { level: "smoke", xcode: false });
  return plan.planId;
}

const homePath = () => join(root, "App/Features/Home/HomeScreen.swift");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-a11y-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("xforge test a11y", () => {
  it("proposes an edit for every locator source does not declare", async () => {
    const planId = await planned();

    const result = await runTestA11y(ctx(root), planId);

    expect(result.mode).toBe("proposal");
    expect(result.missing.length).toBeGreaterThan(0);
    expect(existsSync(result.proposalPath)).toBe(true);
    const proposal = JSON.parse(await readFile(result.proposalPath, "utf8"));
    expect(proposal.plan_id).toBe(planId);
    expect(proposal.requests.length).toBe(result.missing.length);
  });

  it("writes nothing to product source until an entry is approved", async () => {
    const planId = await planned();
    const before = await readFile(homePath(), "utf8");

    await runTestA11y(ctx(root), planId);
    await runTestA11y(ctx(root), planId, { apply: true });

    // Every entry defaults to approved: false, so --apply is a no-op. This is
    // the guarantee the whole two-step design exists for.
    expect(await readFile(homePath(), "utf8")).toBe(before);
  });

  it("defaults every proposed entry to unapproved", async () => {
    const planId = await planned();
    const result = await runTestA11y(ctx(root), planId);
    const proposal = JSON.parse(await readFile(result.proposalPath, "utf8"));
    expect(
      proposal.requests.every(
        (r: { approved: boolean }) => r.approved === false,
      ),
    ).toBe(true);
  });

  it("applies an approved entry, and only that one", async () => {
    const planId = await planned();
    const first = await runTestA11y(ctx(root), planId);
    const proposal = JSON.parse(await readFile(first.proposalPath, "utf8"));

    // Approve one, pointing it at the Button — what a human would do after
    // reading the site.
    const request = proposal.requests[0];
    request.approved = true;
    request.site = {
      file: "App/Features/Home/HomeScreen.swift",
      element_line: 6,
      element: 'Button("Save") {',
      kind: "Button",
      anchor_line: 8,
      anchor_text: "            }",
      indent: "            ",
    };
    await writeFile(first.proposalPath, JSON.stringify(proposal), "utf8");

    const result = await runTestA11y(ctx(root), planId, { apply: true });

    expect(result.applied?.written).toHaveLength(1);
    const source = await readFile(homePath(), "utf8");
    expect(source).toContain(`.accessibilityIdentifier("${request.locator}")`);
    // The modifier landed on the Button, not on the VStack around it.
    const lines = source.split("\n");
    const modifier = lines.findIndex((l) =>
      l.includes("accessibilityIdentifier"),
    );
    expect(lines[modifier - 1]?.trim()).toBe("}");
    expect(lines[modifier - 3]?.trim()).toBe('Button("Save") {');
  });

  it("refuses an approved entry whose anchor line has moved", async () => {
    const planId = await planned();
    const first = await runTestA11y(ctx(root), planId);
    const proposal = JSON.parse(await readFile(first.proposalPath, "utf8"));
    proposal.requests[0].approved = true;
    proposal.requests[0].site = {
      file: "App/Features/Home/HomeScreen.swift",
      element_line: 6,
      element: 'Button("Save") {',
      kind: "Button",
      anchor_line: 8,
      anchor_text: "            } // not what is there",
      indent: "            ",
    };
    await writeFile(first.proposalPath, JSON.stringify(proposal), "utf8");
    const before = await readFile(homePath(), "utf8");

    const result = await runTestA11y(ctx(root), planId, { apply: true });

    expect(result.applied?.refused).toHaveLength(1);
    expect(result.applied?.refused[0]?.reason).toContain("changed after");
    expect(await readFile(homePath(), "utf8")).toBe(before);
  });

  it("refuses an approved entry with no site rather than guess one", async () => {
    const planId = await planned();
    const first = await runTestA11y(ctx(root), planId);
    const proposal = JSON.parse(await readFile(first.proposalPath, "utf8"));
    proposal.requests[0].approved = true;
    delete proposal.requests[0].site;
    await writeFile(first.proposalPath, JSON.stringify(proposal), "utf8");

    const result = await runTestA11y(ctx(root), planId, { apply: true });

    expect(result.applied?.written).toHaveLength(0);
    expect(result.applied?.refused[0]?.reason).toContain("no `site`");
  });

  it("keeps the unapplied entries in the proposal for a second pass", async () => {
    const planId = await planned();
    const first = await runTestA11y(ctx(root), planId);
    const before = JSON.parse(await readFile(first.proposalPath, "utf8"));

    await runTestA11y(ctx(root), planId, { apply: true });

    // Nothing was approved, so nothing was consumed — unlike a review, which is
    // deleted once merged.
    const after = JSON.parse(await readFile(first.proposalPath, "utf8"));
    expect(after.requests).toHaveLength(before.requests.length);
  });

  it("will not silently overwrite a proposal being worked on", async () => {
    const planId = await planned();
    await runTestA11y(ctx(root), planId);

    await expect(runTestA11y(ctx(root), planId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      runTestA11y(ctx(root), planId, { force: true }),
    ).resolves.toBeDefined();
  });

  it("refuses to apply a proposal that was never written", async () => {
    const planId = await planned();
    await expect(
      runTestA11y(ctx(root), planId, { apply: true }),
    ).rejects.toThrow(/No proposal to apply/);
  });

  it("requires a plan id", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await expect(runTestA11y(ctx(root), "")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
