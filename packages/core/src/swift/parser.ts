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

export interface SwiftFileAnalysis {
  path: string;
  imports: string[];
  types: SwiftType[];
  functions: SwiftFunction[];
  /** Coarse role inferred from filename + declarations. */
  role: SwiftRole;
  /** For test files: modules imported with `@testable import`. */
  testableImports: string[];
  lineCount: number;
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

/** Strip generic constraints / where-clauses from an inheritance list. */
function parseInherits(raw: string | undefined): string[] {
  if (!raw) return [];
  const beforeWhere = raw.split(/\bwhere\b/)[0] ?? raw;
  return beforeWhere
    .split(",")
    .map((s) => s.trim().replace(/<.*>$/, "").trim())
    .filter((s) => s.length > 0);
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

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    // Very small comment handling so declarations in comments are ignored.
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1 && line.indexOf("*/", blockStart) === -1) {
      line = line.slice(0, blockStart);
      inBlockComment = true;
    }
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);
    if (line.trim().length === 0) continue;

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

  return {
    path,
    imports: [...imports].sort(),
    testableImports: [...testableImports].sort(),
    types,
    functions,
    role: inferRole(path, types, [...imports]),
    lineCount: lines.length,
  };
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
