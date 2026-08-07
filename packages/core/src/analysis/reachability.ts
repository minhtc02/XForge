import type { Feature, ScreenReachability } from "../project-model/schema.js";
import type { AnalyzedSource } from "./features.js";

/**
 * Screen reachability: which UI types nothing in the app ever refers to.
 *
 * This exists because of a specific, expensive failure. XForge derives a
 * navigation graph from "features whose files declare a screen type", which
 * makes an abandoned screen indistinguishable from a live one — so the planner
 * happily generated cases for a `CategoryDetailScreen` that no code path could
 * ever present, and the real home screen went untested. The plan was internally
 * consistent and entirely wrong.
 *
 * The fix is not cleverer inference. It is admitting the model was missing a
 * fact — *is this type referenced from anywhere else?* — and reporting the
 * answer instead of guessing.
 *
 * ## What this is not
 *
 * A zero-reference type is **a question, not a verdict**. The check is lexical
 * and cannot see:
 *   - reflection, `NSClassFromString`, storyboard/XIB instantiation,
 *   - registration through a string key or a plist,
 *   - references from a module this scan did not read.
 *
 * So nothing here deletes, blocks or rewrites anything. It surfaces candidates
 * for a human — or a Claude agent with `Grep` — to confirm. That division is
 * the point: the deterministic layer supplies the reference counts, the
 * semantic layer decides what they mean.
 */

/** A UI type declared in source, with how many other files mention it. */
export type { ScreenReachability };

/** Heuristics for "this type is a screen", i.e. something a test would navigate to. */
const SCREEN_NAME_RE = /(Screen|View|Page|Controller|Sheet)$/;
const SCREEN_KINDS = new Set(["struct", "class"]);

/** A SwiftUI/UIKit entry point conforms to, or subclasses, one of these. */
const SCREEN_CONFORMANCES = new Set([
  "View",
  "UIViewController",
  "UITableViewController",
  "UICollectionViewController",
  "NSViewController",
]);

function isScreenType(name: string, kind: string, inherits: string[]): boolean {
  if (!SCREEN_KINDS.has(kind)) return false;
  if (inherits.some((i) => SCREEN_CONFORMANCES.has(i))) return true;
  return SCREEN_NAME_RE.test(name);
}

/**
 * Cross-reference every screen type against the type references collected from
 * all other files.
 *
 * Test files are excluded from the reference set on purpose: a screen only a
 * test mentions is still unreachable *in the app*, and counting the test as a
 * use would hide exactly the case this is meant to catch.
 */
export function analyzeScreenReachability(
  sources: AnalyzedSource[],
  features: Feature[] = [],
): ScreenReachability[] {
  const featureOfFile = new Map<string, string>();
  for (const feature of features) {
    for (const file of feature.source_files)
      featureOfFile.set(file, feature.id);
  }

  // name -> files that reference it (excluding each file's own declarations,
  // which the parser already removed, and excluding test files).
  const referencedBy = new Map<string, Set<string>>();
  for (const source of sources) {
    if (source.analysis.role === "test") continue;
    for (const ref of source.analysis.typeReferences) {
      const set = referencedBy.get(ref.name) ?? new Set<string>();
      set.add(source.path);
      referencedBy.set(ref.name, set);
    }
  }

  const out: ScreenReachability[] = [];
  for (const source of sources) {
    if (source.analysis.role === "test") continue;
    for (const type of source.analysis.types) {
      if (!isScreenType(type.name, type.kind, type.inherits)) continue;
      const refs = [...(referencedBy.get(type.name) ?? [])]
        .filter((f) => f !== source.path)
        .sort();
      out.push({
        type: type.name,
        file: source.path,
        start_line: type.line,
        ...(featureOfFile.has(source.path)
          ? { feature: featureOfFile.get(source.path)! }
          : {}),
        referenced_by: refs,
        orphaned: refs.length === 0,
      });
    }
  }
  return out.sort(
    (a, b) => a.file.localeCompare(b.file) || a.type.localeCompare(b.type),
  );
}

/** Just the orphan candidates, which is what planning and reports care about. */
export function orphanedScreens(
  reachability: ScreenReachability[],
): ScreenReachability[] {
  return reachability.filter((r) => r.orphaned);
}
