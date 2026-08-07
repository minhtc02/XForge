/**
 * Lightweight, dependency-free Swift source analysis (blueprint §16.2, Phase 3).
 *
 * This is the deterministic "basic layer": regex + line scanning over Swift
 * source to extract the structural facts XForge needs — imports, type
 * declarations with protocol conformances, function signatures, and a coarse
 * architectural role. It is intentionally NOT a full parser (no SourceKit); it
 * favors precision on common conventions and records line numbers so every
 * downstream claim can carry evidence.
 *
 * All results reference 1-based line numbers to match editor/evidence
 * conventions.
 */

export type SwiftDeclKind =
  "class" | "struct" | "enum" | "protocol" | "extension" | "actor";

export interface SwiftType {
  name: string;
  kind: SwiftDeclKind;
  /** Types listed after the colon: superclass and/or conformed protocols. */
  inherits: string[];
  /** 1-based line where the declaration starts. */
  line: number;
  isPublic: boolean;
}

export interface SwiftFunction {
  name: string;
  line: number;
}

/**
 * A type name mentioned somewhere other than its own declaration — a
 * construction (`FooScreen()`), a navigation destination, a type annotation.
 *
 * This is what makes "declared but never used anywhere" answerable. It is a
 * lexical match, not a resolved symbol: `Foo` inside a string or a comment is
 * already excluded (comments are stripped before this runs), but shadowing and
 * same-named types in different modules are not distinguished. Consumers must
 * treat a zero-reference type as *a question to ask*, never as proof of dead
 * code — which is why nothing in XForge deletes based on it.
 */
export interface SwiftTypeReference {
  name: string;
  line: number;
}

/** A literal string found at a known line (endpoint, event name, ...). */
export interface SwiftLiteralRef {
  value: string;
  line: number;
}

/**
 * An `accessibilityIdentifier` occurrence. `value` is present only when the
 * expression is a plain string literal; interpolated or computed expressions
 * are recorded as `dynamic` so downstream reconciliation can say "cannot
 * resolve" instead of "missing" (never assert what we cannot verify, §3.3).
 */
export interface SwiftAccessibilityIdentifier {
  value?: string;
  /** The raw argument expression, trimmed — used when reporting dynamics. */
  expression: string;
  line: number;
  dynamic: boolean;
}

export interface SwiftFileAnalysis {
  path: string;
  imports: string[];
  types: SwiftType[];
  functions: SwiftFunction[];
  /**
   * Capitalized identifiers referenced in this file, excluding the file's own
   * declarations. Feeds the reachability analysis that spots a screen nothing
   * ever presents.
   */
  typeReferences: SwiftTypeReference[];
  /** Coarse role inferred from filename + declarations. */
  role: SwiftRole;
  /** For test files: modules imported with `@testable import`. */
  testableImports: string[];
  lineCount: number;
  /** Declaration attributes seen in the file (`@Model`, `@NSManaged`, ...). */
  attributes: string[];
  /** Accessibility identifiers declared in this file (§13, UI testability). */
  accessibilityIdentifiers: SwiftAccessibilityIdentifier[];
  /** Absolute http(s) URL literals — API endpoint candidates. */
  urlLiterals: SwiftLiteralRef[];
  /** Analytics event names passed to recognized logging APIs. */
  analyticsEvents: SwiftLiteralRef[];
  /** Recognized persistence APIs used (UserDefaults, Keychain, ...). */
  persistenceApis: string[];
  /** `func test*` methods (populated for XCTest files). */
  testMethods: SwiftFunction[];
}

export type SwiftRole =
  | "view"
  | "view-model"
  | "repository"
  | "service"
  | "scheduler"
  | "model"
  | "test"
  | "app-entry"
  | "coordinator"
  | "other";

const IMPORT_RE = /^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)/;
const TESTABLE_IMPORT_RE = /^\s*@testable\s+import\s+([A-Za-z_][A-Za-z0-9_.]*)/;
const DECL_RE =
  /^\s*(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|final\s+)*\b(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^\n{]+))?/;
const FUNC_RE =
  /^\s*(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|static\s+|final\s+|override\s+|@\w+\s+)*func\s+([A-Za-z_][A-Za-z0-9_]*)/;
const ATTRIBUTE_RE = /@([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * A capitalized identifier — the lexical shape of a Swift type reference.
 * Deliberately permissive: the caller filters out declarations, keywords and
 * the standard library, because being generous here and subtractive there is
 * what keeps a missed reference (which would wrongly call live code dead) far
 * less likely than a spurious one (which merely keeps a screen off the list).
 */
const TYPE_REF_RE = /\b([A-Z][A-Za-z0-9_]*)\b/g;

/**
 * Type names so common that a reference to them says nothing about app
 * navigation. Excluding them keeps the reachability graph about the project's
 * own screens rather than SwiftUI's vocabulary.
 */
const ORDINARY_TYPE_NAMES = new Set([
  // SwiftUI / UIKit surface used by nearly every view file.
  "View",
  "Text",
  "Image",
  "Button",
  "VStack",
  "HStack",
  "ZStack",
  "List",
  "ScrollView",
  "NavigationStack",
  "NavigationView",
  "NavigationLink",
  "Group",
  "Section",
  "Form",
  "Spacer",
  "Divider",
  "Color",
  "Font",
  "Animation",
  "State",
  "Binding",
  "Published",
  "ObservedObject",
  "StateObject",
  "EnvironmentObject",
  "Environment",
  "ViewBuilder",
  "Preview",
  "PreviewProvider",
  "App",
  "Scene",
  "WindowGroup",
  "Toolbar",
  "Alert",
  "Sheet",
  "Task",
  // Foundation / Swift standard library.
  "String",
  "Int",
  "Double",
  "Float",
  "Bool",
  "Date",
  "Data",
  "URL",
  "UUID",
  "Array",
  "Dictionary",
  "Set",
  "Optional",
  "Result",
  "Error",
  "Never",
  "Void",
  "Any",
  "AnyObject",
  "Self",
  "Codable",
  "Decodable",
  "Encodable",
  "Hashable",
  "Equatable",
  "Identifiable",
  "Comparable",
  "Sendable",
  "CaseIterable",
  "DispatchQueue",
  "Notification",
  "Bundle",
  "UserDefaults",
  "FileManager",
  "TimeInterval",
  "IndexSet",
  "Calendar",
  "Locale",
  "Timer",
]);

/**
 * Accessibility identifier forms:
 *   SwiftUI  `.accessibilityIdentifier("x")` / `.accessibility(identifier: "x")`
 *   UIKit    `view.accessibilityIdentifier = "x"`
 */
const A11Y_CALL_RE =
  /\.accessibility(?:Identifier\(|\(\s*identifier:)\s*([^)]*)\)/g;
const A11Y_ASSIGN_RE = /\baccessibilityIdentifier\s*=\s*([^\n;]+)/g;

const URL_RE = /https?:\/\/[^\s"'`)\\]+/g;
const ANALYTICS_RE =
  /(?:\b(?:logEvent|logCustomEvent|recordEvent|trackEvent|logScreenView)|\.track)\s*\(\s*(?:(?:name|event|eventName|withName)\s*:\s*)?"([^"]+)"/g;

/** Persistence APIs that are used, not imported — detected by symbol name. */
const PERSISTENCE_API_RULES: Array<{ re: RegExp; name: string }> = [
  { re: /\bUserDefaults\b/, name: "UserDefaults" },
  { re: /\bNSUbiquitousKeyValueStore\b/, name: "iCloud Key-Value Store" },
  {
    re: /\b(?:SecItemAdd|SecItemCopyMatching|KeychainAccess|Keychain)\b/,
    name: "Keychain",
  },
  { re: /\bFileManager\b/, name: "File system" },
  { re: /\bNSPersistentContainer\b|@NSManaged/, name: "Core Data" },
  { re: /\bModelContainer\b|\bModelContext\b/, name: "SwiftData" },
];

/** Strip generic constraints / where-clauses from an inheritance list. */
function parseInherits(raw: string | undefined): string[] {
  if (!raw) return [];
  const beforeWhere = raw.split(/\bwhere\b/)[0] ?? raw;
  return beforeWhere
    .split(",")
    .map((s) => s.trim().replace(/<.*>$/, "").trim())
    .filter((s) => s.length > 0);
}

/**
 * Blank out string-literal contents, keeping the quotes and the length.
 *
 * Type-reference scanning must not see `"CategoryDetailScreen"` inside a log
 * message and record it as a use of that type — a single such match would make
 * dead code look reachable, which is the one direction of error that matters
 * here. Interpolated segments (`\(Foo())`) are kept, because those really are
 * code.
 */
function blankStringLiterals(line: string): string {
  let out = "";
  let inString = false;
  let depth = 0; // interpolation nesting
  let i = 0;
  while (i < line.length) {
    const ch = line[i] as string;
    const next = line[i + 1];
    if (inString && ch === "\\" && next === "(") {
      inString = false;
      depth += 1;
      out += "\\(";
      i += 2;
      continue;
    }
    if (depth > 0 && ch === ")") {
      depth -= 1;
      if (depth === 0) inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && depth === 0) {
      inString = !inString;
      out += ch;
      i += 1;
      continue;
    }
    out += inString ? " " : ch;
    i += 1;
  }
  return out;
}

/**
 * Classify an `accessibilityIdentifier` argument. Only a bare string literal
 * yields a resolvable value; anything interpolated or computed stays `dynamic`.
 */
function classifyIdentifierExpression(
  raw: string,
  line: number,
): SwiftAccessibilityIdentifier {
  const expression = raw.trim().replace(/,\s*$/, "");
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(expression);
  if (literal && !expression.includes("\\(")) {
    return { value: literal[1] ?? "", expression, line, dynamic: false };
  }
  return { expression, line, dynamic: true };
}

/**
 * Strip Swift comments from one line while respecting string literals, so a
 * `//` inside `"https://…"` is not mistaken for a line comment. Returns the
 * code portion plus the block-comment state to carry to the next line.
 */
export function stripComments(
  raw: string,
  inBlockComment: boolean,
): { code: string; inBlockComment: boolean } {
  let out = "";
  let block = inBlockComment;
  let inString = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i] as string;
    const next = raw[i + 1];

    if (block) {
      if (ch === "*" && next === "/") {
        block = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inString) {
      if (ch === "\\" && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      out += ch;
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "/" && next === "*") {
      block = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }

  return { code: out, inBlockComment: block };
}

/** Collect every match of a global regex, resetting its lastIndex first. */
function matchAll(re: RegExp, line: string): RegExpExecArray[] {
  re.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push(m);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Analyze a single Swift file's text. */
export function analyzeSwiftFile(
  path: string,
  content: string,
): SwiftFileAnalysis {
  const lines = content.split("\n");
  const imports = new Set<string>();
  const testableImports = new Set<string>();
  const types: SwiftType[] = [];
  const functions: SwiftFunction[] = [];
  const typeReferences: SwiftTypeReference[] = [];
  const attributes = new Set<string>();
  const accessibilityIdentifiers: SwiftAccessibilityIdentifier[] = [];
  const urlLiterals: SwiftLiteralRef[] = [];
  const analyticsEvents: SwiftLiteralRef[] = [];
  const persistenceApis = new Set<string>();

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComments(lines[i] ?? "", inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const line = stripped.code;
    if (line.trim().length === 0) continue;

    // --- Literal-level extraction (runs before the structural `continue`s so
    // a modifier chain on a declaration line is never skipped). ---
    for (const m of matchAll(A11Y_CALL_RE, line)) {
      accessibilityIdentifiers.push(
        classifyIdentifierExpression(m[1] ?? "", i + 1),
      );
    }
    for (const m of matchAll(A11Y_ASSIGN_RE, line)) {
      accessibilityIdentifiers.push(
        classifyIdentifierExpression(m[1] ?? "", i + 1),
      );
    }
    for (const m of matchAll(URL_RE, line)) {
      urlLiterals.push({ value: m[0], line: i + 1 });
    }
    for (const m of matchAll(ANALYTICS_RE, line)) {
      if (m[1]) analyticsEvents.push({ value: m[1], line: i + 1 });
    }
    for (const rule of PERSISTENCE_API_RULES) {
      if (rule.re.test(line)) persistenceApis.add(rule.name);
    }
    for (const m of matchAll(ATTRIBUTE_RE, line)) {
      if (m[1]) attributes.add(m[1]);
    }

    // Type references, from code only — string contents are blanked so a name
    // mentioned in a log line never counts as a use.
    for (const m of matchAll(TYPE_REF_RE, blankStringLiterals(line))) {
      const name = m[1];
      if (name && !ORDINARY_TYPE_NAMES.has(name)) {
        typeReferences.push({ name, line: i + 1 });
      }
    }

    const testable = TESTABLE_IMPORT_RE.exec(line);
    if (testable?.[1]) {
      testableImports.add(testable[1]);
      continue;
    }
    const imp = IMPORT_RE.exec(line);
    if (imp?.[1]) {
      imports.add(imp[1]);
      continue;
    }
    const decl = DECL_RE.exec(line);
    if (decl) {
      types.push({
        kind: decl[1] as SwiftDeclKind,
        name: decl[2] ?? "",
        inherits: parseInherits(decl[3]),
        line: i + 1,
        isPublic: /\b(public|open)\b/.test(line),
      });
      continue;
    }
    const fn = FUNC_RE.exec(line);
    if (fn?.[1]) {
      functions.push({ name: fn[1], line: i + 1 });
    }
  }

  const role = inferRole(path, types, [...imports]);
  // A file naturally mentions its own type on the declaration line and in its
  // initializers; those are not evidence that anything else uses it.
  const declared = new Set(types.map((t) => t.name));
  const references = typeReferences.filter((r) => !declared.has(r.name));
  return {
    path,
    imports: [...imports].sort(),
    testableImports: [...testableImports].sort(),
    types,
    functions,
    typeReferences: dedupeByName(references),
    role,
    lineCount: lines.length,
    attributes: [...attributes].sort(),
    accessibilityIdentifiers,
    urlLiterals: dedupeLiterals(urlLiterals),
    analyticsEvents: dedupeLiterals(analyticsEvents),
    persistenceApis: [...persistenceApis].sort(),
    testMethods:
      role === "test" ? functions.filter((f) => /^test/.test(f.name)) : [],
  };
}

/** Keep the first occurrence of each literal value. */
function dedupeLiterals(refs: SwiftLiteralRef[]): SwiftLiteralRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.value)) return false;
    seen.add(r.value);
    return true;
  });
}

/** Keep the first occurrence of each referenced name. */
function dedupeByName(refs: SwiftTypeReference[]): SwiftTypeReference[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

/**
 * Infer a coarse architectural role from the filename first (most reliable),
 * then declaration/conformance hints.
 */
export function inferRole(
  path: string,
  types: SwiftType[],
  imports: string[] = [],
): SwiftRole {
  const base = path.split("/").pop() ?? path;
  if (/Tests?\.swift$/.test(base) || /Spec\.swift$/.test(base)) return "test";
  if (/App\.swift$/.test(base)) return "app-entry";
  if (/ViewModel\.swift$/.test(base)) return "view-model";
  if (/(View|Screen)\.swift$/.test(base)) return "view";
  if (/ViewController\.swift$/.test(base)) return "view";
  if (/Repository\.swift$/.test(base)) return "repository";
  if (/(Service|Client|API)\.swift$/.test(base)) return "service";
  if (/Scheduler\.swift$/.test(base)) return "scheduler";
  if (/Coordinator\.swift$/.test(base)) return "coordinator";
  if (/(Model|Entity|DTO)\.swift$/.test(base)) return "model";

  // Fall back to conformance/import hints.
  const conforms = types.flatMap((t) => t.inherits);
  if (conforms.includes("View")) return "view";
  if (conforms.includes("ObservableObject")) return "view-model";
  if (conforms.some((c) => c === "App")) return "app-entry";
  if (imports.includes("XCTest")) return "test";
  return "other";
}
