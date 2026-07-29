import { describe, expect, it } from "vitest";
import { parseProjectModel } from "@xforge/core";
import { buildTestPlan } from "../planning/plan-builder.js";
import { defaultTestConfig } from "../config/index.js";
import {
  buildApprovalManifest,
  verifyApproval,
  assertApproval,
} from "./index.js";

function plan() {
  const model = parseProjectModel({
    project: {
      id: "app",
      name: "App",
      type: "ios-application",
      languages: ["swift"],
    },
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.8,
        entry_points: [
          { name: "AlarmView", kind: "view", file: "AlarmView.swift" },
        ],
        source_files: ["AlarmView.swift"],
        requirements: [],
        evidence: [
          { file: "AlarmView.swift", kind: "source", confidence: 0.8 },
        ],
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });
  return buildTestPlan({
    planId: "XFPLAN-20260729-001",
    model,
    config: defaultTestConfig(),
    level: "critical",
    inputs: { config_version: 1, source_commit: "abc1234" },
    environment: {
      hasUiTestTarget: true,
      hasAccessibilityIdentifiers: true,
      figmaFrameCount: 0,
      existingTestCount: 3,
    },
    createdAt: "2026-07-29T00:00:00.000Z",
  });
}

describe("approval manifest", () => {
  it("binds approval to the plan hash and records scope", () => {
    const p = plan();
    const manifest = buildApprovalManifest({ plan: p });
    expect(manifest.approved).toBe(true);
    expect(manifest.planId).toBe(p.id);
    expect(manifest.planHash).toMatch(/^sha256:/);
    expect(manifest.workers).toBe(p.shards.length);
    expect(manifest.sourceCommit).toBe("abc1234");
  });

  it("verifies a matching plan", () => {
    const p = plan();
    const manifest = buildApprovalManifest({ plan: p });
    expect(verifyApproval(p, manifest)).toEqual({ valid: true });
  });

  it("rejects a mutated (stale) plan", () => {
    const p = plan();
    const manifest = buildApprovalManifest({ plan: p });
    const mutated = { ...p, level: "full" as const };
    const check = verifyApproval(mutated, manifest);
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("plan-hash-mismatch");
  });

  it("rejects a plan-id mismatch", () => {
    const p = plan();
    const manifest = buildApprovalManifest({ plan: p });
    const other = { ...p, id: "XFPLAN-OTHER" };
    expect(verifyApproval(other, manifest).reason).toBe("plan-id-mismatch");
  });

  it("assertApproval throws on a stale plan", () => {
    const p = plan();
    const manifest = buildApprovalManifest({ plan: p });
    expect(() =>
      assertApproval({ ...p, level: "smoke" as const }, manifest),
    ).toThrow();
  });

  it("treats an unapproved manifest as invalid", () => {
    const p = plan();
    const manifest = { ...buildApprovalManifest({ plan: p }), approved: false };
    expect(verifyApproval(p, manifest).reason).toBe("not-approved");
  });
});
