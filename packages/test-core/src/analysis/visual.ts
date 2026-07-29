import type { VisualVerdict } from "../models/enums.js";
import type { VisualSection } from "../config/schema.js";

/**
 * Visual comparison verdict logic (blueprint §12). This is the deterministic
 * decision layer: given already-computed structural/token/pixel metrics (image
 * capture + pixel diffing are the runner's job in later phases), decide a
 * verdict against the project's configurable thresholds (§12.6 — never
 * hard-coded).
 */

export interface VisualMetrics {
  /** Fraction of differing pixels after masking, 0..1. */
  pixelDifference: number;
  /** Max layout offset in points for compared elements. */
  layoutOffsetPoints: number;
  /** Max color delta (e.g. deltaE) across compared tokens. */
  colorDelta: number;
  /** Whether the design reference existed at all. */
  referencePresent: boolean;
  /** Whether the specific state was mapped. */
  stateMapped: boolean;
}

/** Decide a visual verdict from metrics + thresholds. */
export function classifyVisual(
  metrics: VisualMetrics,
  thresholds: Pick<
    VisualSection,
    | "pixel_difference_warning"
    | "pixel_difference_failure"
    | "layout_tolerance_points"
    | "color_delta_warning"
    | "color_delta_failure"
  >,
): VisualVerdict {
  if (!metrics.referencePresent) return "DESIGN_REFERENCE_MISSING";
  if (!metrics.stateMapped) return "DESIGN_STATE_UNMAPPED";

  const failure =
    metrics.pixelDifference >= thresholds.pixel_difference_failure ||
    metrics.colorDelta >= thresholds.color_delta_failure ||
    metrics.layoutOffsetPoints > thresholds.layout_tolerance_points * 3;
  if (failure) return "VISUAL_FAILURE";

  const warning =
    metrics.pixelDifference >= thresholds.pixel_difference_warning ||
    metrics.colorDelta >= thresholds.color_delta_warning ||
    metrics.layoutOffsetPoints > thresholds.layout_tolerance_points;
  if (warning) return "VISUAL_WARNING";

  return "PASS";
}

/** Whether a verdict counts as a product visual failure (for status mapping). */
export function isVisualFailure(v: VisualVerdict): boolean {
  return v === "VISUAL_FAILURE";
}
