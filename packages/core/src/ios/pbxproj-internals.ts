/**
 * Shared `project.pbxproj` primitives.
 *
 * A pbxproj is a graph of cross-referenced objects written in an old NeXT plist
 * dialect. Both the file-adding and the target-creating edits need the same
 * handful of operations over it — locate an object, find its closing brace,
 * splice a line into a section or a list, mint a fresh id — so they live here
 * rather than being reimplemented, where the two copies would drift and only
 * one would get the next bug fix.
 *
 * Everything here is pure and string-level. There is no parser: a real one
 * would be a large dependency for edits this narrow, and the operations below
 * are the ones that can be done safely by locating explicit anchors and
 * refusing when they are absent.
 */

/** Object ids in a pbxproj are 24 uppercase hex characters. */
export const ID_LENGTH = 24;

export interface PbxAnchor {
  id: string;
  body: string;
  start: number;
  end: number;
}

/** Index just past the `}` closing the block opened before `from`. */
export function matchingBrace(content: string, from: number): number {
  let depth = 1;
  for (let i = from; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locate the `<id> /* name *\/ = { ... };` block for a named object. */
export function findObjectByName(
  content: string,
  name: string,
  isa: string,
): PbxAnchor | undefined {
  const re = new RegExp(
    `([0-9A-Fa-f]{${ID_LENGTH}})\\s*\\/\\*\\s*${escapeRe(name)}\\s*\\*\\/\\s*=\\s*\\{`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matchingBrace(content, bodyStart);
    if (bodyEnd === -1) continue;
    const body = content.slice(bodyStart, bodyEnd);
    if (!new RegExp(`isa\\s*=\\s*${isa};`).test(body)) continue;
    return { id: match[1]!, body, start: bodyStart, end: bodyEnd };
  }
  return undefined;
}

/**
 * A deterministic, collision-checked object id derived from a seed. Determinism
 * matters: re-running an edit that was rolled back must mint the same ids, or
 * a half-applied change would leave two copies of the same object behind.
 */
export function makeObjectId(
  content: string,
  seed: string,
  salt: string,
): string {
  let hash = 0x811c9dc5;
  for (const ch of `${seed}:${salt}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let id = "";
  let value = hash;
  while (id.length < ID_LENGTH) {
    id += value.toString(16).toUpperCase().padStart(8, "0");
    value = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  id = id.slice(0, ID_LENGTH);
  // Extremely unlikely, but a duplicate id would corrupt the project.
  return content.includes(id) ? makeObjectId(content, seed, `${salt}!`) : id;
}

/**
 * Splice a line in just after a section's `/* Begin X section *\/` marker.
 * Returns the input unchanged when the section is absent, which the caller must
 * treat as a refusal rather than a no-op success.
 */
export function insertIntoSection(
  content: string,
  section: string,
  line: string,
): string {
  const marker = `/* Begin ${section} section */`;
  const at = content.indexOf(marker);
  if (at === -1) return content;
  const lineEnd = content.indexOf("\n", at);
  if (lineEnd === -1) return content;
  return `${content.slice(0, lineEnd + 1)}${line}\n${content.slice(lineEnd + 1)}`;
}

/** Splice a line into a named `( ... )` list inside a specific object. */
export function insertIntoList(
  content: string,
  objectId: string,
  listName: string,
  line: string,
): string {
  const object = new RegExp(`\\b${objectId}\\b[^=]*=\\s*\\{`).exec(content);
  if (!object) return content;
  const bodyStart = object.index + object[0].length;
  const bodyEnd = matchingBrace(content, bodyStart);
  if (bodyEnd === -1) return content;
  const body = content.slice(bodyStart, bodyEnd);
  const listAt = body.indexOf(`${listName} = (`);
  if (listAt === -1) return content;
  const insertAt = bodyStart + listAt + `${listName} = (`.length;
  return `${content.slice(0, insertAt)}\n${line}${content.slice(insertAt)}`;
}
