import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  loadConfig,
  readProjectModel,
  readTextFileSafe,
  scanFiles,
  statePath,
  type ProjectModel,
  type XForgeConfig,
} from "@xforge/core";
import { NotFoundError } from "@xforge/shared";
import {
  loadDevConfig,
  parseDevPlan,
  parseStagedSpec,
  planFilePath,
  type DevConfig,
  type DevPlan,
  type DocFact,
  type StagedSpec,
} from "@xforge/dev-core";
import type { CliContext } from "../../context.js";

/**
 * Shared loaders for `xforge dev` commands. All reuse XForge Core (config,
 * project model, scanner, redaction) — never re-implementing discovery.
 */

export interface DevModelContext {
  model: ProjectModel;
  devConfig: DevConfig;
  /** The XForge config, so callers read doc globs instead of hardcoding them. */
  config: XForgeConfig;
}

export async function loadDevModelContext(
  ctx: CliContext,
): Promise<DevModelContext> {
  const config = await loadConfig(ctx.projectRoot); // ensures XForge is initialized
  const modelPath = statePath(ctx.projectRoot, "projectModel");
  if (!existsSync(modelPath)) {
    throw new NotFoundError(
      "No Canonical Project Model found. Run `xforge docs` first.",
      { details: { modelPath } },
    );
  }
  // Full model: reconciliation and sharding reason over individual files,
  // which live in the appendices rather than the core file.
  const model = await readProjectModel(ctx.projectRoot, { full: true });
  const devConfig = await loadDevConfig(ctx.projectRoot);
  return { model, devConfig, config };
}

/** Load a persisted plan (and its Staged Spec, if present) by id. */
export async function loadPlan(
  projectRoot: string,
  planId: string,
): Promise<{ plan: DevPlan; staged?: StagedSpec }> {
  const planPath = planFilePath(projectRoot, planId, "plan");
  if (!existsSync(planPath)) {
    throw new NotFoundError(`Plan ${planId} not found`, {
      details: { planPath },
    });
  }
  const plan = parseDevPlan(JSON.parse(await readFile(planPath, "utf8")));
  const stagedPath = planFilePath(projectRoot, planId, "stagedSpec");
  const staged = existsSync(stagedPath)
    ? parseStagedSpec(JSON.parse(await readFile(stagedPath, "utf8")))
    : undefined;
  return { plan, staged };
}

/**
 * Extract simple `key: value` doc facts from a feature's markdown docs so the
 * override detector can compare a user request against documented values.
 * Deterministic + secret-safe (skips sensitive files).
 */
export async function collectDocFacts(
  projectRoot: string,
  docGlobs: string[],
): Promise<{ facts: DocFact[]; docs: Record<string, string> }> {
  const facts: DocFact[] = [];
  const docs: Record<string, string> = {};
  const files = await scanFiles(projectRoot, { include: docGlobs });
  const factRe =
    /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]{1,60}?)\s*[:=]\s*(.+\S)\s*$/;
  for (const file of files) {
    if (file.sensitive || !file.path.endsWith(".md")) continue;
    const content = await readTextFileSafe(projectRoot, file.path);
    if (content === null) continue;
    docs[file.path] = content;
    for (const line of content.split("\n")) {
      const m = factRe.exec(line);
      if (m?.[1] && m?.[2]) {
        facts.push({
          key: m[1].trim().toLowerCase().replace(/\s+/g, " "),
          value: m[2].trim(),
          doc_path: file.path,
        });
      }
    }
  }
  return { facts, docs };
}
