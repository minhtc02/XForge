import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  classifyVisual,
  compareScreenshots,
  visualBaselinePath,
  visualDiffPath,
  type TestConfig,
  type TestPlan,
  type VisualEscalation,
  type VisualVerdict,
} from "@xforge/test-core";

/**
 * Pixel comparison against approved baselines (blueprint §12).
 *
 * This is regression testing — "did the screen change since we last approved
 * it?" — and it complements design conformance, which asks "does the screen
 * match the design?". They fail differently and are worth keeping apart: a
 * conformance finding names a measurement, a pixel diff names a percentage.
 *
 * Two decisions shape this:
 *
 *  - **A missing baseline never passes silently.** Auto-approving whatever the
 *    app looks like on first run would bless the bugs already in it. So a
 *    screenshot with no baseline is reported as `DESIGN_REFERENCE_MISSING` and
 *    the user accepts it explicitly with `--update-baselines`.
 *  - **Baselines are per shard.** The same case runs on every device its types
 *    call for, and a 393pt screen never matches a 375pt baseline. Comparing
 *    across devices would fail every run for the wrong reason.
 */

export interface VisualCheckInput {
  projectRoot: string;
  plan: TestPlan;
  config: TestConfig;
  runId: string;
  /** Screenshot paths exported from the result bundles. */
  screenshots: string[];
  /** Accept the current screenshots as the new baselines. */
  updateBaselines?: boolean;
}

export interface VisualComparison {
  caseId: string;
  shardId: string;
  name: string;
  verdict: VisualVerdict;
  pixelDifference: number;
  diffPath?: string;
  baselinePath: string;
}

export interface VisualCheckResult {
  comparisons: VisualComparison[];
  escalations: VisualEscalation[];
  /** Baselines written because `--update-baselines` was passed. */
  baselinesWritten: string[];
  /** Screenshots with no baseline to compare against. */
  missingBaselines: string[];
  markdown: string;
}

export async function runVisualCheck(
  input: VisualCheckInput,
): Promise<VisualCheckResult> {
  const result: VisualCheckResult = {
    comparisons: [],
    escalations: [],
    baselinesWritten: [],
    missingBaselines: [],
    markdown: "",
  };
  if (!input.config.visual.enabled || input.screenshots.length === 0) {
    return result;
  }

  const featureForCase = new Map(
    input.plan.test_cases.map((c) => [c.id, c.feature]),
  );
  const thresholds = input.config.visual;

  for (const shot of input.screenshots) {
    const parts = parseScreenshotPath(shot);
    if (!parts) continue;
    const feature = featureForCase.get(parts.caseId) ?? "unknown";

    const baselinePath = visualBaselinePath(
      input.projectRoot,
      feature,
      parts.shardId,
      parts.name,
    );

    if (input.updateBaselines) {
      await mkdir(dirname(baselinePath), { recursive: true });
      await copyFile(shot, baselinePath);
      result.baselinesWritten.push(baselinePath);
      continue;
    }

    const baseline = existsSync(baselinePath)
      ? await readFile(baselinePath)
      : null;
    if (!baseline) result.missingBaselines.push(shot);

    const comparison = compareScreenshots({
      actual: await readFile(shot),
      baseline,
      threshold: thresholds.pixel_difference_warning,
    });
    const verdict = classifyVisual(comparison.metrics, thresholds);

    let diffPath: string | undefined;
    if (comparison.diff && verdict !== "PASS") {
      diffPath = visualDiffPath(
        input.projectRoot,
        input.config.output.runs_root,
        input.runId,
        parts.caseId,
        parts.shardId,
        parts.name,
      );
      await mkdir(dirname(diffPath), { recursive: true });
      await writeFile(diffPath, comparison.diff);
    }

    result.comparisons.push({
      caseId: parts.caseId,
      shardId: parts.shardId,
      name: parts.name,
      verdict,
      pixelDifference: comparison.metrics.pixelDifference,
      ...(diffPath ? { diffPath } : {}),
      baselinePath,
    });

    // Only a real difference escalates. A missing or unmapped reference means
    // there was nothing to compare — reported, never failed.
    if (verdict === "VISUAL_FAILURE") {
      result.escalations.push({
        case_id: parts.caseId,
        verdict,
        source: "visual-agent",
        message:
          `${parts.name} differs from its baseline by ` +
          `${(comparison.metrics.pixelDifference * 100).toFixed(1)}% on ${parts.shardId}` +
          (comparison.error ? ` (${comparison.error})` : ""),
        evidence: [
          { kind: "screenshot", path: shot },
          ...(diffPath
            ? [{ kind: "visual-diff" as const, path: diffPath }]
            : []),
        ],
      });
    }
  }

  result.markdown = renderVisualMarkdown(input.projectRoot, result);
  return result;
}

/** `…/screens/<case-id>/<shard-id>/<name>.png` */
function parseScreenshotPath(
  path: string,
): { caseId: string; shardId: string; name: string } | undefined {
  const segments = path.split("/");
  const name = basename(path).replace(/\.png$/i, "");
  const shardId = segments[segments.length - 2];
  const caseId = segments[segments.length - 3];
  if (!shardId || !caseId) return undefined;
  return { caseId, shardId, name };
}

function renderVisualMarkdown(
  projectRoot: string,
  result: VisualCheckResult,
): string {
  if (result.baselinesWritten.length > 0) {
    return [
      "## Visual baselines",
      "",
      `Accepted ${result.baselinesWritten.length} screenshot(s) as the new baseline.`,
      "",
    ].join("\n");
  }
  if (result.comparisons.length === 0) return "";

  const lines = ["## Visual comparison", ""];
  const changed = result.comparisons.filter((c) => c.verdict !== "PASS");
  if (changed.length === 0) {
    lines.push(
      `All ${result.comparisons.length} screenshot(s) match their baseline.`,
      "",
    );
    return lines.join("\n");
  }

  for (const c of changed) {
    const percent = `${(c.pixelDifference * 100).toFixed(1)}%`;
    const marker = c.verdict === "VISUAL_FAILURE" ? "**FAIL**" : "warn";
    lines.push(
      `- ${marker} \`${c.caseId}\` / \`${c.shardId}\` — ${c.name}: ${c.verdict}` +
        (c.verdict === "DESIGN_REFERENCE_MISSING" ? "" : ` (${percent})`) +
        (c.diffPath
          ? `\n  diff: \`${relative(projectRoot, c.diffPath)}\``
          : ""),
    );
  }
  lines.push("");

  if (result.missingBaselines.length > 0) {
    lines.push(
      `_${result.missingBaselines.length} screenshot(s) have no baseline yet._`,
      "_Review them, then accept with `xforge test run <plan-id> --execute --update-baselines`._",
      "",
    );
  }
  return lines.join("\n");
}

/** Every PNG under a screens directory, for callers that did not track them. */
export async function collectScreenshots(
  screensDir: string,
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.png$/i.test(entry.name)) out.push(full);
    }
  };
  await walk(screensDir);
  return out.sort();
}
