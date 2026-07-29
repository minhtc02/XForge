import type { DevPlan } from "../models/plan.js";
import type { DevRun } from "../models/run.js";
import type { StagedSpec } from "../journal/staged-spec.js";

/**
 * Delivery package rendering (blueprint §21, Roadmap Phase 6). Produces the
 * human-readable run summary and a machine-readable delivery manifest listing
 * every artifact. The CLI writes these plus the JSON copies into
 * `.xforge/dev/runs/<run-id>/`. Every optional verification line reports its
 * NOT_REQUESTED status honestly — a valid success state is CODE_COMPLETED with
 * build/test/ui/performance NOT_REQUESTED (§4.1).
 */

export interface DeliveryManifest {
  schema_version: 1;
  run_id: string;
  plan_id: string;
  status: string;
  dry_run: boolean;
  files_changed: number;
  commits: number;
  integration_branch?: string;
  spec_differences_recorded: number;
  docs_synced: boolean;
  artifacts: string[];
}

export function buildDeliveryManifest(run: DevRun): DeliveryManifest {
  return {
    schema_version: 1,
    run_id: run.run_id,
    plan_id: run.plan_id,
    status: run.status,
    dry_run: run.dry_run,
    files_changed: run.changes.length,
    commits: run.commits.length,
    integration_branch: run.integration?.integration_branch,
    spec_differences_recorded: run.spec_differences_recorded,
    docs_synced: run.docs_sync === "SYNCED",
    artifacts: [
      "summary.md",
      "summary.json",
      "plan.json",
      "permission-manifest.json",
      "effective-spec.md",
      "requirement-traceability.md",
      "implementation-status.json",
      "changes/file-changes.json",
      "changes/commits.json",
      "reviews/static-code-review.md",
      "staged-spec/staged-spec.json",
      "delivery-manifest.json",
    ],
  };
}

export function renderRunSummary(
  run: DevRun,
  plan: DevPlan,
  staged?: StagedSpec,
): string {
  const testFilesAdded = run.changes.filter(
    (c) => c.change === "created" && /Tests?\.swift$/.test(c.file),
  ).length;
  const lines: string[] = [];
  lines.push("# XForge Dev Run Summary");
  lines.push("");
  lines.push(`Run: ${run.run_id}  ·  Plan: ${run.plan_id}`);
  lines.push(run.dry_run ? "_Dry run — no source modified._" : "");
  lines.push("");
  lines.push("## Development");
  lines.push("");
  lines.push(`- Status: ${run.status}`);
  if (run.integration)
    lines.push(`- Integration branch: ${run.integration.integration_branch}`);
  lines.push(`- Files changed: ${run.changes.length}`);
  lines.push(`- Commits: ${run.commits.length}`);
  if (run.integration && run.integration.conflicts.length > 0)
    lines.push(`- Merge conflicts: ${run.integration.conflicts.join(", ")}`);
  lines.push("");
  lines.push("## Static review");
  lines.push("");
  lines.push(`- Passed: ${run.static_review?.passed ? "Yes" : "No"}`);
  lines.push(`- Findings: ${run.static_review?.findings.length ?? 0}`);
  lines.push("");
  lines.push("## Build");
  lines.push("");
  lines.push(`- Status: ${run.optional_results.build}`);
  lines.push("");
  lines.push("## Tests");
  lines.push("");
  lines.push(`- Status: ${run.optional_results.test}`);
  lines.push(`- Test files added: ${testFilesAdded}`);
  lines.push(
    `- Tests executed: ${run.optional_results.test === "NOT_REQUESTED" ? "No" : "Yes"}`,
  );
  lines.push("");
  lines.push("## UI verification");
  lines.push("");
  lines.push(`- Status: ${run.optional_results.ui}`);
  lines.push(
    `- Simulator comparison executed: ${run.optional_results.ui === "NOT_REQUESTED" ? "No" : "Yes"}`,
  );
  lines.push("");
  lines.push("## Performance");
  lines.push("");
  lines.push(`- Status: ${run.optional_results.performance}`);
  lines.push("");
  lines.push("## Spec differences");
  lines.push("");
  lines.push(`- Recorded changes: ${run.spec_differences_recorded}`);
  lines.push(
    `- Synchronized to docs: ${run.docs_sync === "SYNCED" ? "Yes" : "No"}`,
  );
  if (staged)
    lines.push(
      `- Journal status: ${staged.status} (change journal, not a code gate)`,
    );
  lines.push("");
  lines.push(
    `_Feature: ${plan.feature} · change ${plan.change_id}. Optional verification is opt-in; CODE_COMPLETED with NOT_REQUESTED gates is a valid success state._`,
  );
  return lines.join("\n");
}
