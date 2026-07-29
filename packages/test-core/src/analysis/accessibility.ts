import type { Severity } from "../models/enums.js";

/**
 * Accessibility audit rules (blueprint §22). Given a captured accessibility
 * element tree (produced by the runner in later phases), emit structured
 * findings. Pure/deterministic over the tree so it is fully unit-testable.
 */

export interface A11yElement {
  identifier?: string;
  label?: string;
  traits?: string[];
  /** Tap target size in points. */
  frame?: { width: number; height: number };
  isInteractive?: boolean;
  isDecorativeImage?: boolean;
  /** Conveys meaning by color only (design-provided hint). */
  colorOnlyMeaning?: boolean;
}

export interface A11yFinding {
  rule: string;
  element: string;
  severity: Severity;
  description: string;
  remediation: string;
}

const MIN_TAP_POINTS = 44; // Apple HIG minimum.

/** Audit a screen's element tree, returning findings ordered by severity. */
export function auditAccessibility(
  screen: string,
  elements: A11yElement[],
): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const seenLabels = new Map<string, number>();

  for (const [i, el] of elements.entries()) {
    const ref = el.identifier ?? el.label ?? `${screen}#${i}`;

    if (el.isInteractive && !el.identifier) {
      findings.push({
        rule: "missing-identifier",
        element: ref,
        severity: "major",
        description: "Interactive element lacks an accessibility identifier.",
        remediation: "Add a DEBUG-only accessibilityIdentifier for automation.",
      });
    }
    if (el.isInteractive && !el.label) {
      findings.push({
        rule: "missing-label",
        element: ref,
        severity: "major",
        description: "Interactive element lacks an accessibility label.",
        remediation: "Provide a meaningful accessibilityLabel.",
      });
    }
    if (el.label) {
      seenLabels.set(el.label, (seenLabels.get(el.label) ?? 0) + 1);
    }
    if (
      el.isInteractive &&
      el.frame &&
      (el.frame.width < MIN_TAP_POINTS || el.frame.height < MIN_TAP_POINTS)
    ) {
      findings.push({
        rule: "small-hit-target",
        element: ref,
        severity: "minor",
        description: `Tap target ${el.frame.width}x${el.frame.height} is below ${MIN_TAP_POINTS}pt.`,
        remediation: "Increase the hit target to at least 44x44 points.",
      });
    }
    if (el.isDecorativeImage && (el.label || el.isInteractive)) {
      findings.push({
        rule: "decorative-exposed",
        element: ref,
        severity: "minor",
        description: "Decorative image is exposed to assistive technology.",
        remediation: "Mark decorative images as not accessible.",
      });
    }
    if (el.colorOnlyMeaning) {
      findings.push({
        rule: "color-only-meaning",
        element: ref,
        severity: "major",
        description: "Meaning is conveyed by color alone.",
        remediation: "Add text/icon/shape in addition to color.",
      });
    }
  }

  for (const [label, count] of seenLabels) {
    if (count > 1) {
      findings.push({
        rule: "duplicate-label",
        element: label,
        severity: "minor",
        description: `Accessibility label "${label}" is used ${count} times.`,
        remediation: "Make labels unique so elements are distinguishable.",
      });
    }
  }

  const order: Record<Severity, number> = {
    blocker: 0,
    critical: 1,
    major: 2,
    minor: 3,
    info: 4,
  };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
