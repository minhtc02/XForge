import {
  analyzeSwiftFile,
  blankStringLiterals,
  stripComments,
} from "@xforge/core";

/**
 * Locate the elements an `accessibilityIdentifier` could be attached to, and
 * attach one — as two separate steps, on purpose.
 *
 * A locator the plan uses and the source does not declare is the most common
 * reason a QA run reports nonsense: every case using it fails by timeout, and
 * triage reads that as a product bug. The fix is one line of Swift. The
 * dangerous part is deciding *which* line.
 *
 * Getting it wrong is not loud. An identifier on the `VStack` instead of the
 * `Button` inside it produces a test that finds an element, taps it, and
 * passes — while never touching the control it claims to exercise. Nobody
 * discovers that, ever. Compare a missing identifier, which fails immediately
 * and obviously. So a wrong placement is strictly worse than no placement, and
 * that asymmetry is what this module is shaped around:
 *
 *   - **Containers are never candidates.** `VStack`, `List`, `Section`, `Form`
 *     and friends are excluded by construction, because they are the shape the
 *     silent-pass failure takes.
 *   - **Nothing is applied without an explicit approval.** A suggestion carries
 *     its basis (`label-match`, or "it was the only unidentified element"), and
 *     the caller writes it into a proposal with `approved: false`. Bulk-applying
 *     guesses across a UI is exactly the thing this must not do.
 *   - **An ambiguous match produces no suggestion.** Two plausible elements
 *     means the answer needs a human, and a coin flip dressed as a default is
 *     worse than a blank.
 *   - **Applying re-reads the anchor line and re-parses the result.** A stale
 *     proposal refuses; a patch the parser cannot then see refuses and reverts.
 */

/** An element a modifier could be appended to. */
export interface ElementSite {
  /** `Button`, `TextField`, `NavigationLink`, … */
  kind: string;
  /** First string literal on the opening line — the visible label, usually. */
  label?: string;
  /** 1-based line the expression starts on. */
  line: number;
  /**
   * 1-based line the expression's brackets balance on — where a new modifier
   * goes. Trailing modifiers may follow; a chain interrupted by a new line is
   * still one chain, so inserting here is valid regardless of what comes after.
   */
  anchorLine: number;
  /** Exact text of `anchorLine`, so a stale proposal can be detected. */
  anchorText: string;
  /**
   * Exact leading whitespace for the inserted modifier line — taken from the
   * chain the element already has, so the patch matches the file's own
   * convention rather than imposing one.
   */
  modifierIndent: string;
  /** Trimmed opening line, for reporting. */
  text: string;
  /** True when this element's chain already carries an identifier. */
  hasIdentifier: boolean;
}

/**
 * Leaf and interactive views. Containers are deliberately absent: see the
 * module note — an identifier on a container is the failure this must not make
 * easy. `Menu` earns its place because it is tapped, not merely laid out.
 */
const ELEMENT_KINDS = new Set([
  "Button",
  "DatePicker",
  "Image",
  "Label",
  "Link",
  "Menu",
  "NavigationLink",
  "Picker",
  "ProgressView",
  "SecureField",
  "Slider",
  "Stepper",
  "Text",
  "TextEditor",
  "TextField",
  "Toggle",
]);

const ELEMENT_START_RE = /^([ \t]*)([A-Z][A-Za-z0-9_]*)\s*[({]/;
const FIRST_LITERAL_RE = /"((?:[^"\\]|\\.)*)"/;
const IDENTIFIER_RE = /\baccessibility(?:Identifier|\(\s*identifier:)/;

interface Scan {
  /** Comment-stripped, string-blanked code, one entry per source line. */
  code: string[];
  /** Raw source lines. */
  raw: string[];
}

function scan(content: string): Scan {
  const raw = content.split("\n");
  const code: string[] = [];
  let block = false;
  for (const line of raw) {
    const stripped = stripComments(line, block);
    block = stripped.inBlockComment;
    code.push(blankStringLiterals(stripped.code));
  }
  return { code, raw };
}

/** The file's own indentation step, so a tab-indented file stays tab-indented. */
function indentStep(lines: string[]): string {
  for (const line of lines) {
    const lead = /^[ \t]+/.exec(line)?.[0];
    if (lead) return lead.includes("\t") ? "\t" : "    ";
  }
  return "    ";
}

function delta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === "(" || ch === "{" || ch === "[") d += 1;
    else if (ch === ")" || ch === "}" || ch === "]") d -= 1;
  }
  return d;
}

/**
 * Every element in a Swift file a modifier could be appended to.
 *
 * Only matches an element that *starts* its line. An element embedded in a
 * larger expression — a ternary branch, a function argument on a shared line —
 * is skipped rather than patched: the insertion is line-based, and a line-based
 * insertion into the middle of an expression is how you get source that does
 * not compile.
 */
export function findInteractiveElements(content: string): ElementSite[] {
  const { code, raw } = scan(content);
  const sites: ElementSite[] = [];
  const step = indentStep(raw);

  for (let i = 0; i < code.length; i++) {
    const line = code[i] ?? "";
    const start = ELEMENT_START_RE.exec(line);
    if (!start) continue;
    const kind = start[2] ?? "";
    if (!ELEMENT_KINDS.has(kind)) continue;

    // Walk to the line where the expression's brackets balance.
    let depth = 0;
    let end = -1;
    for (let j = i; j < code.length; j++) {
      depth += delta(code[j] ?? "");
      if (depth <= 0) {
        end = j;
        break;
      }
    }
    if (end === -1) continue; // unbalanced to EOF — not something to edit

    // The chain continues through following lines that begin with `.`; an
    // identifier anywhere in it means this element already has one, and the
    // first of them shows how this file indents a modifier.
    let chainEnd = end;
    let chainIndent: string | undefined;
    for (let j = end + 1; j < code.length; j++) {
      const next = (code[j] ?? "").trim();
      if (next.length === 0) continue;
      if (!next.startsWith(".")) break;
      chainIndent ??= /^[ \t]*/.exec(raw[j] ?? "")?.[0] ?? "";
      chainEnd = j;
    }
    const chain = code.slice(i, chainEnd + 1).join("\n");
    const label = FIRST_LITERAL_RE.exec(raw[i] ?? "")?.[1];
    const indent = start[1] ?? "";

    sites.push({
      kind,
      ...(label ? { label } : {}),
      line: i + 1,
      anchorLine: end + 1,
      anchorText: raw[end] ?? "",
      modifierIndent: chainIndent ?? `${indent}${step}`,
      text: (raw[i] ?? "").trim(),
      hasIdentifier: IDENTIFIER_RE.test(chain),
    });
  }

  return sites;
}

/** Lowercase alphanumerics only — `"save-button"` and `"Save Button"` agree. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type MatchBasis = "label-match" | "only-unidentified-element";

/**
 * Pick the element a locator most likely belongs to, or nothing.
 *
 * Returns `undefined` for a tie. That is the point: two equally good candidates
 * is information ("a human must choose"), and collapsing it into a default
 * would throw away the only signal that mattered.
 */
export function matchLocator(
  locator: string,
  elements: ElementSite[],
): { site: ElementSite; basis: MatchBasis } | undefined {
  const open = elements.filter((e) => !e.hasIdentifier);
  if (open.length === 0) return undefined;

  const wanted = normalize(locator);
  const scored = open.map((site) => {
    const label = site.label ? normalize(site.label) : "";
    const kind = normalize(site.kind);
    let score = 0;
    if (label.length > 0) {
      if (
        wanted === label ||
        wanted === `${label}${kind}` ||
        wanted === `${kind}${label}`
      ) {
        score = 3;
      } else if (label.length >= 3 && wanted.includes(label)) {
        score = 2;
      }
    }
    return { site, score };
  });

  const best = Math.max(...scored.map((s) => s.score));
  if (best > 0) {
    const winners = scored.filter((s) => s.score === best);
    return winners.length === 1
      ? { site: winners[0]!.site, basis: "label-match" }
      : undefined;
  }

  // No label evidence at all. One unidentified element is still unambiguous —
  // there is nothing else it could be — but it is a weaker claim, and says so.
  return open.length === 1
    ? { site: open[0]!, basis: "only-unidentified-element" }
    : undefined;
}

export interface ApplyIdentifierInput {
  /** Path, used only for the verification re-parse and error text. */
  path: string;
  content: string;
  /** 1-based line to append the modifier after. */
  anchorLine: number;
  /** What that line said when the proposal was written. */
  anchorText: string;
  /** Exact leading whitespace for the new modifier line. */
  indent: string;
  locator: string;
}

export type ApplyIdentifierResult =
  | { status: "applied"; content: string; line: number }
  | { status: "already-present"; line: number }
  | { status: "refused"; reason: string };

/**
 * Append `.accessibilityIdentifier("<locator>")` at a verified anchor.
 *
 * The modifier is not `#if DEBUG`-guarded, and that is a decision rather than
 * an omission. An accessibility identifier changes no behaviour and ships
 * harmlessly — Apple's own frameworks expect it in shipping apps. Guarding it
 * would need Swift 5.8's postfix `#if` (silently breaking older toolchains) and
 * would remove the identifier from exactly the Release build a TestFlight run
 * exercises, so the tests that pass locally would time out on the build people
 * actually test. Neither is worth the purity.
 */
export function applyIdentifier(
  input: ApplyIdentifierInput,
): ApplyIdentifierResult {
  const { path, content, anchorLine, anchorText, indent, locator } = input;

  if (/["\\\n]/.test(locator)) {
    return {
      status: "refused",
      reason: `Locator ${JSON.stringify(locator)} contains a quote or backslash; it cannot be written as a Swift string literal.`,
    };
  }

  const before = analyzeSwiftFile(path, content);
  const existing = before.accessibilityIdentifiers.find(
    (id) => !id.dynamic && id.value === locator,
  );
  if (existing) return { status: "already-present", line: existing.line };

  const lines = content.split("\n");
  const actual = lines[anchorLine - 1];
  if (actual === undefined) {
    return {
      status: "refused",
      reason: `${path} has ${lines.length} lines; the proposal anchors at line ${anchorLine}.`,
    };
  }
  if (actual.trimEnd() !== anchorText.trimEnd()) {
    return {
      status: "refused",
      reason:
        `${path}:${anchorLine} now reads \`${actual.trim()}\`, not \`${anchorText.trim()}\`. ` +
        "The file changed after the proposal was written — re-run `xforge test a11y` " +
        "and check the new anchor before approving it again.",
    };
  }

  const modifier = `${indent}.accessibilityIdentifier("${locator}")`;
  lines.splice(anchorLine, 0, modifier);
  const next = lines.join("\n");

  // The patch is only real if the parser can now see it. Anything else means we
  // wrote something we do not understand, which is not a state to leave a file
  // in — the caller still holds the original.
  const after = analyzeSwiftFile(path, next);
  const landed = after.accessibilityIdentifiers.find(
    (id) => !id.dynamic && id.value === locator && id.line === anchorLine + 1,
  );
  if (!landed) {
    return {
      status: "refused",
      reason:
        `Wrote \`${locator}\` at ${path}:${anchorLine + 1} but could not read it back; ` +
        "the file was left unchanged.",
    };
  }

  return { status: "applied", content: next, line: anchorLine + 1 };
}
