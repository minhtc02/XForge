import type { TestCase } from "../models/test-case.js";

/**
 * Static locator reconciliation (blueprint §13, §4.1).
 *
 * Before a plan is produced, every accessibility identifier a generated test
 * would look for is checked against the identifiers that actually exist in
 * Swift source. Catching a mismatch here turns a 5-second-timeout failure per
 * case — which triage would then misread as a product bug — into a single,
 * evidence-backed deviation reported at plan time.
 *
 * The check is fully offline: it needs no simulator, no build, and no Xcode.
 *
 * It deliberately distinguishes two outcomes (§3.3 — never assert what cannot
 * be verified):
 *   MISSING       the identifier is nowhere in source; the locator will fail.
 *   UNRESOLVABLE  source builds identifiers dynamically (`"row-\\(i)"`), so a
 *                 static check cannot decide. Reported, never blocking.
 */

/** One accessibility identifier found in source. */
export interface IdentifierInventoryEntry {
  /** Literal value; absent when the source expression is dynamic. */
  value?: string;
  /** The raw source expression (used when reporting dynamics). */
  expression: string;
  file: string;
  start_line?: number;
  dynamic: boolean;
  feature?: string;
}

export type DeviationKind = "missing" | "unresolvable";

export interface LocatorDeviation {
  kind: DeviationKind;
  /** The identifier the generated test would look for. */
  locator: string;
  case_id: string;
  feature: string;
  /** Where the locator came from inside the case. */
  origin: "step" | "assertion";
  origin_id: string;
  /** For `unresolvable`: the dynamic expressions that might produce it. */
  candidates?: string[];
}

export interface ReconcileResult {
  deviations: LocatorDeviation[];
  /** Locators that matched a literal identifier in source. */
  matched: number;
  /** Total distinct locators examined. */
  checked: number;
  /** True when there was no inventory at all — nothing could be checked. */
  skipped: boolean;
}

/** Step actions whose `target` is an accessibility identifier to locate. */
const LOCATING_ACTIONS = new Set(["open", "tap", "type"]);

/** Every (locator, origin) pair a case will look for at runtime. */
export function locatorsForCase(
  testCase: TestCase,
): Array<{ locator: string; origin: "step" | "assertion"; originId: string }> {
  const out: Array<{
    locator: string;
    origin: "step" | "assertion";
    originId: string;
  }> = [];
  for (const step of testCase.steps) {
    if (!LOCATING_ACTIONS.has(step.action) || !step.target) continue;
    out.push({ locator: step.target, origin: "step", originId: step.id });
  }
  for (const assertion of testCase.assertions) {
    if (!assertion.target) continue;
    out.push({
      locator: assertion.target,
      origin: "assertion",
      originId: assertion.id,
    });
  }
  return out;
}

export interface ReconcileInput {
  cases: TestCase[];
  inventory: IdentifierInventoryEntry[];
}

/**
 * Compare the locators a plan's cases will use against the identifiers present
 * in source. Pure and deterministic — unit-testable without a repository.
 */
export function reconcileLocators(input: ReconcileInput): ReconcileResult {
  const { cases, inventory } = input;
  if (inventory.length === 0) {
    // No inventory means the source was never inspected for identifiers; we
    // cannot conclude anything, and reporting "all missing" would be a lie.
    return { deviations: [], matched: 0, checked: 0, skipped: true };
  }

  const literals = new Set(
    inventory
      .filter((i) => !i.dynamic && i.value !== undefined)
      .map((i) => i.value as string),
  );
  // Dynamic identifiers are grouped by feature. Entries with no feature could
  // belong to a shared component, so they count as candidates everywhere; a
  // *different* feature's dynamics never could, and must not excuse a locator.
  const dynamicsByFeature = new Map<string, string[]>();
  for (const entry of inventory) {
    if (!entry.dynamic) continue;
    const key = entry.feature ?? "";
    dynamicsByFeature.set(key, [
      ...(dynamicsByFeature.get(key) ?? []),
      entry.expression,
    ]);
  }
  const unattributedDynamics = dynamicsByFeature.get("") ?? [];

  const deviations: LocatorDeviation[] = [];
  const seen = new Set<string>();
  let matched = 0;
  let checked = 0;

  for (const testCase of cases) {
    for (const { locator, origin, originId } of locatorsForCase(testCase)) {
      const key = `${testCase.id}:${origin}:${originId}:${locator}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checked += 1;

      if (literals.has(locator)) {
        matched += 1;
        continue;
      }

      const candidates = [
        ...(dynamicsByFeature.get(testCase.feature) ?? []),
        ...unattributedDynamics,
      ];
      deviations.push({
        kind: candidates.length > 0 ? "unresolvable" : "missing",
        locator,
        case_id: testCase.id,
        feature: testCase.feature,
        origin,
        origin_id: originId,
        ...(candidates.length > 0
          ? { candidates: [...new Set(candidates)].slice(0, 5) }
          : {}),
      });
    }
  }

  return { deviations, matched, checked, skipped: false };
}

/** Case ids that a blocking (`missing`) deviation affects. */
export function blockedCaseIds(result: ReconcileResult): string[] {
  return [
    ...new Set(
      result.deviations
        .filter((d) => d.kind === "missing")
        .map((d) => d.case_id),
    ),
  ].sort();
}
