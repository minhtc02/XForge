import { redactWithReport } from "@xforge/core";
import type { StaticReview, StaticReviewFinding } from "../models/run.js";
import type { ImplementationGroup } from "../models/plan.js";

/**
 * Deterministic static review (blueprint §6 Static Code Reviewer, Roadmap
 * Phase 6). This is the mechanical safety net that runs on every code run
 * regardless of opt-in verification: it flags file-scope violations, secret
 * leakage, and forbidden edits — the things that must never ship — and leaves
 * semantic/architecture judgement to the Claude reviewer agents. Pure over the
 * change set so it is fully testable and never executes code.
 */

export interface ChangedFile {
  path: string;
  /** File contents (already read); scanned for secrets only, never logged. */
  contents?: string;
}

export interface StaticReviewInput {
  changedFiles: ChangedFile[];
  groups: ImplementationGroup[];
  /** Files the plan authorised any group to write (union of file scopes). */
  allowedFiles: string[];
}

/** Paths that must never be created/edited by a dev run (master prompt §Security). */
const FORBIDDEN_PATH = [
  /(^|\/)\.env(\.|$)/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.mobileprovision$/i,
  /GoogleService-Info\.plist$/i,
  /(^|\/)Secrets\.swift$/i,
  /(^|\/)\.git\//,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.|$)/i,
];

export function reviewChanges(input: StaticReviewInput): StaticReview {
  const findings: StaticReviewFinding[] = [];
  const allowed = new Set(input.allowedFiles);

  for (const file of input.changedFiles) {
    // 1. Out-of-scope write (blocker — the plan never authorised this file).
    if (allowed.size > 0 && !allowed.has(file.path)) {
      findings.push({
        category: "scope",
        severity: "blocker",
        file: file.path,
        message: "File is outside the plan's authorised file scope.",
      });
    }
    // 2. Forbidden/sensitive path (blocker — never touched, §Security).
    if (FORBIDDEN_PATH.some((re) => re.test(file.path))) {
      findings.push({
        category: "security",
        severity: "blocker",
        file: file.path,
        message: "Edit targets a sensitive/forbidden path.",
      });
    }
    // 3. Secret leakage in contents (blocker — redaction reports a hit).
    if (file.contents) {
      const { redactions } = redactWithReport(file.contents);
      if (redactions.length > 0) {
        findings.push({
          category: "security",
          severity: "blocker",
          file: file.path,
          message: `Possible secret detected in changed file (${redactions.join(", ")}); must be removed.`,
        });
      }
    }
  }

  const passed = !findings.some((f) => f.severity === "blocker");
  return { findings, passed };
}

/** Union of every group's task file-scope paths — what the run may write. */
export function collectAllowedFiles(groups: ImplementationGroup[]): string[] {
  const set = new Set<string>();
  for (const g of groups)
    for (const t of g.tasks) for (const fs of t.file_scope) set.add(fs.path);
  return [...set];
}
