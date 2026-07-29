import { describe, expect, it } from "vitest";
import { parseProjectModel, type ProjectModel } from "@xforge/core";
import { buildDevPlan, makeChangeId, makeDevPlanId } from "./plan-builder.js";
import { hashDevPlan, devPlanMatchesHash } from "./hash.js";
import { defaultDevConfig } from "../config/index.js";
import { resolveEffectiveSpec } from "../spec/effective-spec.js";

function model(): ProjectModel {
  return parseProjectModel({
    project: {
      id: "cuckoo",
      name: "Cuckoo",
      type: "ios-application",
      languages: ["swift"],
    },
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.9,
        entry_points: [
          { name: "AlarmView", kind: "view", file: "AlarmView.swift" },
        ],
        source_files: [
          "AlarmView.swift",
          "AlarmScheduler.swift",
          "AlarmRepository.swift",
        ],
        requirements: ["PRD-ALARM-001"],
        evidence: [
          { file: "AlarmView.swift", kind: "source", confidence: 0.9 },
        ],
      },
    ],
    requirements: [
      {
        id: "PRD-ALARM-001",
        description: "User can create alarms",
        source_type: "prd",
        implementation_status: "IMPLEMENTED",
        confidence: 0.6,
        feature: "alarm",
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
}

function build(request?: string) {
  const m = model();
  const spec = resolveEffectiveSpec({ feature: "alarm", model: m, request });
  return buildDevPlan({
    planId: "XFDEVPLAN-1",
    changeId: "XFDEV-001-alarm",
    model: m,
    config: defaultDevConfig(),
    effectiveSpec: spec,
    feature: "alarm",
    inputs: { base_branch: "main", config_version: 1 },
    createdAt: "2026-07-29T00:00:00Z",
  });
}

describe("buildDevPlan", () => {
  it("builds groups from file roles and plans worktrees + integration branch", () => {
    const plan = build();
    expect(plan.groups.length).toBeGreaterThan(0);
    // domain (scheduler) + persistence (repository) + ui (view) expected.
    expect(plan.groups.map((g) => g.id).sort()).toEqual([
      "domain",
      "persistence",
      "ui",
    ]);
    expect(plan.integration_branch).toBe(
      "xforge/dev/XFDEV-001-alarm/integration",
    );
    expect(plan.worktrees.some((w) => w.is_integration)).toBe(true);
  });

  it("ALWAYS defaults build/test/UI/performance to NOT_REQUESTED and docs to NOT_REQUIRED", () => {
    const plan = build();
    expect(plan.optional_actions.build).toBe("NOT_REQUESTED");
    expect(plan.optional_actions.test).toBe("NOT_REQUESTED");
    expect(plan.optional_actions.ui_verification).toBe("NOT_REQUESTED");
    expect(plan.optional_actions.performance).toBe("NOT_REQUESTED");
    expect(plan.optional_actions.docs_sync).toBe("NOT_REQUIRED");
  });

  it("permission manifest keeps all optional verification actions false", () => {
    const plan = build();
    expect(plan.permissions.optional.runBuild).toBe(false);
    expect(plan.permissions.optional.runTests).toBe(false);
    expect(plan.permissions.optional.runSimulator).toBe(false);
    expect(plan.permissions.optional.runUIVerification).toBe(false);
    expect(plan.permissions.optional.runPerformanceVerification).toBe(false);
  });

  it("denies main-checkout mutation, merge-to-main and force-push", () => {
    const plan = build();
    expect(plan.permissions.denied.modifyMainCheckout).toBe(true);
    expect(plan.permissions.denied.mergeIntoMain).toBe(true);
    expect(plan.permissions.denied.forcePush).toBe(true);
  });

  it("records requirement traceability into groups", () => {
    const plan = build();
    const uiGroup = plan.groups.find((g) => g.id === "ui")!;
    expect(uiGroup.tasks[0]!.requirement_ids).toContain("PRD-ALARM-001");
  });

  it("throws for an unknown feature", () => {
    const m = model();
    const spec = resolveEffectiveSpec({ feature: "ghost", model: m });
    expect(() =>
      buildDevPlan({
        planId: "P",
        changeId: "C",
        model: m,
        config: defaultDevConfig(),
        effectiveSpec: spec,
        feature: "ghost",
        inputs: { base_branch: "main", config_version: 1 },
      }),
    ).toThrow(/not found/);
  });
});

describe("hashDevPlan", () => {
  it("is stable and ignores created_at", () => {
    const a = build();
    const b = { ...structuredClone(a), created_at: "2099-01-01T00:00:00Z" };
    expect(hashDevPlan(a)).toBe(hashDevPlan(b));
    expect(devPlanMatchesHash(b, hashDevPlan(a))).toBe(true);
  });
  it("changes when a requested override changes behavior", () => {
    const a = build();
    const b = build("change maximum alarms to 20");
    expect(hashDevPlan(a)).not.toBe(hashDevPlan(b));
  });
});

describe("id helpers", () => {
  it("formats plan + change ids", () => {
    expect(makeDevPlanId(new Date("2026-07-29T00:00:00Z"), 1)).toBe(
      "XFDEVPLAN-20260729-001",
    );
    expect(makeChangeId("Habit Alarm", 2)).toBe("XFDEV-002-habit-alarm");
  });
});
