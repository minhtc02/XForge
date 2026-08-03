import type { Severity } from "../models/enums.js";
import type { FigmaNodeMetadata } from "../figma/adapter.js";
import type { ProbeElement } from "../generation/probe.js";

/**
 * Design conformance from measurements, not pixels (blueprint §12.2).
 *
 * A pixel diff answers "how different?" — 3% — which is neither actionable nor
 * stable: an animation, a blinking cursor or a different font smoothing moves
 * the number. Comparing *measurements* answers "what is wrong?" — "Save button
 * is 32pt tall, design says 44" — which a developer can fix, and which does not
 * drift between runs.
 *
 * So this compares the frame sizes and design tokens Figma reports against the
 * frames the accessibility probe measured on the running app. It needs no
 * screenshot, so it is fast and immune to visual noise.
 *
 * Everything here is pure: metadata in, findings out.
 */

export type ConformanceRule =
  | "frame-size"
  | "element-size"
  | "tap-target"
  | "color-token"
  | "spacing-token"
  | "font-token"
  | "missing-element";

export interface ConformanceFinding {
  rule: ConformanceRule;
  severity: Severity;
  /** Element identifier, or the screen when the finding is screen-level. */
  element: string;
  /** What the design says. */
  expected: string;
  /** What the app does. */
  actual: string;
  /** Signed difference where both sides are numeric, in points. */
  deltaPoints?: number;
  description: string;
}

export interface ConformanceThresholds {
  /** Ignore differences at or below this, in points. */
  layoutTolerancePoints: number;
  /** Above this many points, a size difference is a failure, not a warning. */
  layoutFailurePoints: number;
  /** Minimum tap target, in points (Apple HIG). */
  minTapPoints: number;
}

export const DEFAULT_CONFORMANCE: ConformanceThresholds = {
  layoutTolerancePoints: 2,
  layoutFailurePoints: 8,
  minTapPoints: 44,
};

export interface ConformanceInput {
  /** The Figma node this screen was designed from. */
  design: FigmaNodeMetadata;
  /** Elements the probe measured on the running screen. */
  actual: ProbeElement[];
  /** Screen name, for reporting. */
  screen: string;
  thresholds?: Partial<ConformanceThresholds>;
  /**
   * Expected per-element geometry, keyed by accessibility identifier. Figma
   * node metadata carries the frame; a design map may add element detail.
   */
  expectedElements?: Record<
    string,
    { width?: number; height?: number; color?: string; fontSize?: number }
  >;
}

/** Compare a screen against its design. Returns findings ordered by severity. */
export function checkDesignConformance(
  input: ConformanceInput,
): ConformanceFinding[] {
  const t = { ...DEFAULT_CONFORMANCE, ...input.thresholds };
  const findings: ConformanceFinding[] = [];

  // 1. Screen frame. A screen rendered at a different size than designed means
  // every measurement below it is suspect, so report it first.
  const root = largestElement(input.actual);
  if (input.design.width && root) {
    pushSizeFinding(findings, {
      rule: "frame-size",
      element: input.screen,
      dimension: "width",
      expected: input.design.width,
      actual: root.width,
      thresholds: t,
    });
  }
  if (input.design.height && root) {
    pushSizeFinding(findings, {
      rule: "frame-size",
      element: input.screen,
      dimension: "height",
      expected: input.design.height,
      actual: root.height,
      thresholds: t,
    });
  }

  // 2. Per-element geometry, where the design says what to expect.
  const byIdentifier = new Map(
    input.actual
      .filter((e) => e.identifier.length > 0)
      .map((e) => [e.identifier, e]),
  );
  for (const [identifier, expected] of Object.entries(
    input.expectedElements ?? {},
  )) {
    const actual = byIdentifier.get(identifier);
    if (!actual) {
      findings.push({
        rule: "missing-element",
        severity: "critical",
        element: identifier,
        expected: "present in the design",
        actual: "not found on screen",
        description: `"${identifier}" is in the design but was not rendered.`,
      });
      continue;
    }
    if (expected.width !== undefined) {
      pushSizeFinding(findings, {
        rule: "element-size",
        element: identifier,
        dimension: "width",
        expected: expected.width,
        actual: actual.width,
        thresholds: t,
      });
    }
    if (expected.height !== undefined) {
      pushSizeFinding(findings, {
        rule: "element-size",
        element: identifier,
        dimension: "height",
        expected: expected.height,
        actual: actual.height,
        thresholds: t,
      });
    }
  }

  // 3. Tap targets. Independent of the design — the HIG minimum applies
  // regardless of what Figma says, and this is the single most common UI defect
  // that survives review.
  for (const element of input.actual) {
    if (!element.isHittable || !element.isEnabled) continue;
    const smallest = Math.min(element.width, element.height);
    if (smallest <= 0 || smallest >= t.minTapPoints) continue;
    findings.push({
      rule: "tap-target",
      severity: smallest < t.minTapPoints * 0.75 ? "major" : "minor",
      element: element.identifier || element.label || element.type,
      expected: `>= ${t.minTapPoints}pt`,
      actual: `${round(element.width)}×${round(element.height)}pt`,
      deltaPoints: round(smallest - t.minTapPoints),
      description: `Tap target is ${round(smallest)}pt on its shortest side; the HIG minimum is ${t.minTapPoints}pt.`,
    });
  }

  // 4. Design tokens Figma exposes as variables.
  findings.push(...checkTokens(input.design, input.expectedElements ?? {}));

  const order: Record<Severity, number> = {
    blocker: 0,
    critical: 1,
    major: 2,
    minor: 3,
    info: 4,
  };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

interface SizeCheck {
  rule: ConformanceRule;
  element: string;
  dimension: "width" | "height";
  expected: number;
  actual: number;
  thresholds: ConformanceThresholds;
}

function pushSizeFinding(
  findings: ConformanceFinding[],
  check: SizeCheck,
): void {
  const delta = check.actual - check.expected;
  if (Math.abs(delta) <= check.thresholds.layoutTolerancePoints) return;
  findings.push({
    rule: check.rule,
    severity:
      Math.abs(delta) > check.thresholds.layoutFailurePoints
        ? "major"
        : "minor",
    element: check.element,
    expected: `${check.dimension} ${round(check.expected)}pt`,
    actual: `${check.dimension} ${round(check.actual)}pt`,
    deltaPoints: round(delta),
    description: `${check.element} ${check.dimension} is ${round(check.actual)}pt; the design says ${round(check.expected)}pt (${delta > 0 ? "+" : ""}${round(delta)}pt).`,
  });
}

/**
 * Compare Figma design variables against the values the design map records for
 * elements. Reported as `info` unless a concrete mismatch is found: a token the
 * app does not expose is a gap in instrumentation, not a defect.
 */
function checkTokens(
  design: FigmaNodeMetadata,
  expectedElements: Record<string, { color?: string; fontSize?: number }>,
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const variables = design.variables ?? {};

  for (const [name, value] of Object.entries(variables)) {
    const kind = tokenKind(name);
    if (!kind) continue;
    // A token is only checkable when something claims a value for it.
    const claimed = Object.entries(expectedElements).find(([, e]) =>
      kind === "color-token" ? e.color !== undefined : e.fontSize !== undefined,
    );
    if (!claimed) continue;
    const [identifier, element] = claimed;

    if (kind === "color-token" && element.color) {
      if (normalizeColor(element.color) !== normalizeColor(String(value))) {
        findings.push({
          rule: "color-token",
          severity: "minor",
          element: identifier,
          expected: `${name} = ${String(value)}`,
          actual: element.color,
          description: `${identifier} uses ${element.color}; the design token ${name} is ${String(value)}.`,
        });
      }
    }
    if (kind === "font-token" && element.fontSize !== undefined) {
      const expected = Number(value);
      if (Number.isFinite(expected) && expected !== element.fontSize) {
        findings.push({
          rule: "font-token",
          severity: "minor",
          element: identifier,
          expected: `${name} = ${expected}`,
          actual: String(element.fontSize),
          deltaPoints: round(element.fontSize - expected),
          description: `${identifier} font size is ${element.fontSize}; the design token ${name} is ${expected}.`,
        });
      }
    }
  }
  return findings;
}

function tokenKind(name: string): ConformanceRule | undefined {
  const lower = name.toLowerCase();
  if (/colou?r|background|foreground|tint|fill/.test(lower))
    return "color-token";
  if (/font|type|text-size/.test(lower)) return "font-token";
  if (/spacing|padding|margin|gap|radius/.test(lower)) return "spacing-token";
  return undefined;
}

/** `#FFAA00`, `#ffaa00ff` and `rgb(255,170,0)` should compare equal. */
function normalizeColor(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(trimmed);
  if (hex) return `#${hex[1]}`;
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return `#${[r, g, b]
      .map((c) => Number(c).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return trimmed;
}

function largestElement(elements: ProbeElement[]): ProbeElement | undefined {
  let best: ProbeElement | undefined;
  let bestArea = 0;
  for (const element of elements) {
    const area = element.width * element.height;
    if (area > bestArea) {
      bestArea = area;
      best = element;
    }
  }
  return best;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Findings severe enough to fail a visual case. */
export function isConformanceFailure(finding: ConformanceFinding): boolean {
  return finding.severity === "blocker" || finding.severity === "critical";
}

/** A one-line summary suitable for a bug report title. */
export function summarizeConformance(findings: ConformanceFinding[]): string {
  if (findings.length === 0) return "Matches the design reference";
  const worst = findings[0]!;
  const rest = findings.length - 1;
  return `${worst.description}${rest > 0 ? ` (+${rest} more)` : ""}`;
}
