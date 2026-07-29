import { describe, expect, it } from "vitest";
import { DryRunCommandRunner } from "./runner.js";
import { scheduleGroups, resolveMaxParallel } from "./scheduler.js";
import { createWorktrees, removeWorktrees } from "../worktree/manager.js";
import { integrateBranches } from "./integration.js";
import { reviewChanges, collectAllowedFiles } from "./static-review.js";
import { orchestrateRun, makeDevRunId } from "./orchestrator.js";
import { evaluateAutoPolicy } from "./auto-policy.js";
import { runGate } from "./quality-gates.js";
import type { ImplementationGroup, DevPlan } from "../models/plan.js";
import type { DevConfig } from "../config/schema.js";
import { defaultDevConfig } from "../config/index.js";
import type { Worktree } from "../models/plan.js";

const ctx = {
  projectRoot: "/repo",
  worktreeRootRel: ".xforge/worktrees",
  runner: new DryRunCommandRunner(),
};

function group(
  id: string,
  depends_on: string[] = [],
  shares_files = false,
): ImplementationGroup {
  return { id, name: id, depends_on, tasks: [], shares_files };
}

describe("scheduleGroups", () => {
  it("orders groups into dependency-aware waves", () => {
    const s = scheduleGroups([
      group("domain"),
      group("ui", ["domain"]),
      group("persistence", ["domain"]),
    ]);
    expect(s.cycles).toHaveLength(0);
    expect(s.waves[0]!.map((g) => g.id)).toEqual(["domain"]);
    expect(s.waves[1]!.map((g) => g.id).sort()).toEqual(["persistence", "ui"]);
  });

  it("detects a dependency cycle", () => {
    const s = scheduleGroups([group("a", ["b"]), group("b", ["a"])]);
    expect(s.cycles.sort()).toEqual(["a", "b"]);
  });

  it("serialises file-sharing groups into separate waves", () => {
    const s = scheduleGroups([
      group("a", [], true),
      group("b", [], true),
      group("c", [], false),
    ]);
    // Only one file-sharer per wave; c (non-sharer) rides along.
    expect(s.waves[0]!.filter((g) => g.shares_files)).toHaveLength(1);
    expect(
      s.waves
        .flat()
        .map((g) => g.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("resolveMaxParallel honours auto and caps", () => {
    expect(resolveMaxParallel("auto", 4)).toBe(4);
    expect(resolveMaxParallel(2, 5)).toBe(2);
    expect(resolveMaxParallel(9, 3)).toBe(3);
  });
});

describe("worktree manager", () => {
  const safe: Worktree = {
    id: "wt-ui",
    path: ".xforge/worktrees/XFDEV-1/ui",
    branch: "xforge/dev/XFDEV-1/ui",
    base: "main",
    group_id: "ui",
    is_integration: false,
  };
  const unsafe: Worktree = { ...safe, path: "Sources/Alarm", id: "wt-bad" };

  it("emits a git worktree add spec for a safe worktree", async () => {
    const runner = new DryRunCommandRunner();
    const res = await createWorktrees({ ...ctx, runner }, [safe]);
    expect(res[0]!.safe).toBe(true);
    expect(runner.recorded[0]!.args.slice(0, 3)).toEqual([
      "worktree",
      "add",
      "-b",
    ]);
  });

  it("refuses (never runs) an unsafe worktree path", async () => {
    const runner = new DryRunCommandRunner();
    const res = await createWorktrees({ ...ctx, runner }, [unsafe]);
    expect(res[0]!.safe).toBe(false);
    expect(runner.recorded).toHaveLength(0);
  });

  it("never deletes the worktree root itself", async () => {
    const runner = new DryRunCommandRunner();
    const root: Worktree = {
      ...safe,
      path: ".xforge/worktrees",
      id: "wt-root",
    };
    const res = await removeWorktrees({ ...ctx, runner }, [root]);
    expect(res[0]!.safe).toBe(false);
    expect(runner.recorded).toHaveLength(0);
  });
});

describe("integrateBranches", () => {
  const integration: Worktree = {
    id: "wt-integration",
    path: ".xforge/worktrees/XFDEV-1/integration",
    branch: "xforge/dev/XFDEV-1/integration",
    base: "main",
    is_integration: true,
  };

  it("dry run records merges but merges nothing", async () => {
    const runner = new DryRunCommandRunner();
    const out = await integrateBranches({
      integration,
      featureBranches: ["xforge/dev/XFDEV-1/ui"],
      runner,
      dryRun: true,
      projectRoot: "/repo",
    });
    expect(out.merged_branches).toHaveLength(0);
    expect(runner.recorded[0]!.args[0]).toBe("merge");
  });

  it("skips an invalid/main branch without merging", async () => {
    const runner = new DryRunCommandRunner();
    const out = await integrateBranches({
      integration,
      featureBranches: ["main"],
      runner,
      dryRun: false,
      projectRoot: "/repo",
    });
    expect(out.merged_branches).toHaveLength(0);
    expect(out.merges[0]!.skippedReason).toBe("invalid-branch");
    expect(runner.recorded).toHaveLength(0);
  });
});

describe("static review", () => {
  const groups: ImplementationGroup[] = [
    {
      id: "ui",
      name: "UI",
      depends_on: [],
      shares_files: false,
      tasks: [
        {
          id: "t1",
          description: "edit view",
          requirement_ids: [],
          status: "PLANNED",
          file_scope: [{ path: "Sources/AlarmView.swift", mode: "modify" }],
        },
      ],
    },
  ];

  it("passes an in-scope, secret-free change", () => {
    const r = reviewChanges({
      changedFiles: [
        { path: "Sources/AlarmView.swift", contents: "let x = 1" },
      ],
      groups,
      allowedFiles: collectAllowedFiles(groups),
    });
    expect(r.passed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it("blocks an out-of-scope write", () => {
    const r = reviewChanges({
      changedFiles: [{ path: "Sources/Other.swift" }],
      groups,
      allowedFiles: collectAllowedFiles(groups),
    });
    expect(r.passed).toBe(false);
    expect(r.findings[0]!.category).toBe("scope");
  });

  it("blocks a forbidden path and a leaked secret", () => {
    const r = reviewChanges({
      changedFiles: [
        {
          path: "Sources/AlarmView.swift",
          contents: 'apiKey = "SECRETVALUE123"',
        },
        { path: ".env", contents: "x" },
      ],
      groups,
      allowedFiles: [],
    });
    expect(r.passed).toBe(false);
    const cats = r.findings.map((f) => f.category);
    expect(cats).toContain("security");
  });
});

function fixturePlan(): DevPlan {
  return {
    schema_version: 1,
    id: "XFDEVPLAN-20260729-001",
    project_id: "app",
    created_at: "2026-07-29T00:00:00Z",
    mode: "plan-first",
    feature: "alarm",
    change_id: "XFDEV-1-alarm",
    effective_spec: {
      schema_version: 1,
      feature: "alarm",
      requirements: [],
      overrides: [],
      differences: [],
      source_docs: [],
      confidence: 0.7,
    },
    impact: {
      affected_files: [],
      affected_features: [],
      regression_risk: "low",
      merge_conflict_risk: "low",
      notes: [],
    },
    groups: [group("domain")],
    worktrees: [
      {
        id: "wt-domain",
        path: ".xforge/worktrees/XFDEV-1-alarm/domain",
        branch: "xforge/dev/XFDEV-1-alarm/domain",
        base: "main",
        group_id: "domain",
        is_integration: false,
      },
      {
        id: "wt-integration",
        path: ".xforge/worktrees/XFDEV-1-alarm/integration",
        branch: "xforge/dev/XFDEV-1-alarm/integration",
        base: "main",
        is_integration: true,
      },
    ],
    integration_branch: "xforge/dev/XFDEV-1-alarm/integration",
    permissions: {
      allowed: {
        readRepository: true,
        createWorktrees: true,
        writeWorktrees: true,
        readFigma: false,
        readProvidedImages: false,
        createSourceFiles: true,
        modifySourceFiles: true,
        createTestSourceFiles: true,
        commitFeatureBranches: true,
        mergeIntoIntegrationBranch: true,
      },
      optional: {
        runBuild: false,
        runTests: false,
        runSimulator: false,
        runUIVerification: false,
        runPerformanceVerification: false,
      },
      denied: {
        modifyMainCheckout: true,
        mergeIntoMain: true,
        forcePush: true,
        modifySigning: true,
        accessProduction: true,
        publishBuild: true,
      },
    },
    optional_actions: {
      build: "NOT_REQUESTED",
      test: "NOT_REQUESTED",
      ui_verification: "NOT_REQUESTED",
      performance: "NOT_REQUESTED",
      docs_sync: "NOT_REQUIRED",
    },
    requires_approval: [],
    inputs: { base_branch: "main", config_version: 1 },
    confidence: 0.7,
  };
}

describe("orchestrateRun", () => {
  const config: DevConfig = defaultDevConfig();

  it("dry run creates nothing and reports PLANNED with NOT_REQUESTED gates", async () => {
    const runner = new DryRunCommandRunner();
    const run = await orchestrateRun({
      plan: fixturePlan(),
      config,
      runId: "XFDEVRUN-20260729-001",
      runner,
      dryRun: true,
      projectRoot: "/repo",
      now: () => new Date("2026-07-29T00:00:00Z"),
    });
    expect(run.status).toBe("PLANNED");
    expect(run.optional_results.build).toBe("NOT_REQUESTED");
    expect(run.optional_results.test).toBe("NOT_REQUESTED");
    expect(run.optional_results.ui).toBe("NOT_REQUESTED");
    expect(run.optional_results.performance).toBe("NOT_REQUESTED");
    expect(run.docs_sync).toBe("NOT_REQUIRED");
    expect(run.changes).toHaveLength(0);
  });

  it("live run with a clean implementer reaches CODE_COMPLETED", async () => {
    const runner = new DryRunCommandRunner();
    const run = await orchestrateRun({
      plan: fixturePlan(),
      config,
      runId: "XFDEVRUN-20260729-002",
      runner,
      dryRun: false,
      projectRoot: "/repo",
      implementGroup: async () => ({
        changes: [
          {
            file: ".xforge/worktrees/x",
            change: "modified",
            additions: 1,
            deletions: 0,
          },
        ],
        commits: [
          { branch: "xforge/dev/XFDEV-1-alarm/domain", message: "impl" },
        ],
        reviewed: [],
      }),
      now: () => new Date("2026-07-29T00:00:00Z"),
    });
    expect(run.status).toBe("CODE_COMPLETED");
    // Still no optional verification.
    expect(run.optional_results.test).toBe("NOT_REQUESTED");
  });

  it("makeDevRunId formats the id", () => {
    expect(makeDevRunId(new Date("2026-07-29T00:00:00Z"), 1)).toBe(
      "XFDEVRUN-20260729-001",
    );
  });
});

describe("evaluateAutoPolicy", () => {
  const config = defaultDevConfig();
  it("allows an implement-only, nothing-denied plan", () => {
    expect(evaluateAutoPolicy(fixturePlan(), config).allowed).toBe(true);
  });
  it("blocks a plan that requests build or re-approval", () => {
    const p = fixturePlan();
    p.optional_actions.build = "PENDING";
    p.requires_approval = ["add-dependency"];
    const r = evaluateAutoPolicy(p, config);
    expect(r.allowed).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("runGate", () => {
  it("build gate dry run records the spec but does not execute", async () => {
    const runner = new DryRunCommandRunner();
    const out = await runGate({
      kind: "build",
      plan: fixturePlan(),
      runner,
      dryRun: true,
      projectRoot: "/repo",
      worktreePath: ".xforge/worktrees/XFDEV-1-alarm/integration",
    });
    expect(out.executed).toBe(false);
    expect(out.spec.command).toBe("xcodebuild");
  });

  it("ui-check gate hands off to XForge Test", async () => {
    const runner = new DryRunCommandRunner();
    const out = await runGate({
      kind: "ui-check",
      plan: fixturePlan(),
      runner,
      dryRun: true,
      projectRoot: "/repo",
      worktreePath: ".xforge/worktrees/XFDEV-1-alarm/integration",
    });
    expect(out.handoff).toBe("XForge Test");
    expect(out.spec.args).toContain("--dev-run");
  });
});
