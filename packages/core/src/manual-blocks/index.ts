/**
 * Manual content preservation (blueprint §20).
 *
 * Generated documents interleave XForge-managed regions with team-authored
 * regions marked by HTML comment fences. When regenerating a document, XForge
 * must never overwrite content inside `xforge:manual` fences.
 *
 *   <!-- xforge:manual:start -->
 *   ...team content preserved verbatim...
 *   <!-- xforge:manual:end -->
 */

export const GENERATED_START = "<!-- xforge:generated:start -->";
export const GENERATED_END = "<!-- xforge:generated:end -->";
export const MANUAL_START = "<!-- xforge:manual:start -->";
export const MANUAL_END = "<!-- xforge:manual:end -->";

export interface ManualBlock {
  /** Optional id from `<!-- xforge:manual:start id="..." -->`. */
  id?: string;
  content: string;
}

const MANUAL_BLOCK_RE =
  /<!--\s*xforge:manual:start(?:\s+id="([^"]*)")?\s*-->([\s\S]*?)<!--\s*xforge:manual:end\s*-->/g;

/** Extract all manual blocks from an existing document, keyed by index and id. */
export function extractManualBlocks(existing: string): ManualBlock[] {
  const blocks: ManualBlock[] = [];
  for (const match of existing.matchAll(MANUAL_BLOCK_RE)) {
    blocks.push({ id: match[1], content: match[2] ?? "" });
  }
  return blocks;
}

/**
 * Merge freshly generated content with the manual blocks from an existing doc.
 *
 * Strategy:
 *  - Manual blocks with an `id` are matched by id and re-inserted into the
 *    corresponding placeholder in `generated` (matched by the same id).
 *  - If the generated content has no matching placeholder for a preserved
 *    block, the preserved block is appended in a trailing "Preserved manual
 *    content" section so nothing is lost.
 */
export function mergeManualContent(
  generated: string,
  existing: string | undefined,
): string {
  if (!existing) return generated;
  const preserved = extractManualBlocks(existing);
  if (preserved.length === 0) return generated;

  const byId = new Map<string, ManualBlock>();
  const anonymous: ManualBlock[] = [];
  for (const block of preserved) {
    if (block.id) byId.set(block.id, block);
    else anonymous.push(block);
  }

  const usedIds = new Set<string>();
  let merged = generated.replace(
    MANUAL_BLOCK_RE,
    (whole, id: string | undefined, body: string) => {
      if (id && byId.has(id)) {
        usedIds.add(id);
        const kept = byId.get(id)!;
        return `${MANUAL_START.replace("-->", `id="${id}" -->`)}${kept.content}${MANUAL_END}`;
      }
      return whole.replace(body, body);
    },
  );

  const orphans = [
    ...anonymous,
    ...[...byId.entries()]
      .filter(([id]) => !usedIds.has(id))
      .map(([, block]) => block),
  ];

  if (orphans.length > 0) {
    const section = orphans
      .map(
        (b) =>
          `${b.id ? MANUAL_START.replace("-->", `id="${b.id}" -->`) : MANUAL_START}${b.content}${MANUAL_END}`,
      )
      .join("\n\n");
    merged =
      merged.trimEnd() + "\n\n## Preserved manual content\n\n" + section + "\n";
  }

  return merged;
}

/** Wrap content in a generated fence. */
export function generatedBlock(content: string): string {
  return `${GENERATED_START}\n${content}\n${GENERATED_END}`;
}

/** Create an empty, id'd manual placeholder for templates. */
export function manualPlaceholder(id: string, hint = ""): string {
  const body = hint ? `\n${hint}\n` : "\n";
  return `${MANUAL_START.replace("-->", `id="${id}" -->`)}${body}${MANUAL_END}`;
}
