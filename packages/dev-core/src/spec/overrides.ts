import type { UserOverride } from "../models/spec.js";

/**
 * User override detection (blueprint §4.2, §14). A user request can override
 * documented behavior for the current run. We detect overrides deterministically
 * from structured hints in the request text — explicit `key: value` or
 * `key = value` pairs, and "change X to Y" / "X should be Y" phrasings — and
 * pair them with the documented value when we can find it.
 *
 * This never mutates docs; it only produces UserOverride records that the
 * Effective Spec resolver applies and the Staged Spec journal records.
 */

export interface DocFact {
  /** Normalized key, e.g. "maximum alarms". */
  key: string;
  value: string;
  /** Doc path the fact came from. */
  doc_path: string;
}

const ASSIGN_RE =
  /([A-Za-z][A-Za-z0-9 _-]{1,60}?)\s*(?:[:=]|is|should be|=>)\s*("[^"]*"|'[^']*'|[^,.;\n]+)/gi;
const CHANGE_RE =
  /\bchange\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _-]{1,60}?)\s+(?:from\s+([^,.;\n]+?)\s+)?to\s+([^,.;\n]+)/gi;

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, " ");
}

function clean(v: string): string {
  return v
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/**
 * Extract candidate (key -> requested value) pairs from a request string.
 * Deterministic + conservative; the LLM layer can refine later.
 */
export function extractRequestedValues(request: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of request.matchAll(CHANGE_RE)) {
    const key = normalizeKey(m[1] ?? "");
    const val = clean(m[3] ?? "");
    if (key && val) out.set(key, val);
  }
  for (const m of request.matchAll(ASSIGN_RE)) {
    const key = normalizeKey(m[1] ?? "");
    const val = clean(m[2] ?? "");
    // Don't clobber a more-specific "change ... to ..." match.
    if (key && val && !out.has(key)) out.set(key, val);
  }
  return out;
}

/**
 * Detect overrides: requested values that differ from a documented fact of the
 * same key. Requested keys with no matching doc fact are still returned as
 * overrides (new behavior) but with no docs_value.
 */
export function detectOverrides(
  request: string,
  docFacts: DocFact[],
): UserOverride[] {
  const requested = extractRequestedValues(request);
  const factByKey = new Map(docFacts.map((f) => [normalizeKey(f.key), f]));
  const overrides: UserOverride[] = [];
  let seq = 0;
  for (const [key, requestedValue] of requested) {
    const fact = factByKey.get(key);
    // If docs already say the same thing, it is not an override.
    if (
      fact &&
      clean(fact.value).toLowerCase() === requestedValue.toLowerCase()
    ) {
      continue;
    }
    seq += 1;
    overrides.push({
      id: `OV-${String(seq).padStart(3, "0")}`,
      target: key,
      docs_value: fact ? clean(fact.value) : undefined,
      requested_value: requestedValue,
      reason: fact
        ? "user request differs from docs"
        : "user request adds new behavior",
    });
  }
  return overrides;
}
