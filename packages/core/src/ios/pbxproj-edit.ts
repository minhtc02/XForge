import {
  escapeRe,
  findObjectByName,
  insertIntoList,
  insertIntoSection,
  makeObjectId,
  matchingBrace,
  type PbxAnchor,
} from "./pbxproj-internals.js";

/**
 * Adding a source file to an Xcode target (optimization: remove the manual step).
 *
 * `project.pbxproj` is a graph of cross-referenced objects, not a list of files:
 * adding one source means adding a `PBXFileReference`, a `PBXBuildFile` that
 * points at it, a child entry in a `PBXGroup`, and a member of the target's
 * `PBXSourcesBuildPhase`. Get any of them wrong and Xcode refuses to open the
 * project.
 *
 * So this module is deliberately conservative:
 *
 *  - It refuses rather than guesses. Every anchor it needs is located
 *    explicitly; anything unexpected returns a reason, not a best effort.
 *  - It is idempotent. A file already referenced is left alone.
 *  - It never writes in place — {@link addFileToTarget} is pure, returning new
 *    content, so the caller can back up, verify and roll back.
 *
 * Newer projects use filesystem-synchronized groups, where a file dropped in
 * the target's folder is picked up with no project edit at all.
 * {@link usesSynchronizedGroups} detects that case, which is always preferable.
 */

/**
 * True when the project uses `PBXFileSystemSynchronizedRootGroup` — Xcode 16+
 * folder-backed targets, where adding a file to disk is enough.
 */
export function usesSynchronizedGroups(content: string): boolean {
  return content.includes("PBXFileSystemSynchronizedRootGroup");
}

/** Whether a path is already referenced anywhere in the project. */
export function referencesFile(content: string, fileName: string): boolean {
  return new RegExp(`\\b${escapeRe(fileName)}\\b`).test(content);
}

export interface AddFileResult {
  /** New file content, when the edit succeeded. */
  content?: string;
  /** Why nothing was changed. `already-present` is a success, not a failure. */
  skipped?:
    | "already-present"
    | "target-not-found"
    | "no-sources-phase"
    | "no-group"
    | "unparseable";
  /** Human-readable detail for the skip. */
  detail?: string;
}

export interface AddFileInput {
  content: string;
  /** Target that should compile the file, e.g. `MyAppUITests`. */
  targetName: string;
  /** File name as it will appear in the project, e.g. `XForgeUITests.swift`. */
  fileName: string;
  /** Path recorded on the file reference, relative to the group. */
  relativePath: string;
}

/**
 * Add a Swift source to a target. Returns new content, or a reason it declined.
 * Pure: the caller decides whether to write.
 */
export function addFileToTarget(input: AddFileInput): AddFileResult {
  const { content, targetName, fileName, relativePath } = input;

  if (referencesFile(content, fileName)) {
    return { skipped: "already-present" };
  }

  const target = findObjectByName(content, targetName, "PBXNativeTarget");
  if (!target) {
    return {
      skipped: "target-not-found",
      detail: `No PBXNativeTarget named "${targetName}"`,
    };
  }

  // The target's Sources build phase is referenced from its buildPhases list.
  const phaseIds = [
    ...target.body.matchAll(/([0-9A-Fa-f]{24})\s*\/\*\s*([^*]+?)\s*\*\//g),
  ]
    .filter((m) => /Sources/.test(m[2] ?? ""))
    .map((m) => m[1]!);
  const sourcesPhase = phaseIds
    .map((id) => findObjectById(content, id, "PBXSourcesBuildPhase"))
    .find(Boolean);
  if (!sourcesPhase) {
    return {
      skipped: "no-sources-phase",
      detail: `Target "${targetName}" has no PBXSourcesBuildPhase`,
    };
  }

  // Any main group will do for the reference to resolve; prefer the target's
  // own group when one shares its name.
  const group =
    findObjectByName(content, targetName, "PBXGroup") ?? findMainGroup(content);
  if (!group) {
    return { skipped: "no-group", detail: "No PBXGroup to attach the file to" };
  }

  const fileRefId = makeObjectId(content, fileName, "ref");
  const buildFileId = makeObjectId(content, fileName, "build");

  let next = content;

  // 1. PBXBuildFile — the "this target compiles that file" edge.
  next = insertIntoSection(
    next,
    "PBXBuildFile",
    `\t\t${buildFileId} /* ${fileName} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${fileName} */; };`,
  );
  if (next === content)
    return { skipped: "unparseable", detail: "PBXBuildFile section not found" };

  // 2. PBXFileReference — the file itself.
  const withRef = insertIntoSection(
    next,
    "PBXFileReference",
    `\t\t${fileRefId} /* ${fileName} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${relativePath}; sourceTree = "<group>"; };`,
  );
  if (withRef === next)
    return {
      skipped: "unparseable",
      detail: "PBXFileReference section not found",
    };
  next = withRef;

  // 3. Group membership — so the file is visible in the navigator.
  const withGroup = insertIntoChildren(
    next,
    group.id,
    `\t\t\t\t${fileRefId} /* ${fileName} */,`,
  );
  if (withGroup === next)
    return { skipped: "unparseable", detail: "Group children list not found" };
  next = withGroup;

  // 4. Sources build phase — so it is actually compiled.
  const withPhase = insertIntoFiles(
    next,
    sourcesPhase.id,
    `\t\t\t\t${buildFileId} /* ${fileName} in Sources */,`,
  );
  if (withPhase === next)
    return {
      skipped: "unparseable",
      detail: "Sources phase files list not found",
    };

  return { content: withPhase };
}

function findObjectById(
  content: string,
  id: string,
  isa: string,
): PbxAnchor | undefined {
  const re = new RegExp(`\\b${id}\\b[^=]*=\\s*\\{`);
  const match = re.exec(content);
  if (!match) return undefined;
  const bodyStart = match.index + match[0].length;
  const bodyEnd = matchingBrace(content, bodyStart);
  if (bodyEnd === -1) return undefined;
  const body = content.slice(bodyStart, bodyEnd);
  if (!new RegExp(`isa\\s*=\\s*${isa};`).test(body)) return undefined;
  return { id, body, start: bodyStart, end: bodyEnd };
}

/** The project's root group — the fallback place to attach a reference. */
function findMainGroup(content: string): PbxAnchor | undefined {
  const re =
    /([0-9A-Fa-f]{24})\s*(?:\/\*[^*]*\*\/\s*)?=\s*\{\s*\n?\s*isa = PBXGroup;/g;
  const match = re.exec(content);
  if (!match) return undefined;
  return findObjectById(content, match[1]!, "PBXGroup");
}

/** Insert a line at the top of a `/* Begin X section *\/` block. */
function insertIntoChildren(
  content: string,
  groupId: string,
  line: string,
): string {
  return insertIntoList(content, groupId, "children", line);
}

function insertIntoFiles(
  content: string,
  phaseId: string,
  line: string,
): string {
  return insertIntoList(content, phaseId, "files", line);
}

/**
 * A structural sanity check on an edited project. Not a parser — just enough to
 * catch the failure modes an edit can introduce: unbalanced braces, a lost
 * section, or a target that disappeared.
 */
export function verifyPbxproj(
  content: string,
  expect: { targets: number },
): { ok: boolean; reason?: string } {
  let depth = 0;
  for (const ch of content) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth < 0) return { ok: false, reason: "unbalanced braces" };
  }
  if (depth !== 0) return { ok: false, reason: "unbalanced braces" };

  for (const section of [
    "PBXBuildFile",
    "PBXFileReference",
    "PBXNativeTarget",
  ]) {
    if (!content.includes(`/* Begin ${section} section */`)) {
      return { ok: false, reason: `missing ${section} section` };
    }
  }
  const targets = (content.match(/isa = PBXNativeTarget;/g) ?? []).length;
  if (targets !== expect.targets) {
    return {
      ok: false,
      reason: `target count changed (${expect.targets} → ${targets})`,
    };
  }
  return { ok: true };
}
