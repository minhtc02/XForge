import type { Feature, ProjectModel } from "@xforge/core";
import { parseDevPlan, type DevPlan } from "../models/index.js";
import type {
  ImplementationGroup,
  ImplementationTask,
  PermissionManifest,
} from "../models/plan.js";
import type { DevConfig } from "../config/schema.js";
import type { EffectiveSpec } from "../models/spec.js";
import { analyzeImpact } from "./impact.js";
import { planWorktrees } from "../worktree/planner.js";
import { findFeature } from "../spec/effective-spec.js";

/**
 * DevPlan assembly (blueprint §8, §16, master prompt §Phase 1). Pure and
 * deterministic: builds implementation groups from the feature's file roles,
 * plans isolated worktrees, and produces a permission manifest whose optional
 * verification actions are all false (build/test/UI/perf NOT_REQUESTED, §19).
 */

export interface BuildDevPlanInput {
  planId: string;
  changeId: string;
  model: ProjectModel;
  config: DevConfig;
  effectiveSpec: EffectiveSpec;
  feature: string;
  mode?: "plan-first" | "auto";
  inputs: DevPlan["inputs"];
  createdAt?: string;
  /** Whether design (figma/images) will be read (affects permission + perms). */
  usesDesign?: boolean;
}

/** Group a feature's source files into implementation groups by role. */
function buildGroups(
  feature: Feature,
  spec: EffectiveSpec,
): ImplementationGroup[] {
  const roleOf = (path: string): string => {
    if (/View\.swift$|Screen\.swift$|ViewController\.swift$/.test(path))
      return "ui";
    if (/ViewModel\.swift$/.test(path)) return "ui";
    if (/Repository\.swift$|Store\.swift$|\+CoreData|Persistence/.test(path))
      return "persistence";
    if (/Scheduler\.swift$|Service\.swift$|Client\.swift$/.test(path))
      return "domain";
    return "domain";
  };

  const buckets = new Map<string, string[]>();
  for (const file of feature.source_files) {
    const g = roleOf(file);
    const list = buckets.get(g) ?? [];
    list.push(file);
    buckets.set(g, list);
  }
  // Always ensure a domain group exists so there is at least one group.
  if (buckets.size === 0) buckets.set("domain", []);

  const reqIds = spec.requirements.map((r) => r.id);
  const order = ["domain", "persistence", "ui"];
  const groups: ImplementationGroup[] = [];
  for (const name of order) {
    const files = buckets.get(name);
    if (!files) continue;
    const tasks: ImplementationTask[] = [
      {
        id: `task-${name}`,
        description: `Implement ${name} for ${feature.name} per Effective Spec`,
        requirement_ids: reqIds,
        file_scope: files.map((f) => ({ path: f, mode: "modify" as const })),
        status: "PLANNED",
      },
    ];
    groups.push({
      id: name,
      name: `${feature.name} — ${name}`,
      // ui depends on domain+persistence; persistence depends on domain.
      depends_on:
        name === "ui"
          ? order.filter((o) => o !== "ui" && buckets.has(o))
          : name === "persistence" && buckets.has("domain")
            ? ["domain"]
            : [],
      tasks,
      shares_files: false,
    });
  }
  return groups;
}

function buildPermissions(usesDesign: boolean): PermissionManifest {
  return {
    allowed: {
      readRepository: true,
      createWorktrees: true,
      writeWorktrees: true,
      readFigma: usesDesign,
      readProvidedImages: usesDesign,
      createSourceFiles: true,
      modifySourceFiles: true,
      createTestSourceFiles: true,
      commitFeatureBranches: true,
      mergeIntoIntegrationBranch: true,
    },
    // Optional verification actions are ALWAYS opt-in (blueprint §4.1, §16, §19).
    optional: {
      runBuild: false,
      runTests: false,
      runSimulator: false,
      runUIVerification: false,
      runPerformanceVerification: false,
    },
    denied: {
      modifyMainCheckout: true,
      mergeIntoMain: true,
      forcePush: true,
      modifySigning: true,
      accessProduction: true,
      publishBuild: true,
    },
  };
}

export function buildDevPlan(input: BuildDevPlanInput): DevPlan {
  const feature = findFeature(input.model, input.feature);
  if (!feature) {
    throw new Error(
      `Feature "${input.feature}" not found in the Project Model. Known: ${
        input.model.features.map((f) => f.id).join(", ") || "(none)"
      }`,
    );
  }

  const impact = analyzeImpact({ model: input.model, feature });
  const groups = buildGroups(feature, input.effectiveSpec);

  const { worktrees, integrationBranch } = planWorktrees({
    changeId: input.changeId,
    base: input.config.base_branch,
    worktreeRootRel: input.config.worktrees.root,
    groups,
    projectRoot: ".", // paths are relative; safety checked against relative root
  });

  const usesDesign =
    input.usesDesign ??
    (input.config.figma.enabled && input.effectiveSpec.overrides.length >= 0);

  const plan: DevPlan = {
    schema_version: 1,
    id: input.planId,
    project_id: input.model.project.id,
    created_at: input.createdAt ?? new Date().toISOString(),
    mode: input.mode ?? input.config.planning.default_mode,
    feature: input.feature,
    change_id: input.changeId,
    effective_spec: input.effectiveSpec,
    impact,
    groups,
    worktrees,
    integration_branch: integrationBranch,
    permissions: buildPermissions(usesDesign),
    // The whole point of the module: nothing verification runs by default.
    optional_actions: {
      build: "NOT_REQUESTED",
      test: "NOT_REQUESTED",
      ui_verification: "NOT_REQUESTED",
      performance: "NOT_REQUESTED",
      docs_sync: "NOT_REQUIRED",
    },
    requires_approval: computeApprovalGates(input.effectiveSpec),
    inputs: input.inputs,
    confidence: feature ? 0.7 : 0.3,
  };
  return parseDevPlan(plan);
}

/** Actions that require plan approval even in auto mode (blueprint §17). */
function computeApprovalGates(spec: EffectiveSpec): string[] {
  const gates: string[] = [];
  const text = spec.differences
    .map((d) => `${d.target} ${d.effective_value}`)
    .join(" ")
    .toLowerCase();
  if (/migrat|schema/.test(text)) gates.push("database_migration");
  if (/api|public|interface/.test(text)) gates.push("public_api_change");
  if (/depend|package|pod|spm/.test(text)) gates.push("add_dependency");
  return gates;
}

/** Generate a plan id like XFDEVPLAN-20260729-001. */
export function makeDevPlanId(date: Date, sequence: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `XFDEVPLAN-${y}${m}${d}-${String(sequence).padStart(3, "0")}`;
}

/** Generate a change id like XFDEV-<feature-abbrev>. */
export function makeChangeId(feature: string, sequence: number): string {
  return `XFDEV-${String(sequence).padStart(3, "0")}-${feature.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}
