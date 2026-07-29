import type { DevPlan } from "../models/plan.js";
import type { EffectiveSpec } from "../models/spec.js";

/**
 * Human-readable renderers for the Dev plan artifacts (blueprint §8, §21).
 * Deterministic; no secrets flow in (inputs are the redacted Project Model +
 * config). Every render makes the NOT_REQUESTED defaults explicit (§8, §27).
 */

export function renderPlanMarkdown(plan: DevPlan): string {
  const groups = plan.groups
    .map(
      (g) =>
        `${plan.groups.indexOf(g) + 1}. ${g.name}${g.depends_on.length ? ` (depends on ${g.depends_on.join(", ")})` : ""}`,
    )
    .join("\n");
  const worktrees = plan.worktrees
    .map((w) => `- ${w.path} → ${w.branch}`)
    .join("\n");
  const overrides = plan.effective_spec.overrides.length;
  return [
    `# XForge Dev Plan: ${plan.id}`,
    "",
    `Feature: ${plan.feature}`,
    `Change id: ${plan.change_id}`,
    `Mode: ${plan.mode}`,
    "",
    "## Effective behavior",
    "",
    "- Follow docs by default",
    overrides > 0
      ? `- Apply ${overrides} user override(s)`
      : "- No user overrides",
    overrides > 0 ? "- Record overrides in Staged Spec" : "- Staged Spec: none",
    "",
    "## Sources",
    "",
    plan.effective_spec.source_docs.length > 0
      ? plan.effective_spec.source_docs.map((d) => `- ${d}`).join("\n")
      : "- Canonical Project Model",
    "",
    "## Implementation groups",
    "",
    groups || "- (none)",
    "",
    "## Worktrees",
    "",
    worktrees,
    `- ${plan.worktrees.find((w) => w.is_integration)?.path ?? plan.integration_branch} (integration)`,
    "",
    "## Impact",
    "",
    `- Affected files: ${plan.impact.affected_files.length}`,
    `- Affected features: ${plan.impact.affected_features.join(", ") || "none"}`,
    `- Regression risk: ${plan.impact.regression_risk}`,
    `- Merge-conflict risk: ${plan.impact.merge_conflict_risk}`,
    "",
    "## Default actions",
    "",
    "- Implement code",
    "- Add or update test source files if required",
    "- Static review",
    "- Create integration branch",
    "",
    "## Not requested",
    "",
    `- Build (${plan.optional_actions.build})`,
    `- Test execution (${plan.optional_actions.test})`,
    "- Simulator",
    `- UI verification (${plan.optional_actions.ui_verification})`,
    `- Performance verification (${plan.optional_actions.performance})`,
    `- Docs synchronization (${plan.optional_actions.docs_sync})`,
    "",
    plan.requires_approval.length > 0
      ? `## Requires approval\n\n${plan.requires_approval.map((a) => `- ${a}`).join("\n")}\n`
      : "",
    "## Approval status",
    "",
    "- Pending",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function renderEffectiveSpecMarkdown(spec: EffectiveSpec): string {
  const reqs =
    spec.requirements.length === 0
      ? "No documented requirements found for this feature."
      : spec.requirements
          .map(
            (r) =>
              `### ${r.id} (${r.source})\n\n${r.description}\n${
                r.acceptance_criteria.length
                  ? "\n" + r.acceptance_criteria.map((c) => `- ${c}`).join("\n")
                  : ""
              }`,
          )
          .join("\n\n");
  const diffs =
    spec.differences.length === 0
      ? "None — implementation matches canonical docs."
      : spec.differences
          .map(
            (d) =>
              `- **${d.target}**: ${d.docs_value ?? "(undocumented)"} → ${d.effective_value}`,
          )
          .join("\n");
  return [
    `# Effective Spec — ${spec.feature}`,
    "",
    "> Effective Spec = canonical docs + user overrides + approved plan.",
    "> Docs are the default source of truth; overrides apply this run only and",
    "> are recorded as Staged Spec.",
    "",
    "## Requirements",
    "",
    reqs,
    "",
    "## Differences from docs",
    "",
    diffs,
    "",
  ].join("\n");
}

export function renderTraceabilityMarkdown(plan: DevPlan): string {
  const rows = plan.effective_spec.requirements.map((r) => {
    const groups = plan.groups
      .filter((g) => g.tasks.some((t) => t.requirement_ids.includes(r.id)))
      .map((g) => g.id);
    return `| \`${r.id}\` | ${r.source} | ${groups.join(", ") || "—"} |`;
  });
  return [
    `# Requirement Traceability — ${plan.feature}`,
    "",
    "| Requirement | Source | Implementation groups |",
    "|---|---|---|",
    ...(rows.length > 0 ? rows : ["| (none) | | |"]),
    "",
  ].join("\n");
}

/** Dry-run report for `dev run --dry-run` (blueprint §5.2, master prompt). */
export function renderDryRun(plan: DevPlan): string {
  return [
    `# Dry run — ${plan.id}`,
    "",
    "No worktrees created. No source modified. This shows what a real run would do.",
    "",
    "## Branches & worktrees",
    "",
    ...plan.worktrees.map(
      (w) => `- ${w.branch}  →  ${w.path}  (base ${w.base})`,
    ),
    "",
    "## Allowed files",
    "",
    ...plan.groups.flatMap((g) =>
      g.tasks.flatMap((t) =>
        t.file_scope.map((f) => `- [${f.mode}] ${f.path}`),
      ),
    ),
    "",
    "## Default actions",
    "",
    "- Implement code",
    "- Create/update test source if required",
    "- Static review",
    "- Create integration branch",
    "",
    "## Optional actions (NOT requested)",
    "",
    `- Build: ${plan.optional_actions.build}`,
    `- Test: ${plan.optional_actions.test}`,
    `- UI verification: ${plan.optional_actions.ui_verification}`,
    `- Performance: ${plan.optional_actions.performance}`,
    `- Docs sync: ${plan.optional_actions.docs_sync}`,
    "",
  ].join("\n");
}
