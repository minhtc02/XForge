import type { Requirement } from "../project-model/schema.js";
import type { SourceType } from "../project-model/enums.js";

/**
 * Generic PRD / Spec Kit / BMAD requirement parser (blueprint §12, Phase 6).
 *
 * Deterministic extraction only: it recognizes requirements that are already
 * ID'd (e.g. `PRD-ALARM-001`) and, for un-ID'd requirement-like headings/bullets,
 * generates stable IDs of the form `PRD-<AREA>-<NNN>`. Semantic normalization
 * (dedup, intent vs impl nuance) is refined by the product-analyst LLM agent;
 * this layer guarantees a stable, evidence-linked skeleton.
 */

const EXPLICIT_ID_RE = /\b([A-Z][A-Z0-9]+-[A-Z0-9]+-\d{1,4})\b/;
const HEADING_RE = /^#{1,6}\s+(.*\S)\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*\S)\s*$/;

export interface ParsedRequirement extends Requirement {
  /** 1-based line in the source document where the requirement was found. */
  line: number;
}

export interface PrdParseInput {
  path: string;
  content: string;
  /** Which kind of source this document is (prd/speckit/bmad/docs). */
  sourceType: SourceType;
}

/** Derive an uppercase area token from a document path (prd.md -> PRD, alarm.md -> ALARM). */
function areaFromPath(path: string): string {
  const stem = (path.split("/").pop() ?? "doc").replace(/\.[^.]+$/, "");
  const cleaned = stem
    .replace(/prd|spec|requirements?/gi, "")
    .replace(/[^a-z0-9]+/gi, "");
  return (cleaned || "PRD").toUpperCase().slice(0, 12);
}

/** Extract the trailing area of an explicit id `PRD-ALARM-001` -> `ALARM`. */
export function requirementArea(id: string): string | undefined {
  const parts = id.split("-");
  return parts.length >= 3 ? parts[parts.length - 2] : undefined;
}

/**
 * Heuristic: does a line describe a requirement? Requirement bullets/headings
 * tend to use modal/normative verbs. Kept conservative to avoid noise.
 */
const REQUIREMENT_HINT =
  /\b(must|shall|should|can|able to|support|allow|require|cho phép|có thể|phải|hỗ trợ)\b/i;

/** Parse one document into requirements. */
export function parsePrdDocument(input: PrdParseInput): ParsedRequirement[] {
  const lines = input.content.split("\n");
  const area = areaFromPath(input.path);
  const requirements: ParsedRequirement[] = [];
  const seenIds = new Set<string>();
  let counter = 0;

  // Track the nearest preceding explicit id heading so a following paragraph
  // can attach to it (common PRD shape: `## PRD-ALARM-001\n<description>`).
  let pendingId: { id: string; line: number } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (line.length === 0) continue;

    const explicit = EXPLICIT_ID_RE.exec(line);
    const heading = HEADING_RE.exec(raw);
    const bullet = BULLET_RE.exec(raw);

    // Case A: a heading that is itself an explicit id -> description follows.
    if (heading && explicit && heading[1]!.trim() === explicit[1]) {
      // Flush a previous id-heading that never got a description body (e.g. two
      // id headings in a row) so it is not silently dropped; use its id as the
      // description fallback.
      if (pendingId && !seenIds.has(pendingId.id)) {
        seenIds.add(pendingId.id);
        requirements.push(
          makeRequirement(
            pendingId.id,
            pendingId.id,
            input.sourceType,
            pendingId.line,
          ),
        );
      }
      pendingId = { id: explicit[1]!, line: i + 1 };
      continue;
    }

    // A pending id gets its description from the first following text line.
    if (pendingId && !heading) {
      const id = pendingId.id;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        requirements.push(
          makeRequirement(id, line, input.sourceType, pendingId.line),
        );
      }
      pendingId = undefined;
      continue;
    }
    pendingId = undefined;

    // Case B: an inline explicit id anywhere on the line.
    if (explicit) {
      const id = explicit[1]!;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const description =
        line
          .replace(explicit[1]!, "")
          .replace(/^[\s:.\-–]+/, "")
          .trim() || line;
      requirements.push(
        makeRequirement(id, description, input.sourceType, i + 1),
      );
      continue;
    }

    // Case C: requirement-like bullet/heading without an id -> generate one.
    const text = bullet?.[1] ?? heading?.[1];
    if (text && REQUIREMENT_HINT.test(text)) {
      counter += 1;
      const id = `${uniquePrefix(input.sourceType)}-${area}-${String(counter).padStart(3, "0")}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      requirements.push(makeRequirement(id, text, input.sourceType, i + 1));
    }
  }

  // Flush a trailing id-heading that ended the document with no body line.
  if (pendingId && !seenIds.has(pendingId.id)) {
    requirements.push(
      makeRequirement(
        pendingId.id,
        pendingId.id,
        input.sourceType,
        pendingId.line,
      ),
    );
  }

  return requirements;
}

function uniquePrefix(sourceType: SourceType): string {
  switch (sourceType) {
    case "speckit":
      return "SPEC";
    case "bmad":
      return "PRD";
    default:
      return "PRD";
  }
}

function makeRequirement(
  id: string,
  description: string,
  sourceType: SourceType,
  line: number,
): ParsedRequirement {
  return {
    id,
    description,
    source_type: sourceType,
    implementation_status: "UNKNOWN",
    confidence: 0.6,
    evidence: [],
    line,
  };
}
