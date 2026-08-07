import { z } from "zod";

/**
 * The accessibility-identifier proposal document (`a11y-proposal.json`).
 *
 * A locator the plan looks for and the source never declares is a case that can
 * only fail by timeout, which triage then reports as a product bug. The repair
 * is one line of Swift per locator — and unlike everything else XForge writes,
 * that line lands in product code, on an element XForge had to *guess*.
 *
 * So the write is split in two, with a human in the middle. `xforge test a11y`
 * proposes: for each missing locator, the cases that need it, what they do with
 * it, a suggested element with the reason it was suggested, and every other
 * unidentified element nearby. `--apply` then writes only the entries marked
 * `approved: true`.
 *
 * That is not ceremony. The failure mode of a wrong placement is an identifier
 * on a container, producing a test that finds an element, taps it, passes, and
 * exercises nothing — invisible forever. A missing identifier fails loudly on
 * the first run. Defaulting `approved` to `false` is what keeps the loud failure
 * the worst possible outcome.
 */

/** A place a modifier can be appended, precise enough to re-verify later. */
export const IdentifierSite = z.object({
  /** Repo-relative Swift file. */
  file: z.string().min(1),
  /** The element's opening line, 1-based — what a reviewer should read. */
  element_line: z.number().int().positive(),
  /** The element as written, e.g. `Button("Save") {`. */
  element: z.string(),
  /** `Button`, `TextField`, … */
  kind: z.string().min(1),
  /**
   * The line the modifier is inserted after: where the element expression's
   * brackets balance. Not the same as `element_line` for a multi-line element.
   */
  anchor_line: z.number().int().positive(),
  /**
   * What `anchor_line` said when this was proposed. `--apply` refuses when it no
   * longer matches — the same staleness rule as a plan hash, for the same
   * reason: a line number is meaningless once the file has moved on.
   */
  anchor_text: z.string(),
  /**
   * Exact leading whitespace for the inserted line. Taken from the modifier
   * chain the element already has, so a patch matches the file's convention
   * instead of imposing one.
   */
  indent: z.string().default(""),
});
export type IdentifierSite = z.infer<typeof IdentifierSite>;

/** Why a site was suggested — never "trust me". */
export const SiteBasis = z.enum([
  /** The element's label matches the locator (`Button("Save")` ← `save-button`). */
  "label-match",
  /** No label evidence, but it was the file's only element without an identifier. */
  "only-unidentified-element",
  /** A human chose it. */
  "manual",
]);
export type SiteBasis = z.infer<typeof SiteBasis>;

export const IdentifierRequest = z.object({
  /** The identifier the generated test will look for. */
  locator: z.string().min(1),
  /** Cases that fail by timeout until it exists. */
  affected_cases: z.array(z.string()).default([]),
  /** What the cases do with it, so a reviewer can judge the site. */
  intent: z.string().default(""),
  /**
   * Set to `true` to have `--apply` write this one. Nothing else opts in: no
   * flag applies an unapproved entry, because "apply everything" is precisely
   * the operation whose failure mode is silent.
   */
  approved: z.boolean().default(false),
  /** Where the modifier goes. Absent when XForge would only have been guessing. */
  site: IdentifierSite.optional(),
  /** Why `site` was suggested. */
  basis: SiteBasis.optional(),
  /** Other unidentified elements in the candidate files, for a human to pick from. */
  candidates: z.array(IdentifierSite).default([]),
  /** Set when candidates were truncated, or when nothing could be suggested. */
  note: z.string().optional(),
});
export type IdentifierRequest = z.infer<typeof IdentifierRequest>;

export const A11yProposal = z.object({
  schema_version: z.literal(1).default(1),
  plan_id: z.string().min(1),
  /**
   * The plan hash this was derived from. Provenance, not a gate: an identifier
   * the plan no longer needs is a harmless extra line, so refusing to apply it
   * would cost more than it protects. The anchor text is the real guard, because
   * the risk here is the *source* having moved, not the plan.
   */
  plan_hash: z.string().optional(),
  requests: z.array(IdentifierRequest).default([]),
});
export type A11yProposal = z.infer<typeof A11yProposal>;

export function parseA11yProposal(input: unknown): A11yProposal {
  return A11yProposal.parse(input);
}
