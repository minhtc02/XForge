import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { compareScreenshots } from "./visual-compare.js";
import { classifyVisual } from "./visual.js";

/** Build a solid-colour PNG, optionally with one differently-coloured block. */
function png(
  width: number,
  height: number,
  color: [number, number, number],
  block?: {
    x: number;
    y: number;
    w: number;
    h: number;
    color: [number, number, number];
  },
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const inBlock =
        block &&
        x >= block.x &&
        x < block.x + block.w &&
        y >= block.y &&
        y < block.y + block.h;
      const [r, g, b] = inBlock ? block.color : color;
      image.data[idx] = r;
      image.data[idx + 1] = g;
      image.data[idx + 2] = b;
      image.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [255, 0, 0];

const thresholds = {
  pixel_difference_warning: 0.01,
  pixel_difference_failure: 0.03,
  layout_tolerance_points: 2,
  color_delta_warning: 3,
  color_delta_failure: 8,
};

describe("compareScreenshots", () => {
  it("reports zero difference for identical images", () => {
    const image = png(20, 20, WHITE);
    const result = compareScreenshots({ actual: image, baseline: image });
    expect(result.error).toBeUndefined();
    expect(result.metrics.pixelDifference).toBe(0);
    expect(result.differingPixels).toBe(0);
    expect(classifyVisual(result.metrics, thresholds)).toBe("PASS");
  });

  it("measures the differing fraction of pixels", () => {
    const baseline = png(20, 20, WHITE);
    const actual = png(20, 20, WHITE, {
      x: 0,
      y: 0,
      w: 4,
      h: 5,
      color: RED,
    });
    const result = compareScreenshots({ actual, baseline });
    // 20 differing pixels out of 400.
    expect(result.differingPixels).toBe(20);
    expect(result.metrics.pixelDifference).toBeCloseTo(0.05, 5);
    expect(classifyVisual(result.metrics, thresholds)).toBe("VISUAL_FAILURE");
  });

  it("ignores masked regions so dynamic content cannot fail a run", () => {
    const baseline = png(20, 20, WHITE);
    const actual = png(20, 20, WHITE, { x: 0, y: 0, w: 4, h: 5, color: RED });
    const result = compareScreenshots({
      actual,
      baseline,
      masks: [{ x: 0, y: 0, width: 4, height: 5 }],
    });
    expect(result.differingPixels).toBe(0);
    expect(classifyVisual(result.metrics, thresholds)).toBe("PASS");
  });

  it("routes a missing baseline to DESIGN_REFERENCE_MISSING, not a pass", () => {
    const result = compareScreenshots({ actual: png(4, 4, WHITE) });
    expect(result.error).toBe("no-baseline");
    expect(result.metrics.referencePresent).toBe(false);
    expect(classifyVisual(result.metrics, thresholds)).toBe(
      "DESIGN_REFERENCE_MISSING",
    );
  });

  it("routes an unmapped state to DESIGN_STATE_UNMAPPED", () => {
    const image = png(4, 4, WHITE);
    const result = compareScreenshots({
      actual: image,
      baseline: image,
      stateMapped: false,
    });
    expect(classifyVisual(result.metrics, thresholds)).toBe(
      "DESIGN_STATE_UNMAPPED",
    );
  });

  it("treats a size mismatch as a full difference, never a pass", () => {
    const result = compareScreenshots({
      actual: png(20, 20, WHITE),
      baseline: png(20, 30, WHITE),
    });
    expect(result.error).toBe("size-mismatch");
    expect(result.metrics.pixelDifference).toBe(1);
    expect(classifyVisual(result.metrics, thresholds)).toBe("VISUAL_FAILURE");
  });

  it("fails closed when the bytes are not a decodable PNG", () => {
    const result = compareScreenshots({
      actual: Buffer.from("not a png"),
      baseline: png(4, 4, WHITE),
    });
    expect(result.error).toBe("decode-failed");
    expect(classifyVisual(result.metrics, thresholds)).toBe(
      "DESIGN_REFERENCE_MISSING",
    );
  });

  it("produces a diff image when a comparison ran", () => {
    const result = compareScreenshots({
      actual: png(8, 8, WHITE, { x: 0, y: 0, w: 2, h: 2, color: RED }),
      baseline: png(8, 8, WHITE),
    });
    expect(result.diff).toBeInstanceOf(Buffer);
    expect(() => PNG.sync.read(result.diff!)).not.toThrow();
  });

  it("computes a colour delta that grows with the colour distance", () => {
    const baseline = png(8, 8, WHITE);
    const slight = compareScreenshots({
      actual: png(8, 8, [250, 250, 250]),
      baseline,
    });
    const strong = compareScreenshots({ actual: png(8, 8, RED), baseline });
    expect(strong.metrics.colorDelta).toBeGreaterThan(
      slight.metrics.colorDelta,
    );
  });
});
