import type { StagedSpec } from "./staged-spec.js";
import { detectDrift, transitionStagedSpec } from "./staged-spec.js";

/**
 * Staged Spec → docs synchronisation (blueprint §15, Roadmap Phase 7). Docs are
 * the source of truth and are NEVER touched during a run — a spec difference is
 * synced to docs only when the user explicitly runs `xforge dev sync-docs`, and
 * only if the doc has not drifted since the difference was recorded (otherwise
 * we'd clobber a change made in the meantime). The proposed patches are appended
 * as a clearly-marked block rather than rewritten in place, so a human always
 * reviews the actual doc edit.
 */

export interface SyncDocsInput {
  staged: StagedSpec;
  /** doc_path -> current content on disk. */
  currentDocs: Record<string, string>;
  now?: string;
}

export interface SyncDocsPlan {
  /** doc_path -> new content to write (append block). Empty if nothing to do. */
  writes: Record<string, string>;
  /** Docs skipped because they drifted since recording. */
  driftedSkipped: string[];
  /** The journal after transition (SYNCED, or CONFLICTED if any drift). */
  staged: StagedSpec;
}

const SYNC_HEADER = "<!-- xforge:staged-spec sync -->";

/**
 * Compute the doc writes for a sync. Pure: it returns the new content to write
 * (the CLI performs the actual write and the git commit). Drifted docs are
 * skipped and the journal is marked CONFLICTED so the user re-reviews.
 */
export function planSyncDocs(input: SyncDocsInput): SyncDocsPlan {
  const drifted = detectDrift(input.staged, input.currentDocs);
  const writes: Record<string, string> = {};

  for (const patch of input.staged.proposed_patches) {
    if (drifted.includes(patch.doc_path)) continue;
    const current = input.currentDocs[patch.doc_path] ?? "";
    // Append (idempotent-ish): don't duplicate if the header already present.
    if (current.includes(SYNC_HEADER)) continue;
    const block = `\n\n${SYNC_HEADER}\n${patch.patch.trim()}\n`;
    writes[patch.doc_path] = current + block;
  }

  const staged =
    drifted.length > 0
      ? transitionStagedSpec(input.staged, "CONFLICTED", input.now)
      : transitionStagedSpec(input.staged, "SYNCED", input.now);

  return { writes, driftedSkipped: drifted, staged };
}

/** Dismiss a journal's spec changes without touching docs (§15). */
export function dismissStagedSpec(staged: StagedSpec): StagedSpec {
  return transitionStagedSpec(staged, "DISMISSED");
}
