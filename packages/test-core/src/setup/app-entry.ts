import { blankStringLiterals, stripComments } from "@xforge/core";

/**
 * Wire `XForgeTestSupport.configure()` into the app's entry point.
 *
 * `XForgeTestSupport` is generated into the app target, but generating it
 * changes nothing on its own: a hook nobody calls is dead code. Something has
 * to call `configure()` before the first screen appears, and that something
 * lives in product source — the one place XForge is otherwise careful never to
 * touch.
 *
 * So this edit is deliberately the narrowest one that works:
 *
 *   - **Exactly one file, exactly one call.** The `@main` type is a single,
 *     obvious place a reviewer can read in five seconds. Nothing else is
 *     touched, so `git diff` is four lines.
 *   - **`#if DEBUG`, because the callee is.** `XForgeTestSupport` is generated
 *     inside `#if DEBUG`; an unguarded call would not compile in Release. The
 *     guard is not a precaution, it is a requirement.
 *   - **Refuse rather than guess.** A UIKit `@main`, a custom initializer, two
 *     `@main` types, a brace where one was not expected — each returns a reason
 *     instead of an edit. A wrong edit here does not fail quietly: it either
 *     breaks the build (recoverable, loud) or silently runs test hooks in a
 *     shipped app (neither). Only the first is acceptable, and only when we are
 *     sure enough not to need it.
 *
 * Even applied, the call does nothing without the `--xforge-test` launch
 * argument: `configure()` starts with `guard isEnabled else { return }`.
 */

/** The `@main` type a SwiftUI app is entered through. */
export interface AppEntry {
  name: string;
  /** 1-based line of the declaration. */
  line: number;
  /** 1-based line whose `{` opens the type's body. */
  bodyLine: number;
  /** Leading whitespace of the declaration line, reused for the insertion. */
  indent: string;
}

export type AppEntryHookPlan =
  /** The call is already there; a second run must change nothing. */
  | { status: "already-present"; line: number }
  | {
      status: "ready";
      /** The file's full new contents. */
      content: string;
      /** 1-based line the call was inserted at. */
      line: number;
      entry: AppEntry;
      /** Whether an existing `init()` was used or one was synthesized. */
      strategy: "existing-init" | "new-init";
    }
  /** Nothing was changed, and this is why. */
  | { status: "refused"; reason: string };

const MAIN_RE = /(?:^|\s)@main(?:\s|$)/;
/**
 * A type declaration, allowing the attributes and modifiers that may precede it
 * — `@main` itself often sits on the same line as the `struct` it marks.
 */
const TYPE_DECL_RE =
  /^\s*(?:@[A-Za-z_][A-Za-z0-9_]*\s+)*(?:public\s+|internal\s+|private\s+|fileprivate\s+|final\s+|open\s+)*(struct|class|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^{]*))?/;
/** `init()` with no parameters — the only initializer shape we will add to. */
const EMPTY_INIT_RE = /^\s*(?:public\s+|internal\s+|private\s+)*init\s*\(\s*\)/;
const ANY_INIT_RE = /^\s*(?:public\s+|internal\s+|private\s+)*init\s*[(<]/;

/** The comment that marks the insertion, so a reader knows what they found. */
const MARKER = "// XForge test hook — DEBUG-only, inert without --xforge-test.";
const CALL = "XForgeTestSupport.configure()";

/** Strip comments and blank string contents, keeping line numbering intact. */
function codeLines(content: string): string[] {
  const out: string[] = [];
  let block = false;
  for (const raw of content.split("\n")) {
    const stripped = stripComments(raw, block);
    block = stripped.inBlockComment;
    out.push(blankStringLiterals(stripped.code));
  }
  return out;
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/**
 * One indentation step, taken from the file rather than from the line being
 * edited: a top-level `struct` has no leading whitespace to learn from, so the
 * only place the file's convention is visible is its indented lines.
 */
function indentStep(content: string): string {
  for (const line of content.split("\n")) {
    const lead = /^[ \t]+/.exec(line)?.[0];
    if (lead) return lead.includes("\t") ? "\t" : "    ";
  }
  return "    ";
}

/** Find the `@main` SwiftUI `App` type, if this file declares one. */
export function findAppEntry(
  content: string,
): { entry: AppEntry } | { refused: string } | undefined {
  const code = codeLines(content);
  const found: AppEntry[] = [];
  let sawMain = false;
  let sawNonAppMain: string | undefined;

  for (let i = 0; i < code.length; i++) {
    const line = code[i] ?? "";
    if (!MAIN_RE.test(line)) continue;
    sawMain = true;

    // `@main` may sit on the declaration line or on its own above it.
    let declIndex = TYPE_DECL_RE.test(line) ? i : -1;
    if (declIndex === -1) {
      for (let j = i + 1; j < Math.min(i + 4, code.length); j++) {
        if ((code[j] ?? "").trim().length === 0) continue;
        declIndex = TYPE_DECL_RE.test(code[j] ?? "") ? j : -1;
        break;
      }
    }
    if (declIndex === -1) continue;

    const decl = TYPE_DECL_RE.exec(code[declIndex] ?? "");
    if (!decl) continue;
    const name = decl[2] ?? "";
    const conforms = (decl[3] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/<.*>$/, ""));
    if (!conforms.includes("App")) {
      sawNonAppMain = name;
      continue;
    }

    // The body opens at the first `{` at or after the declaration. More than a
    // couple of lines away means a shape we do not recognise.
    let bodyLine = -1;
    for (let j = declIndex; j < Math.min(declIndex + 3, code.length); j++) {
      if ((code[j] ?? "").includes("{")) {
        bodyLine = j + 1;
        break;
      }
    }
    if (bodyLine === -1) {
      return {
        refused: `Found \`@main struct ${name}: App\` but not the \`{\` that opens its body.`,
      };
    }

    found.push({
      name,
      line: declIndex + 1,
      bodyLine,
      indent: leadingWhitespace(code[declIndex] ?? ""),
    });
  }

  if (found.length > 1) {
    return {
      refused:
        `Two \`@main\` App types in one file (${found.map((f) => f.name).join(", ")}). ` +
        "That does not compile, so there is nothing safe to edit.",
    };
  }
  if (found.length === 0) {
    if (sawNonAppMain) {
      return {
        refused:
          `\`@main\` here is \`${sawNonAppMain}\`, not a SwiftUI \`App\` — likely a ` +
          "UIApplicationDelegate. Call `XForgeTestSupport.configure()` at the top of " +
          "`application(_:didFinishLaunchingWithOptions:)` yourself; the delegate's " +
          "shape varies too much to edit blind.",
      };
    }
    if (sawMain)
      return { refused: "`@main` found, but no type declaration after it." };
    return undefined;
  }
  return { entry: found[0]! };
}

/**
 * Plan the insertion. Pure: returns the new file contents, never writes.
 */
export function planTestSupportHook(content: string): AppEntryHookPlan {
  const located = findAppEntry(content);
  if (located === undefined) {
    return {
      status: "refused",
      reason: "No `@main` App declaration in this file.",
    };
  }
  if ("refused" in located) {
    return { status: "refused", reason: located.refused };
  }
  const { entry } = located;

  const lines = content.split("\n");
  const code = codeLines(content);

  // Idempotence: an existing call is the finished state, not a conflict.
  for (let i = 0; i < code.length; i++) {
    if ((code[i] ?? "").includes(CALL)) {
      return { status: "already-present", line: i + 1 };
    }
  }

  // Walk the type's body, tracking depth so an `init` in a nested type is not
  // mistaken for the entry point's own.
  let depth = 0;
  let initLine = -1;
  let customInit: string | undefined;
  for (let i = entry.bodyLine - 1; i < code.length; i++) {
    const line = code[i] ?? "";
    const before = depth;
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    // Members of the entry point itself sit at depth 1 on entry to the line.
    if (before === 1) {
      if (EMPTY_INIT_RE.test(line)) {
        initLine = i + 1;
        break;
      }
      if (ANY_INIT_RE.test(line)) customInit = line.trim();
    }
    if (i >= entry.bodyLine - 1 && depth <= 0) break;
  }

  if (initLine === -1 && customInit) {
    return {
      status: "refused",
      reason:
        `${entry.name} declares a custom initializer (\`${customInit}\`). Adding ` +
        "`init()` next to it would make initialization ambiguous, so add " +
        `\`${CALL}\` to that initializer yourself.`,
    };
  }

  const body = indentStep(content);

  if (initLine !== -1) {
    // Only append into an initializer whose brace ends the line; a one-liner
    // body would be reflowed, and reflowing product source is not on the table.
    const initCode = code[initLine - 1] ?? "";
    if (!initCode.trimEnd().endsWith("{")) {
      return {
        status: "refused",
        reason:
          `${entry.name}'s \`init()\` is written on one line (\`${initCode.trim()}\`); ` +
          `add \`${CALL}\` to it yourself rather than have this reflow your source.`,
      };
    }
    const inner = leadingWhitespace(initCode) + body;
    const insertion = [
      `${inner}${MARKER}`,
      `${inner}#if DEBUG`,
      `${inner}${CALL}`,
      `${inner}#endif`,
    ];
    lines.splice(initLine, 0, ...insertion);
    return {
      status: "ready",
      content: lines.join("\n"),
      line: initLine + 3,
      entry,
      strategy: "existing-init",
    };
  }

  // No initializer: synthesize one. `App` requires `init()`, and every stored
  // property in a conforming type therefore already has a default — so the
  // memberwise initializer this shadows was never the one being used.
  const member = entry.indent + body;
  const inner = member + body;
  const insertion = [
    `${member}${MARKER}`,
    `${member}init() {`,
    `${inner}#if DEBUG`,
    `${inner}${CALL}`,
    `${inner}#endif`,
    `${member}}`,
    "",
  ];
  lines.splice(entry.bodyLine, 0, ...insertion);
  return {
    status: "ready",
    content: lines.join("\n"),
    line: entry.bodyLine + 4,
    entry,
    strategy: "new-init",
  };
}
