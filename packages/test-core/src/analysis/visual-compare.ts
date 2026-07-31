import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { VisualMetrics } from "./visual.js";

/**
 * Pixel comparison that feeds {@link VisualMetrics} to the existing
 * {@link classifyVisual} decision layer (blueprint §12, optimization Phase 5).
 *
 * Until now `classifyVisual` had no producer — the verdict logic existed but
 * nothing computed the numbers, so the visual loop was open. This closes it.
 *
 * Both dependencies are pure JavaScript (`pngjs` decodes, `pixelmatch` diffs),
 * so they bundle into the single-file CLI. `sharp` was deliberately not used:
 * it is a native binding, cannot be bundled, and XCUITest screenshots are
 * already PNG, so nothing needs resizing or format conversion.
 */

export interface ComparisonInput {
  /** Raw PNG bytes of the captured screenshot. */
  actual: Buffer | Uint8Array;
  /** Raw PNG bytes of the approved baseline. */
  baseline?: Buffer | Uint8Array | null;
  /** Whether the design state was mapped at all (§12.5). */
  stateMapped?: boolean;
  /** Per-pixel colour distance below which pixels count as identical, 0..1. */
  threshold?: number;
  /** Regions to ignore (clocks, avatars, anything nondeterministic). */
  masks?: MaskRect[];
}

/** A rectangle excluded from comparison, in pixels. */
export interface MaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComparisonResult {
  metrics: VisualMetrics;
  /** Diff image as PNG bytes, when a comparison actually ran. */
  diff?: Buffer;
  /** Set when the images could not be compared at all. */
  error?: "size-mismatch" | "decode-failed" | "no-baseline";
  dimensions?: { width: number; height: number };
  /** Number of differing pixels after masking. */
  differingPixels?: number;
}

const DEFAULT_THRESHOLD = 0.1;

/**
 * Compare a screenshot against its baseline.
 *
 * Every failure mode produces metrics that route to an explicit verdict rather
 * than a silent pass: a missing baseline yields `referencePresent: false`
 * (→ `DESIGN_REFERENCE_MISSING`), and a size mismatch yields a 100% difference
 * (→ `VISUAL_FAILURE`), because differently-sized screens genuinely do not
 * match.
 */
export function compareScreenshots(input: ComparisonInput): ComparisonResult {
  const stateMapped = input.stateMapped ?? true;

  if (!input.baseline) {
    return {
      error: "no-baseline",
      metrics: {
        pixelDifference: 0,
        layoutOffsetPoints: 0,
        colorDelta: 0,
        referencePresent: false,
        stateMapped,
      },
    };
  }

  let actualPng: PNG;
  let baselinePng: PNG;
  try {
    actualPng = PNG.sync.read(Buffer.from(input.actual));
    baselinePng = PNG.sync.read(Buffer.from(input.baseline));
  } catch {
    return {
      error: "decode-failed",
      metrics: {
        pixelDifference: 0,
        layoutOffsetPoints: 0,
        colorDelta: 0,
        referencePresent: false,
        stateMapped,
      },
    };
  }

  if (
    actualPng.width !== baselinePng.width ||
    actualPng.height !== baselinePng.height
  ) {
    return {
      error: "size-mismatch",
      dimensions: { width: actualPng.width, height: actualPng.height },
      metrics: {
        pixelDifference: 1,
        layoutOffsetPoints: Math.abs(actualPng.height - baselinePng.height),
        colorDelta: 0,
        referencePresent: true,
        stateMapped,
      },
    };
  }

  const { width, height } = actualPng;
  const actualData = applyMasks(actualPng, input.masks ?? []);
  const baselineData = applyMasks(baselinePng, input.masks ?? []);
  const diff = new PNG({ width, height });

  const differing = pixelmatch(
    baselineData,
    actualData,
    diff.data,
    width,
    height,
    { threshold: input.threshold ?? DEFAULT_THRESHOLD, includeAA: false },
  );

  const total = width * height;
  const masked = maskedPixelCount(input.masks ?? [], width, height);
  const comparable = Math.max(total - masked, 1);

  return {
    metrics: {
      pixelDifference: differing / comparable,
      layoutOffsetPoints: 0,
      colorDelta: meanColorDelta(baselineData, actualData),
      referencePresent: true,
      stateMapped,
    },
    diff: PNG.sync.write(diff),
    dimensions: { width, height },
    differingPixels: differing,
  };
}

/** Zero out masked regions in a copy so both images ignore them identically. */
function applyMasks(png: PNG, masks: MaskRect[]): Buffer {
  if (masks.length === 0) return png.data;
  const data = Buffer.from(png.data);
  for (const mask of masks) {
    const x0 = Math.max(0, Math.floor(mask.x));
    const y0 = Math.max(0, Math.floor(mask.y));
    const x1 = Math.min(png.width, x0 + Math.ceil(mask.width));
    const y1 = Math.min(png.height, y0 + Math.ceil(mask.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (png.width * y + x) << 2;
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }
  }
  return data;
}

function maskedPixelCount(
  masks: MaskRect[],
  width: number,
  height: number,
): number {
  // Overlapping masks are counted once by rasterizing into a set of rows; masks
  // are few and small, so the simple approach is fine and exact.
  const seen = new Set<number>();
  for (const mask of masks) {
    const x0 = Math.max(0, Math.floor(mask.x));
    const y0 = Math.max(0, Math.floor(mask.y));
    const x1 = Math.min(width, x0 + Math.ceil(mask.width));
    const y1 = Math.min(height, y0 + Math.ceil(mask.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) seen.add(y * width + x);
    }
  }
  return seen.size;
}

/**
 * Mean per-channel distance across the image, scaled to roughly match the
 * deltaE range the thresholds are expressed in (§12.6).
 */
function meanColorDelta(a: Buffer, b: Buffer): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  const pixels = a.length >> 2;
  for (let i = 0; i < a.length; i += 4) {
    const dr = (a[i] ?? 0) - (b[i] ?? 0);
    const dg = (a[i + 1] ?? 0) - (b[i + 1] ?? 0);
    const db = (a[i + 2] ?? 0) - (b[i + 2] ?? 0);
    sum += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  // Euclidean RGB distance maxes at ~441; deltaE thresholds live near 0..100.
  return (sum / pixels / 441) * 100;
}
