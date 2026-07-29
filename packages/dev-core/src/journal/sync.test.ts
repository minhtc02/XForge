import { describe, expect, it } from "vitest";
import { recordStagedSpec } from "./staged-spec.js";
import { planSyncDocs, dismissStagedSpec } from "./sync.js";
import type { SpecDifference } from "../models/spec.js";

const diffs: SpecDifference[] = [
  {
    id: "SD-001",
    target: "maximum alarms",
    docs_value: "10",
    effective_value: "20",
    source: "user-request",
    doc_paths: ["docs/a.md"],
    status: "RECORDED",
  },
];

describe("planSyncDocs", () => {
  it("appends a sync block and marks SYNCED when no drift", () => {
    const staged = recordStagedSpec({
      runId: "R",
      differences: diffs,
      sourceDocs: { "docs/a.md": "Maximum alarms: 10\n" },
    });
    const plan = planSyncDocs({
      staged,
      currentDocs: { "docs/a.md": "Maximum alarms: 10\n" },
      now: "2026-07-29T02:00:00Z",
    });
    expect(plan.staged.status).toBe("SYNCED");
    expect(plan.driftedSkipped).toHaveLength(0);
    expect(plan.writes["docs/a.md"]).toContain("xforge:staged-spec sync");
  });

  it("skips a drifted doc and marks CONFLICTED", () => {
    const staged = recordStagedSpec({
      runId: "R",
      differences: diffs,
      sourceDocs: { "docs/a.md": "Maximum alarms: 10\n" },
    });
    const plan = planSyncDocs({
      staged,
      currentDocs: { "docs/a.md": "Maximum alarms: 15\n" },
    });
    expect(plan.staged.status).toBe("CONFLICTED");
    expect(plan.driftedSkipped).toEqual(["docs/a.md"]);
    expect(plan.writes["docs/a.md"]).toBeUndefined();
  });

  it("dismiss marks DISMISSED without touching docs", () => {
    const staged = recordStagedSpec({ runId: "R", differences: diffs });
    expect(dismissStagedSpec(staged).status).toBe("DISMISSED");
  });
});
