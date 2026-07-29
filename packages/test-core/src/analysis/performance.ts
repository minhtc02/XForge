import type { PerformanceBaseline } from "../models/bug.js";
import type { PerformanceSection } from "../config/schema.js";

/**
 * Performance regression analysis (blueprint §21). Compares measured metrics
 * against a stored baseline using configurable warning/failure percentages.
 * Simulator-only — the caller must never claim physical-device certification
 * (§21.2). Deterministic and unit-testable.
 */

export type PerfVerdict = "PASS" | "WARNING" | "REGRESSION" | "NO_BASELINE";

export interface PerfMetricResult {
  metric: string;
  baseline: number;
  measured: number;
  deltaPercent: number;
  verdict: PerfVerdict;
}

export interface PerfAnalysis {
  feature: string;
  results: PerfMetricResult[];
  worst: PerfVerdict;
}

/** Discard outliers (min+max) when enough samples exist, then take the mean. */
export function summarizeSamples(
  samples: number[],
  opts: { discardOutliers: boolean; minimumSamples: number },
): number | null {
  if (samples.length === 0) return null;
  if (samples.length < opts.minimumSamples) return null;
  let values = [...samples].sort((a, b) => a - b);
  if (opts.discardOutliers && values.length >= 3) {
    values = values.slice(1, -1);
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

const RANK: Record<PerfVerdict, number> = {
  REGRESSION: 0,
  WARNING: 1,
  PASS: 2,
  NO_BASELINE: 3,
};

/** Compare measured metrics against a baseline. Higher = slower/worse. */
export function analyzePerformance(
  feature: string,
  measured: Record<string, number>,
  baseline: PerformanceBaseline | null,
  cfg: Pick<PerformanceSection, "warning_percent" | "failure_percent">,
): PerfAnalysis {
  const results: PerfMetricResult[] = [];
  for (const [metric, value] of Object.entries(measured)) {
    const base = baseline?.metrics[metric];
    if (base === undefined || base === 0) {
      results.push({
        metric,
        baseline: base ?? 0,
        measured: value,
        deltaPercent: 0,
        verdict: "NO_BASELINE",
      });
      continue;
    }
    const deltaPercent = ((value - base) / base) * 100;
    let verdict: PerfVerdict = "PASS";
    if (deltaPercent >= cfg.failure_percent) verdict = "REGRESSION";
    else if (deltaPercent >= cfg.warning_percent) verdict = "WARNING";
    results.push({
      metric,
      baseline: base,
      measured: value,
      deltaPercent: Math.round(deltaPercent * 100) / 100,
      verdict,
    });
  }
  const worst =
    results.length === 0
      ? "NO_BASELINE"
      : results.reduce<PerfVerdict>(
          (acc, r) => (RANK[r.verdict] < RANK[acc] ? r.verdict : acc),
          "NO_BASELINE",
        );
  return { feature, results, worst };
}
