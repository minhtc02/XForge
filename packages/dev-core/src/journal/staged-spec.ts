import { z } from "zod";
import { ValidationError } from "@xforge/shared";
import { formatZodIssues, hashContent } from "@xforge/core";
import { SpecStatus } from "../models/enums.js";
import { SpecDifference } from "../models/spec.js";

/**
 * Staged Spec change journal (blueprint §14). A journal — NOT a code gate. It
 * records differences between canonical docs and the effective behavior of a
 * run, tracks source-doc hashes for drift detection, and holds proposed doc
 * patches that are never applied automatically (§11 Spec Change Recorder,
 * §15 sync-docs/dismiss-spec).
 */

export const ProposedDocPatch = z.object({
  doc_path: z.string().min(1),
  /** Unified-diff-ish patch text; applied only via `dev sync-docs`. */
  patch: z.string().min(1),
});
export type ProposedDocPatch = z.infer<typeof ProposedDocPatch>;

export const StagedSpec = z.object({
  schema_version: z.literal(1).default(1),
  run_id: z.string().min(1),
  status: SpecStatus.default("RECORDED"),
  differences: z.array(SpecDifference).default([]),
  /** doc_path -> content hash at record time (drift detection, §15). */
  source_doc_hashes: z.record(z.string(), z.string()).default({}),
  proposed_patches: z.array(ProposedDocPatch).default([]),
  recorded_at: z.string(),
  synced_at: z.string().optional(),
});
export type StagedSpec = z.infer<typeof StagedSpec>;

export function parseStagedSpec(input: unknown): StagedSpec {
  const result = StagedSpec.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Staged spec failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

export interface RecordStagedSpecInput {
  runId: string;
  differences: SpecDifference[];
  /** doc_path -> current content, hashed for later drift detection. */
  sourceDocs?: Record<string, string>;
  recordedAt?: string;
}

/** Build a Staged Spec journal from recorded differences. */
export function recordStagedSpec(input: RecordStagedSpecInput): StagedSpec {
  const source_doc_hashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(input.sourceDocs ?? {})) {
    source_doc_hashes[path] = hashContent(content);
  }
  const staged: StagedSpec = {
    schema_version: 1,
    run_id: input.runId,
    status: input.differences.length > 0 ? "RECORDED" : "RECORDED",
    differences: input.differences,
    source_doc_hashes,
    proposed_patches: buildProposedPatches(input.differences),
    recorded_at: input.recordedAt ?? new Date().toISOString(),
  };
  return parseStagedSpec(staged);
}

/** Generate non-destructive proposed doc patches (never auto-applied). */
export function buildProposedPatches(
  differences: SpecDifference[],
): ProposedDocPatch[] {
  const byDoc = new Map<string, string[]>();
  for (const d of differences) {
    const docPath = d.doc_paths[0] ?? "docs/project/_meta/staged-spec.md";
    const line = d.docs_value
      ? `- ${d.target}: ${d.docs_value} → ${d.effective_value}`
      : `- ${d.target}: (new) ${d.effective_value}`;
    const list = byDoc.get(docPath) ?? [];
    list.push(line);
    byDoc.set(docPath, list);
  }
  return [...byDoc.entries()].map(([doc_path, lines]) => ({
    doc_path,
    patch: `# Proposed spec changes\n\n${lines.join("\n")}\n`,
  }));
}

/** Detect docs drift: has a recorded source doc changed since recording? */
export function detectDrift(
  staged: StagedSpec,
  currentDocs: Record<string, string>,
): string[] {
  const drifted: string[] = [];
  for (const [path, recordedHash] of Object.entries(staged.source_doc_hashes)) {
    const current = currentDocs[path];
    if (current === undefined) continue;
    if (hashContent(current) !== recordedHash) drifted.push(path);
  }
  return drifted;
}

/** Render the human-readable changes.md (blueprint §14 structure). */
export function renderStagedSpecMarkdown(staged: StagedSpec): string {
  const rows =
    staged.differences.length === 0
      ? "No spec differences recorded — implementation matches canonical docs."
      : staged.differences
          .map(
            (d) =>
              `- **${d.target}**: ${d.docs_value ?? "(undocumented)"} → ${d.effective_value} _(${d.source}, ${d.status})_`,
          )
          .join("\n");
  return [
    `# Staged Spec — ${staged.run_id}`,
    "",
    `Status: ${staged.status}`,
    `Recorded: ${staged.recorded_at}`,
    "",
    "> This is a change journal, not a code gate. Code can be accepted while",
    "> these remain unsynced. Sync with `xforge dev sync-docs`, or drop with",
    "> `xforge dev dismiss-spec`.",
    "",
    "## Differences",
    "",
    rows,
    "",
  ].join("\n");
}

/** Transition a journal's status (sync-docs / dismiss-spec, §15). */
export function transitionStagedSpec(
  staged: StagedSpec,
  to: "SYNCED" | "DISMISSED" | "NOT_SYNCED" | "CONFLICTED",
  at?: string,
): StagedSpec {
  return {
    ...staged,
    status: to,
    synced_at:
      to === "SYNCED" ? (at ?? new Date().toISOString()) : staged.synced_at,
  };
}
