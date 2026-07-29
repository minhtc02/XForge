import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ValidationError } from "@xforge/shared";
import { hashContent, statePath } from "@xforge/core";
import {
  buildDevPlan,
  ensureDevDirs,
  makeChangeId,
  makeDevPlanId,
  planDir,
  plansDir,
  planFilePath,
  recordStagedSpec,
  renderEffectiveSpecMarkdown,
  renderPlanMarkdown,
  renderTraceabilityMarkdown,
  resolveEffectiveSpec,
  serializeJson,
} from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";
import { collectDocFacts, loadDevModelContext } from "./shared.js";

export interface DevPlanOptions {
  feature?: string;
  request?: string;
  mode?: "plan-first" | "auto";
}

export interface DevPlanResult {
  planId: string;
  changeId: string;
  planDir: string;
  writtenFiles: string[];
  stats: {
    requirements: number;
    overrides: number;
    groups: number;
    worktrees: number;
    spec_differences: number;
  };
  optionalActions: Record<string, string>;
}

/**
 * `xforge dev plan` (blueprint §5.1, §8, master prompt §Phase 1).
 * Resolves the Effective Spec (docs + user overrides), records proposed Staged
 * Spec, builds impact analysis + implementation groups + worktree plan +
 * permission manifest, and writes the plan artifacts. It never modifies
 * production code, and marks build/test/UI/performance NOT_REQUESTED.
 */
export async function runDevPlan(
  ctx: CliContext,
  options: DevPlanOptions,
): Promise<DevPlanResult> {
  const { projectRoot, logger } = ctx;
  if (!options.feature) {
    throw new ValidationError(
      "A feature is required: xforge dev plan --feature <id>",
    );
  }

  const { model, devConfig } = await loadDevModelContext(ctx);
  const feature = model.features.find(
    (f) => f.id.toLowerCase() === options.feature!.toLowerCase(),
  );
  if (!feature) {
    throw new ValidationError(
      `Feature "${options.feature}" not found. Known: ${model.features.map((f) => f.id).join(", ") || "(none)"}.`,
    );
  }

  // Collect documented facts + doc contents for override detection + hashing.
  const { facts, docs } = await collectDocFacts(projectRoot, [
    "docs/project/**/*.md",
    "docs/**/*.md",
  ]);

  const effectiveSpec = resolveEffectiveSpec({
    feature: feature.id,
    model,
    request: options.request,
    docFacts: facts,
    sourceDocs: Object.keys(docs),
  });

  const modelStatePath = statePath(projectRoot, "projectModel");
  const projectModelHash = existsSync(modelStatePath)
    ? hashContent(await readFile(modelStatePath, "utf8"))
    : undefined;

  const { planId, changeId } = await nextIds(projectRoot, feature.id);
  const plan = buildDevPlan({
    planId,
    changeId,
    model,
    config: devConfig,
    effectiveSpec,
    feature: feature.id,
    mode: options.mode,
    usesDesign: devConfig.figma.enabled,
    inputs: {
      base_branch: devConfig.base_branch,
      config_version: 1,
      project_model_hash: projectModelHash,
      effective_spec_hash: hashContent(JSON.stringify(effectiveSpec)),
    },
  });

  const staged = recordStagedSpec({
    runId: planId,
    differences: effectiveSpec.differences,
    sourceDocs: docs,
  });

  await ensureDevDirs(projectRoot);
  await mkdir(planDir(projectRoot, planId), { recursive: true });

  const writtenFiles: string[] = [];
  const write = async (
    file: Parameters<typeof planFilePath>[2],
    content: string,
  ): Promise<void> => {
    const abs = planFilePath(projectRoot, planId, file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    writtenFiles.push(abs);
  };

  await write("plan", serializeJson(plan));
  await write("planMarkdown", renderPlanMarkdown(plan));
  await write("effectiveSpec", renderEffectiveSpecMarkdown(effectiveSpec));
  await write("effectiveSpecJson", serializeJson(effectiveSpec));
  await write("traceability", renderTraceabilityMarkdown(plan));
  await write("permissions", serializeJson(plan.permissions));
  await write("stagedSpec", serializeJson(staged));

  const result: DevPlanResult = {
    planId,
    changeId,
    planDir: planDir(projectRoot, planId),
    writtenFiles,
    stats: {
      requirements: effectiveSpec.requirements.length,
      overrides: effectiveSpec.overrides.length,
      groups: plan.groups.length,
      worktrees: plan.worktrees.length,
      spec_differences: effectiveSpec.differences.length,
    },
    optionalActions: {
      build: plan.optional_actions.build,
      test: plan.optional_actions.test,
      ui_verification: plan.optional_actions.ui_verification,
      performance: plan.optional_actions.performance,
      docs_sync: plan.optional_actions.docs_sync,
    },
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(`Dev plan created: ${planId}`);
    process.stderr.write(
      `\n  Feature:            ${feature.name}\n` +
        `  Requirements:       ${result.stats.requirements}\n` +
        `  User overrides:     ${result.stats.overrides}\n` +
        `  Implementation grps:${result.stats.groups}\n` +
        `  Worktrees planned:  ${result.stats.worktrees}\n` +
        `  Spec differences:   ${result.stats.spec_differences}\n` +
        `\n  Optional actions (all opt-in):\n` +
        `    build=${result.optionalActions.build} test=${result.optionalActions.test} ui=${result.optionalActions.ui_verification} perf=${result.optionalActions.performance} docs=${result.optionalActions.docs_sync}\n` +
        `\n  Plan: ${planFilePath(projectRoot, planId, "planMarkdown")}\n` +
        `\n  Preview a run with:\n    xforge dev run ${planId} --dry-run\n`,
    );
  });
  return result;
}

async function nextIds(
  projectRoot: string,
  feature: string,
): Promise<{ planId: string; changeId: string }> {
  const now = new Date();
  const prefix = makeDevPlanId(now, 1).slice(0, "XFDEVPLAN-YYYYMMDD".length);
  let seq = 1;
  try {
    const existing = await readdir(plansDir(projectRoot));
    seq = existing.filter((n) => n.startsWith(prefix)).length + 1;
  } catch {
    seq = 1;
  }
  return {
    planId: makeDevPlanId(now, seq),
    changeId: makeChangeId(feature, seq),
  };
}
