import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@xforge/shared";
import { runInit } from "../init.js";
import { runDocs } from "../docs.js";
import { runTestPlan } from "./plan.js";
import { runTestReview } from "./review.js";
import type { CliContext } from "../../context.js";

/**
 * The end-to-end shape of the write-back path, on a project that has exactly
 * the problem it was built for: a screen nothing presents, sitting next to the
 * one the user actually sees.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

/**
 * `CategoryDetailScreen` is dead: declared, never presented. `DiscoveryHome`
 * is live, reached through the router. Both sit in the same feature folder, and
 * the dead one sorts first — which is precisely how the planner ends up taking
 * its navigation anchor from the screen nobody ships.
 */
async function scaffoldWithDeadScreen(dir: string): Promise<void> {
  await mkdir(join(dir, "App/Features/Discovery"), { recursive: true });
  await mkdir(join(dir, "AppUITests"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "App/Features/Discovery/CategoryDetailScreen.swift"),
    'import SwiftUI\nstruct CategoryDetailScreen: View {\n  var body: some View { Text("dead").accessibilityIdentifier("category-detail") }\n}\n',
  );
  await writeFile(
    join(dir, "App/Features/Discovery/DiscoveryHome.swift"),
    'import SwiftUI\nstruct DiscoveryHome: View {\n  var body: some View { Text("live").accessibilityIdentifier("discovery-home") }\n}\n',
  );
  await writeFile(
    join(dir, "App/Features/Discovery/DiscoveryRouter.swift"),
    "import SwiftUI\nstruct DiscoveryRouter {\n  func start() -> some View { DiscoveryHome() }\n}\n",
  );
  await writeFile(
    join(dir, "AppUITests/DiscoveryUITests.swift"),
    "import XCTest\nfinal class DiscoveryUITests: XCTestCase { func testLaunch() {} }\n",
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-review-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function planned(): Promise<string> {
  await scaffoldWithDeadScreen(root);
  await runInit(ctx(root), {});
  await runDocs(ctx(root), {});
  const plan = await runTestPlan(ctx(root), { level: "smoke", xcode: false });
  return plan.planId;
}

describe("dead-screen detection at plan time", () => {
  it("names the unreferenced screen and withholds approval", async () => {
    await scaffoldWithDeadScreen(root);
    await runInit(ctx(root), {});
    await runDocs(ctx(root), {});

    const result = await runTestPlan(ctx(root), {
      level: "smoke",
      xcode: false,
    });

    // The dead screen is named; the live one is not.
    expect(result.unreferencedScreens).toContain("CategoryDetailScreen");
    expect(result.unreferencedScreens).not.toContain("DiscoveryHome");

    // Approval is the thing that must not happen automatically here: a green
    // run against dead code would be evidence of nothing.
    expect(result.approved).toBe(false);
    expect(
      existsSync(
        join(root, ".xforge/test/plans", result.planId, "approval.json"),
      ),
    ).toBe(false);
  });
});

describe("xforge test review", () => {
  it("asks about the unreferenced screen and template actions", async () => {
    const planId = await planned();
    const result = await runTestReview(ctx(root), planId);

    expect(result.mode).toBe("template");
    expect(existsSync(result.reviewPath)).toBe(true);
    expect(
      result.questions.some((q) => q.includes("CategoryDetailScreen")),
    ).toBe(true);
  });

  it("pre-fills every case as keep, so a reviewer edits deltas", async () => {
    const planId = await planned();
    const result = await runTestReview(ctx(root), planId);
    const review = JSON.parse(await readFile(result.reviewPath, "utf8"));
    expect(review.cases.length).toBeGreaterThan(0);
    expect(
      review.cases.every((c: { verdict: string }) => c.verdict === "keep"),
    ).toBe(true);
    expect(review.reviewed_plan_hash).toBe(result.planHash);
  });

  it("refuses to overwrite an existing review without --force", async () => {
    const planId = await planned();
    await runTestReview(ctx(root), planId);
    await expect(runTestReview(ctx(root), planId)).rejects.toThrow(
      /already exists/,
    );
  });

  it("applies a retarget and re-hashes the plan", async () => {
    const planId = await planned();
    const template = await runTestReview(ctx(root), planId);
    const review = JSON.parse(await readFile(template.reviewPath, "utf8"));

    review.summary = "Discovery cases pointed at a dead screen.";
    review.cases[0] = {
      case_id: review.cases[0].case_id,
      verdict: "retarget",
      rationale:
        "CategoryDetailScreen is never presented; DiscoveryHome is what the router shows.",
      evidence: [
        {
          file: "App/Features/Discovery/DiscoveryRouter.swift",
          start_line: 3,
          detail: "router returns DiscoveryHome()",
        },
      ],
      new_anchor: "discovery-home",
      confidence: 0.9,
    };
    await writeFile(
      template.reviewPath,
      JSON.stringify(review, null, 2),
      "utf8",
    );

    const applied = await runTestReview(ctx(root), planId, { apply: true });

    expect(applied.mode).toBe("apply");
    expect(applied.applied?.retargeted).toHaveLength(1);
    expect(applied.planHash).not.toBe(template.planHash);

    // The verdict and its evidence live in the plan now, not a side file.
    const plan = JSON.parse(
      await readFile(
        join(root, ".xforge/test/plans", planId, "plan.json"),
        "utf8",
      ),
    );
    expect(plan.applied_reviews).toHaveLength(1);
    expect(plan.applied_reviews[0].summary).toContain("dead screen");
    expect(plan.applied_reviews[0].verdicts[0].evidence[0].file).toContain(
      "DiscoveryRouter.swift",
    );

    // The review file is consumed, so it cannot be applied twice.
    expect(existsSync(template.reviewPath)).toBe(false);
  });

  it("rejects a verdict with no evidence behind it", async () => {
    const planId = await planned();
    const template = await runTestReview(ctx(root), planId);
    const review = JSON.parse(await readFile(template.reviewPath, "utf8"));
    review.cases[0] = {
      case_id: review.cases[0].case_id,
      verdict: "drop",
      rationale: "looks dead to me",
      evidence: [],
    };
    await writeFile(
      template.reviewPath,
      JSON.stringify(review, null, 2),
      "utf8",
    );

    await expect(
      runTestReview(ctx(root), planId, { apply: true }),
    ).rejects.toThrow();
  });

  it("refuses to apply when there is no review to apply", async () => {
    const planId = await planned();
    await expect(
      runTestReview(ctx(root), planId, { apply: true }),
    ).rejects.toThrow(/No review to apply/);
  });
});

describe("xforge test review --apply --approve", () => {
  /** Fill the template with one verdict and write it back. */
  async function fillReview(
    planId: string,
    reviewPath: string,
    verdict: Record<string, unknown>,
  ): Promise<void> {
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    review.cases[0] = { case_id: review.cases[0].case_id, ...verdict };
    await writeFile(reviewPath, JSON.stringify(review, null, 2), "utf8");
  }

  it("regenerates and approves when the review answered the question", async () => {
    const planId = await planned();
    const template = await runTestReview(ctx(root), planId);
    await fillReview(planId, template.reviewPath, {
      verdict: "retarget",
      rationale: "CategoryDetailScreen is never presented.",
      evidence: [
        { file: "App/Features/Discovery/DiscoveryRouter.swift", start_line: 3 },
      ],
      new_anchor: "discovery-home",
    });

    const result = await runTestReview(ctx(root), planId, {
      apply: true,
      approve: true,
    });

    expect(result.applied?.approved).toBe(true);
    expect(result.applied?.regenerated).toBeGreaterThan(0);
    expect(
      existsSync(join(root, ".xforge/test/plans", planId, "approval.json")),
    ).toBe(true);

    // The regenerated Swift must reflect the retarget, not the old anchor —
    // approving sources that still drive at dead code would defeat the point.
    const swift = await readFile(
      join(root, ".xforge/test/generated-tests", planId, "XForgeUITests.swift"),
      "utf8",
    );
    expect(swift).toContain("discovery-home");
    expect(swift).not.toContain("category-detail");
  });

  it("refuses to approve when a flagged case was left at a bare keep", async () => {
    const planId = await planned();
    const template = await runTestReview(ctx(root), planId);
    // Template default is `keep` with no rationale — an agent that investigated
    // nothing and applied anyway.
    const result = await runTestReview(ctx(root), planId, {
      apply: true,
      approve: true,
    });

    expect(result.applied?.approved).toBe(false);
    expect(result.applied?.unresolved?.[0]).toContain("CategoryDetailScreen");
    // The merge still happened; only the approval was withheld.
    expect(
      existsSync(join(root, ".xforge/test/plans", planId, "approval.json")),
    ).toBe(false);
    expect(existsSync(template.reviewPath)).toBe(false);
  });

  it("approves a justified keep — the lexical check does miss live screens", async () => {
    const planId = await planned();
    const template = await runTestReview(ctx(root), planId);
    await fillReview(planId, template.reviewPath, {
      verdict: "keep",
      rationale: "Reached through a NavigationLink the scan cannot see.",
      evidence: [
        { file: "App/Features/Discovery/DiscoveryRouter.swift", start_line: 3 },
      ],
    });

    const result = await runTestReview(ctx(root), planId, {
      apply: true,
      approve: true,
    });
    expect(result.applied?.approved).toBe(true);
  });

  it("leaves approval alone without --approve", async () => {
    const planId = await planned();
    const template = await runTestReview(ctx(root), planId);
    await fillReview(planId, template.reviewPath, {
      verdict: "drop",
      rationale: "Dead.",
      evidence: [{ file: "App/Features/Discovery/CategoryDetailScreen.swift" }],
    });

    // Dropping the only case would empty the plan, so add one first.
    const review = JSON.parse(await readFile(template.reviewPath, "utf8"));
    review.added_cases = [
      {
        slug: "open-home",
        title: "Opening discovery shows the home screen",
        feature: "discovery",
        rationale: "This is what the router presents.",
        evidence: [
          {
            file: "App/Features/Discovery/DiscoveryRouter.swift",
            start_line: 3,
          },
        ],
        steps: [{ id: "step-1", action: "launch-app" }],
        expected_results: ["Home is visible"],
        assertions: [
          { id: "assert-1", kind: "screen-is", target: "discovery-home" },
        ],
      },
    ];
    await writeFile(
      template.reviewPath,
      JSON.stringify(review, null, 2),
      "utf8",
    );

    const result = await runTestReview(ctx(root), planId, { apply: true });
    expect(result.applied?.approved).toBeUndefined();
    expect(
      existsSync(join(root, ".xforge/test/plans", planId, "approval.json")),
    ).toBe(false);
  });
});
