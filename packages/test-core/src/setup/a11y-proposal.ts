import type {
  A11yProposal,
  IdentifierRequest,
  IdentifierSite,
} from "../models/a11y.js";
import {
  findInteractiveElements,
  matchLocator,
  type ElementSite,
} from "./a11y-patch.js";

/**
 * Turn "these locators do not exist in source" into a document a human can
 * approve line by line.
 *
 * Pure: the caller supplies the file contents, so this is unit-testable without
 * a repository and cannot write anything by accident.
 */

/** One missing locator, and where it might belong. */
export interface IdentifierNeed {
  locator: string;
  /** Cases that will time out until it exists. */
  cases: string[];
  /** What those cases do with it. */
  intent: string;
  /**
   * Files worth looking in — the affected features' sources. Empty means "no
   * idea", and every supplied file is searched instead.
   */
  files: string[];
}

export interface A11ySource {
  /** Repo-relative path. */
  path: string;
  content: string;
}

export interface BuildA11yProposalInput {
  planId: string;
  planHash?: string;
  needs: IdentifierNeed[];
  sources: A11ySource[];
  /** How many alternatives to list per locator. */
  maxCandidates?: number;
}

const DEFAULT_MAX_CANDIDATES = 8;

function toSite(path: string, element: ElementSite): IdentifierSite {
  return {
    file: path,
    element_line: element.line,
    element: element.text,
    kind: element.kind,
    anchor_line: element.anchorLine,
    anchor_text: element.anchorText,
    indent: element.modifierIndent,
  };
}

export function buildA11yProposal(input: BuildA11yProposalInput): A11yProposal {
  const max = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  // Parse each file once, however many locators point at it.
  const byFile = new Map<string, ElementSite[]>();
  for (const source of input.sources) {
    byFile.set(source.path, findInteractiveElements(source.content));
  }

  const requests: IdentifierRequest[] = input.needs.map((need) => {
    const scope =
      need.files.length > 0
        ? need.files.filter((f) => byFile.has(f))
        : [...byFile.keys()];

    const open: Array<{ path: string; element: ElementSite }> = [];
    for (const path of scope) {
      for (const element of byFile.get(path) ?? []) {
        if (!element.hasIdentifier) open.push({ path, element });
      }
    }

    // Match within each file, then accept a suggestion only if exactly one file
    // produced one. Two files each offering a "Save" button is an ambiguity
    // across files, and resolving it by file order would be a coin flip.
    const perFile = scope
      .map((path) => {
        const hit = matchLocator(need.locator, byFile.get(path) ?? []);
        return hit ? { path, ...hit } : undefined;
      })
      .filter((m): m is NonNullable<typeof m> => m !== undefined);

    const suggestion = perFile.length === 1 ? perFile[0] : undefined;

    const candidates = open
      .filter(
        (c) =>
          !(
            suggestion &&
            c.path === suggestion.path &&
            c.element.line === suggestion.site.line
          ),
      )
      .slice(0, max)
      .map((c) => toSite(c.path, c.element));

    const notes: string[] = [];
    if (!suggestion) {
      notes.push(
        perFile.length > 1
          ? `${perFile.length} files each offer a plausible element for "${need.locator}"; ` +
              "pick one and copy it into `site`, or add the identifier by hand."
          : open.length === 0
            ? scope.length === 0
              ? "No source files were searched — no feature source was found for the affected cases."
              : "Every element in the candidate files already has an identifier; the locator may simply be wrong."
            : `No element's label matches "${need.locator}" and ${open.length} are unidentified, ` +
              "so any choice would be a guess. Pick from `candidates` — or fix the plan's target instead.",
      );
    }
    if (open.length > candidates.length + (suggestion ? 1 : 0)) {
      notes.push(
        `Listing ${candidates.length} of ${open.length} unidentified elements; ` +
          "raise --max-candidates to see the rest.",
      );
    }

    return {
      locator: need.locator,
      affected_cases: [...need.cases].sort(),
      intent: need.intent,
      approved: false,
      ...(suggestion
        ? {
            site: toSite(suggestion.path, suggestion.site),
            basis: suggestion.basis,
          }
        : {}),
      candidates,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  });

  return {
    schema_version: 1,
    plan_id: input.planId,
    ...(input.planHash ? { plan_hash: input.planHash } : {}),
    requests,
  };
}
