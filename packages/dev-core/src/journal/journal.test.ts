import { describe, expect, it } from "vitest";
import {
  detectDrift,
  parseStagedSpec,
  recordStagedSpec,
  renderStagedSpecMarkdown,
  transitionStagedSpec,
} from "./staged-spec.js";
import type { SpecDifference } from "../models/spec.js";

const diffs: SpecDifference[] = [
  {
    id: "SD-001",
    target: "maximum alarms",
    docs_value: "10",
    effective_value: "20",
    source: "user-request",
    doc_paths: ["docs/project/features/alarm.md"],
    status: "RECORDED",
  },
];

describe("recordStagedSpec", () => {
  it("records differences, hashes source docs, and proposes patches", () => {
    const staged = recordStagedSpec({
      runId: "XFDEVRUN-1",
      differences: diffs,
      sourceDocs: { "docs/project/features/alarm.md": "Maximum alarms: 10\n" },
      recordedAt: "2026-07-29T00:00:00Z",
    });
    expect(staged.status).toBe("RECORDED");
    expect(staged.differences).toHaveLength(1);
    expect(Object.keys(staged.source_doc_hashes)).toContain(
      "docs/project/features/alarm.md",
    );
    expect(staged.proposed_patches[0]!.patch).toContain("10 → 20");
  });

  it("is a journal, not a gate — records even with zero differences", () => {
    const staged = recordStagedSpec({ runId: "R", differences: [] });
    expect(staged.status).toBe("RECORDED");
    expect(staged.differences).toHaveLength(0);
  });

  it("round-trips through parseStagedSpec", () => {
    const staged = recordStagedSpec({ runId: "R", differences: diffs });
    expect(parseStagedSpec(JSON.parse(JSON.stringify(staged)))).toEqual(staged);
  });
});

describe("detectDrift", () => {
  it("flags a source doc that changed since recording", () => {
    const staged = recordStagedSpec({
      runId: "R",
      differences: diffs,
      sourceDocs: { "docs/a.md": "Maximum alarms: 10\n" },
    });
    expect(
      detectDrift(staged, { "docs/a.md": "Maximum alarms: 10\n" }),
    ).toHaveLength(0);
    expect(
      detectDrift(staged, { "docs/a.md": "Maximum alarms: 15\n" }),
    ).toEqual(["docs/a.md"]);
  });
});

describe("transitionStagedSpec", () => {
  it("sets SYNCED with a timestamp and DISMISSED without", () => {
    const staged = recordStagedSpec({ runId: "R", differences: diffs });
    const synced = transitionStagedSpec(
      staged,
      "SYNCED",
      "2026-07-29T01:00:00Z",
    );
    expect(synced.status).toBe("SYNCED");
    expect(synced.synced_at).toBe("2026-07-29T01:00:00Z");
    const dismissed = transitionStagedSpec(staged, "DISMISSED");
    expect(dismissed.status).toBe("DISMISSED");
  });
});

describe("renderStagedSpecMarkdown", () => {
  it("states clearly it is a journal not a gate", () => {
    const md = renderStagedSpecMarkdown(
      recordStagedSpec({ runId: "R", differences: diffs }),
    );
    expect(md).toContain("change journal, not a code gate");
    expect(md).toContain("maximum alarms");
  });
});
