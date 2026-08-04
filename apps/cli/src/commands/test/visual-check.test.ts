import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  defaultTestConfig,
  parseTestPlan,
  visualBaselinePath,
  type TestPlan,
} from "@xforge/test-core";
import { runVisualCheck } from "./visual-check.js";

/**
 * Two properties matter more than the diffing itself, which is already tested:
 * a missing baseline must not silently pass, and baselines must be per device —
 * a 393pt screen can never match a 375pt baseline.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-visual-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function png(
  width: number,
  height: number,
  color: [number, number, number],
  block?: { w: number; h: number },
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const inBlock = block && x < block.w && y < block.h;
      const [r, g, b] = inBlock ? [255, 0, 0] : color;
      image.data[idx] = r;
      image.data[idx + 1] = g;
      image.data[idx + 2] = b;
      image.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const WHITE: [number, number, number] = [255, 255, 255];

function plan(): TestPlan {
  return parseTestPlan({
    id: "XFPLAN-1",
    project_id: "cuckoo",
    created_at: "2026-01-01T00:00:00.000Z",
    level: "regression",
    test_cases: [
      {
        id: "TC-ALARM-003",
        title: "Alarm visual",
        feature: "alarm",
        types: ["visual"],
        priority: "P1",
        risk_score: 5,
        automation: { framework: "xcuitest", blocked: false },
      },
    ],
    permissions: {},
    estimated_duration: { min_minutes: 1, max_minutes: 2 },
    stats: { total_cases: 1, suites: 1, shards: 2, by_type: {} },
    inputs: { config_version: 1 },
  });
}

/** Write a screenshot at the layout the exporter produces. */
async function shot(
  shardId: string,
  bytes: Buffer,
  name = "alarm-list",
): Promise<string> {
  const path = join(
    root,
    "qa-runs/XFRUN-1/artifacts/screens/TC-ALARM-003",
    shardId,
    `${name}.png`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

async function baseline(shardId: string, bytes: Buffer): Promise<void> {
  const path = visualBaselinePath(root, "alarm", shardId, "alarm-list");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

const base = { projectRoot: "", plan: plan(), runId: "XFRUN-1" };

describe("runVisualCheck", () => {
  it("passes a screenshot identical to its baseline", async () => {
    const image = png(20, 20, WHITE);
    await baseline("shard-alarm-iphone-se", image);
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [await shot("shard-alarm-iphone-se", image)],
    });
    expect(result.comparisons[0]?.verdict).toBe("PASS");
    expect(result.escalations).toEqual([]);
  });

  it("fails and writes a diff when the screen changed", async () => {
    await baseline("shard-alarm-iphone-se", png(20, 20, WHITE));
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [
        await shot("shard-alarm-iphone-se", png(20, 20, WHITE, { w: 8, h: 8 })),
      ],
    });
    expect(result.comparisons[0]?.verdict).toBe("VISUAL_FAILURE");
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.source).toBe("visual-agent");
    expect(result.escalations[0]?.message).toContain("shard-alarm-iphone-se");
    const diff = result.comparisons[0]?.diffPath;
    expect(diff && existsSync(diff)).toBe(true);
  });

  it("reports a missing baseline instead of passing silently", async () => {
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [await shot("shard-alarm-iphone-se", png(20, 20, WHITE))],
    });
    // Auto-approving the first run would bless whatever bugs are already there.
    expect(result.comparisons[0]?.verdict).toBe("DESIGN_REFERENCE_MISSING");
    expect(result.escalations).toEqual([]);
    expect(result.missingBaselines).toHaveLength(1);
    expect(result.markdown).toContain("--update-baselines");
  });

  it("accepts baselines only when explicitly asked", async () => {
    const image = png(20, 20, WHITE);
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [await shot("shard-alarm-iphone-se", image)],
      updateBaselines: true,
    });
    expect(result.baselinesWritten).toHaveLength(1);
    expect(result.comparisons).toEqual([]);
    expect(
      existsSync(
        visualBaselinePath(
          root,
          "alarm",
          "shard-alarm-iphone-se",
          "alarm-list",
        ),
      ),
    ).toBe(true);
  });

  it("keeps baselines per shard, so devices never cross-compare", async () => {
    // A 375pt baseline must not be compared against a 393pt capture.
    await baseline("shard-alarm-iphone-se", png(375, 100, WHITE));
    await baseline("shard-alarm-iphone-15-pro", png(393, 100, WHITE));

    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [
        await shot("shard-alarm-iphone-se", png(375, 100, WHITE)),
        await shot("shard-alarm-iphone-15-pro", png(393, 100, WHITE)),
      ],
    });
    expect(result.comparisons.map((c) => c.verdict)).toEqual(["PASS", "PASS"]);
  });

  it("fails a size mismatch rather than reporting it as a pass", async () => {
    await baseline("shard-alarm-iphone-se", png(375, 100, WHITE));
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [await shot("shard-alarm-iphone-se", png(393, 100, WHITE))],
    });
    expect(result.comparisons[0]?.verdict).toBe("VISUAL_FAILURE");
  });

  it("does nothing when visual checking is disabled", async () => {
    const config = defaultTestConfig();
    config.visual.enabled = false;
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config,
      screenshots: [await shot("shard-alarm-iphone-se", png(20, 20, WHITE))],
    });
    expect(result.comparisons).toEqual([]);
  });

  it("says so when every screenshot matches", async () => {
    const image = png(20, 20, WHITE);
    await baseline("shard-alarm-iphone-se", image);
    const result = await runVisualCheck({
      ...base,
      projectRoot: root,
      config: defaultTestConfig(),
      screenshots: [await shot("shard-alarm-iphone-se", image)],
    });
    expect(result.markdown).toContain("match their baseline");
  });
});
