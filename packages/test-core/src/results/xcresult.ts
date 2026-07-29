import type { TestExecution } from "../models/result.js";
import type { TestStatus } from "../models/enums.js";

/**
 * XCResult parsing (blueprint §15, §6 Phase 6). We parse the *normalized JSON*
 * shape that `xcrun xcresulttool get --format json` produces (the raw plumbing
 * of invoking xcresulttool is the runner's job). This keeps the parser pure and
 * unit-testable against fixtures, independent of an installed Xcode.
 */

/** Minimal shape we consume from an xcresult test summary. */
export interface XcresultTest {
  identifier: string;
  name?: string;
  /** Xcode statuses: "Success" | "Failure" | "Skipped" | "Expected Failure". */
  testStatus: string;
  duration?: number;
  failureMessages?: string[];
}

export interface XcresultSummary {
  tests: XcresultTest[];
}

/** Map an Xcode test status + failure message to an XForge TestStatus. */
export function classifyXcodeStatus(
  testStatus: string,
  failureMessages: string[] = [],
): TestStatus {
  if (/success/i.test(testStatus)) return "PASS";
  if (/skip/i.test(testStatus)) return "SKIPPED";
  if (/expected failure/i.test(testStatus)) return "PASS";
  // A failure: classify by message signature (product vs infra vs category).
  return classifyFailureMessage(failureMessages.join("\n"));
}

/** Classify a failure message into a specific failure status (§4.4, §20.6). */
export function classifyFailureMessage(message: string): TestStatus {
  const m = message.toLowerCase();
  // Infrastructure / environment (never a product bug, §4.4).
  if (
    /simulator|failed to launch|failed to install|unable to boot|timed out waiting for|lost connection|crashed during|xcodebuild|derived ?data|no such (scheme|device)|disk (full|space)/.test(
      m,
    )
  ) {
    return "INFRASTRUCTURE_FAILURE";
  }
  if (
    /permission|not determined|network unreachable|mock server|credential|not authorized/.test(
      m,
    )
  ) {
    return "ENVIRONMENT_BLOCKED";
  }
  // Product failure categories.
  if (
    /accessibilit|voiceover|identifier|a11y|hit target|dynamic type/.test(m)
  ) {
    return "FAIL_ACCESSIBILITY";
  }
  if (/visual|snapshot|pixel|layout|overlap|safe area|figma/.test(m)) {
    return "FAIL_VISUAL";
  }
  if (/performance|regression|launch time|memory|hitch|metric/.test(m)) {
    return "FAIL_PERFORMANCE";
  }
  return "FAIL_FUNCTIONAL";
}

/** Normalize a raw failure message for dedup fingerprinting (§25). */
export function normalizeError(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, "0x…")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .replace(/".*?"/g, '"…"')
    .trim()
    .slice(0, 200);
}

/** Parse an xcresult summary into TestExecution rows for one shard. */
export function parseXcresult(
  summary: XcresultSummary,
  shardId: string,
): TestExecution[] {
  return summary.tests.map((t) => {
    const status = classifyXcodeStatus(t.testStatus, t.failureMessages);
    const message = (t.failureMessages ?? []).join("\n") || undefined;
    return {
      case_id: t.identifier,
      shard_id: shardId,
      status,
      duration_ms: Math.round((t.duration ?? 0) * 1000),
      message,
      normalized_error: message ? normalizeError(message) : undefined,
      retries: 0,
      evidence: [],
    };
  });
}
