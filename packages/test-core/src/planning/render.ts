import type { TestPlan } from "../models/plan.js";

/**
 * Human-readable renderers for the plan artifacts (blueprint §5.2, §23).
 * Deterministic string builders — no secrets ever flow in (inputs are the
 * already-redacted Project Model + config).
 */

export function renderPlanMarkdown(plan: TestPlan): string {
  const byType = Object.entries(plan.stats.by_type)
    .map(([k, v]) => `- ${cap(k)}: ${v}`)
    .join("\n");
  const scope = plan.scope.map((s) => `- ${s}`).join("\n") || "- (none)";
  const perms = renderPermissionsList(plan);
  return [
    `# XForge Test Plan: ${plan.id}`,
    "",
    `- Level: ${plan.level}`,
    `- Project: ${plan.project_id}`,
    `- Created: ${plan.created_at}`,
    `- Confidence: ${plan.confidence.toFixed(2)}`,
    "",
    "## Scope",
    "",
    scope,
    "",
    "## Sources",
    "",
    `- Canonical Project Model: ${plan.sources.project_model ? "Found" : "Missing"}`,
    `- PRD requirements: ${plan.sources.prd ? "Found" : "None"}`,
    `- Existing tests: ${plan.sources.existing_tests}`,
    `- Figma frames: ${plan.sources.figma_frames}`,
    `- Feature source files: ${plan.sources.feature_source_files}`,
    "",
    "## Generated",
    "",
    `- ${plan.stats.total_cases} test cases`,
    `- ${plan.stats.suites} test suites`,
    `- ${plan.stats.shards} Simulator shards`,
    "",
    "## Test categories",
    "",
    byType || "- (none)",
    "",
    "## Estimated duration",
    "",
    `- ${plan.estimated_duration.min_minutes}–${plan.estimated_duration.max_minutes} minutes`,
    "",
    "## Required access",
    "",
    perms,
    "",
    "## Production behavior modifications",
    "",
    plan.production_modifications.length === 0
      ? "- None"
      : plan.production_modifications.map((p) => `- ${p}`).join("\n"),
    "",
    "## Testability issues",
    "",
    plan.testability_issues.length === 0
      ? "- None detected"
      : plan.testability_issues
          .map((t) => `- [${t.severity}] ${t.kind}: ${t.description}`)
          .join("\n"),
    "",
    "## Approval status",
    "",
    "- Pending",
    "",
  ].join("\n");
}

function renderPermissionsList(plan: TestPlan): string {
  const p = plan.permissions;
  const lines: string[] = [];
  if (p.readRepository)
    lines.push("- Read repository source and documentation");
  if (p.readFigmaFrames) lines.push("- Read mapped Figma frames");
  if (p.createSimulators || p.eraseManagedSimulators)
    lines.push("- Create and erase XForge-managed simulators");
  if (p.runXcodebuild) lines.push("- Build application and UI tests");
  if (p.writeTestFiles) lines.push("- Add or update test-support files");
  if (p.modifyDebugTestSupport)
    lines.push("- Add DEBUG-only accessibility identifiers");
  if (p.captureArtifacts)
    lines.push("- Capture screenshots, videos, logs and xcresult bundles");
  return lines.join("\n");
}

export function renderPermissionsDoc(plan: TestPlan): string {
  return [
    `# Permissions — ${plan.id}`,
    "",
    "This plan requests the following scoped permissions. Approving the plan",
    "grants exactly these; nothing else is permitted during the run.",
    "",
    renderPermissionsList(plan),
    "",
    "## Simulators",
    "",
    "- Only XForge-managed simulators are created or erased.",
    "- User-created simulators are never touched.",
    "",
  ].join("\n");
}

export function renderTestabilityReport(plan: TestPlan): string {
  const rows =
    plan.testability_issues.length === 0
      ? "No testability issues detected."
      : plan.testability_issues
          .map(
            (t) =>
              `## ${t.id} — ${t.kind}\n\n- Severity: ${t.severity}\n- Blocks automation: ${t.blocks_automation}\n- ${t.description}\n${t.remediation ? `- Remediation: ${t.remediation}` : ""}`,
          )
          .join("\n\n");
  return [
    `# Testability Report — ${plan.id}`,
    "",
    `Mode: ${plan.testability_mode}`,
    "",
    rows,
    "",
  ].join("\n");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
