import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AlreadyExistsError,
  NotFoundError,
  ValidationError,
  type Logger,
} from "@xforge/shared";
import {
  buildSemanticTemplate,
  featureDocPath,
  loadSemanticEnrichment,
  mergeSemanticEnrichment,
  parseSemanticEnrichment,
  readProjectModel,
  semanticPath,
  semanticTemplatePath,
  statePath,
  validateSemanticEvidence,
  SEMANTIC_SECTIONS,
  type ProjectModel,
} from "@xforge/core";
import { runDocs } from "./docs.js";
import { emitResult, type CliContext } from "../context.js";

/**
 * `xforge docs semantic` and `--apply`.
 *
 * Four sections of every feature doc — user flows, business rules, error
 * handling, edge cases — need someone who can read the code and judge intent;
 * the deterministic parser only sees structure. This command is the write-back
 * path for those conclusions, split the same way as `test review` and
 * `test a11y`:
 *
 *   `docs semantic`          writes a template naming every feature and
 *                            section, with the source files each may cite.
 *   `docs semantic --apply`  validates the filled template — every documented
 *                            claim needs text and a source ref to a file the
 *                            model actually contains — merges it into
 *                            `.xforge/state/semantic-enrichment.json`, and
 *                            regenerates the affected feature docs.
 *
 * The agent fills the template; the CLI performs the merge. That split keeps
 * the write-back safe: evidence is required, and unsupported prose never
 * reaches a generated document.
 */

export interface DocsSemanticOptions {
  /** Validate and merge the filled template instead of writing one. */
  apply?: boolean;
  /** Overwrite an existing template. */
  force?: boolean;
}

export interface DocsSemanticResult {
  mode: "template" | "apply";
  templatePath: string;
  /** Features the template covers (template mode) or the patch covers (apply). */
  features: string[];
  sections: string[];
  applied?: {
    enrichmentPath: string;
    /** Sections across all features now carrying documented content. */
    documentedSections: number;
    /** Feature documents regenerated to pick up the merge. */
    regeneratedDocuments: string[];
  };
}

async function requireModel(projectRoot: string): Promise<ProjectModel> {
  if (!existsSync(statePath(projectRoot, "projectModel"))) {
    throw new NotFoundError(
      "No project model found. Run `xforge docs` first — the template is " +
        "built from the model's features.",
    );
  }
  // Evidence validation cites source files, which live in the appendices —
  // the core model alone cannot confirm them.
  return readProjectModel(projectRoot, { full: true });
}

export async function runDocsSemantic(
  ctx: CliContext,
  options: DocsSemanticOptions = {},
): Promise<DocsSemanticResult> {
  return options.apply ? apply(ctx) : template(ctx, Boolean(options.force));
}

async function template(
  ctx: CliContext,
  force: boolean,
): Promise<DocsSemanticResult> {
  const { projectRoot, logger } = ctx;
  const model = await requireModel(projectRoot);

  const path = semanticTemplatePath(projectRoot);
  if (existsSync(path) && !force) {
    throw new AlreadyExistsError(
      `A semantic template already exists at ${path}. Fill it and run ` +
        "`xforge docs semantic --apply`, or pass --force to rebuild it.",
    );
  }

  const existing = await loadSemanticEnrichment(projectRoot);
  const generatedAt = new Date().toISOString();
  const body = buildSemanticTemplate(model, existing, generatedAt);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2) + "\n", "utf8");

  const result: DocsSemanticResult = {
    mode: "template",
    templatePath: path,
    features: model.features.map((f) => f.id),
    sections: [...SEMANTIC_SECTIONS],
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderTemplate(logger, result, existing !== null),
  );
  return result;
}

async function apply(ctx: CliContext): Promise<DocsSemanticResult> {
  const { projectRoot, logger } = ctx;
  const model = await requireModel(projectRoot);

  const path = semanticTemplatePath(projectRoot);
  if (!existsSync(path)) {
    throw new NotFoundError(
      "No semantic template found. Run `xforge docs semantic` first, fill " +
        "the template, then re-run with --apply.",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new ValidationError(
      `Semantic template at ${path} is not valid JSON: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  const patch = parseSemanticEnrichment(raw);
  patch.updated_at = new Date().toISOString();

  const errors = validateSemanticEvidence(patch, model);
  if (errors.length > 0) {
    throw new ValidationError(
      "Semantic enrichment rejected — every documented claim needs evidence",
      { details: { issues: errors } },
    );
  }

  const existing = await loadSemanticEnrichment(projectRoot);
  const merged = mergeSemanticEnrichment(existing, patch);
  await writeFile(
    semanticPath(projectRoot),
    JSON.stringify(merged, null, 2) + "\n",
    "utf8",
  );

  // Regenerate only the feature docs the patch touched. `runDocs` reloads the
  // enrichment, so the merge shows up in the tree immediately.
  const documents = Object.keys(patch.features).map(featureDocPath);
  const docs = await runDocs(
    { ...ctx, json: false },
    { onlyDocuments: new Set(documents), yes: true },
  );

  let documentedSections = 0;
  for (const feature of Object.values(patch.features)) {
    for (const key of SEMANTIC_SECTIONS) {
      if (feature[key].status === "documented") documentedSections += 1;
    }
  }

  const result: DocsSemanticResult = {
    mode: "apply",
    templatePath: path,
    features: Object.keys(patch.features),
    sections: [...SEMANTIC_SECTIONS],
    applied: {
      enrichmentPath: semanticPath(projectRoot),
      documentedSections,
      regeneratedDocuments: documents.filter((d) =>
        docs.writtenFiles.some((w) => w.endsWith(d)),
      ),
    },
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderApply(logger, result),
  );
  return result;
}

function renderTemplate(
  logger: Logger,
  result: DocsSemanticResult,
  hadExisting: boolean,
): void {
  logger.success(
    `Semantic template written for ${result.features.length} feature(s)`,
  );
  process.stderr.write(
    `\n  Template: ${result.templatePath}\n` +
      (hadExisting
        ? "  Existing enrichment was prefilled — amend, don't start over.\n"
        : "") +
      "\n  Next: fill the template (each documented section needs text and\n" +
      "  source refs), then run: xforge docs semantic --apply\n",
  );
}

function renderApply(logger: Logger, result: DocsSemanticResult): void {
  const applied = result.applied;
  if (!applied) return;
  logger.success(
    `Semantic enrichment merged — ${applied.documentedSections} documented ` +
      `section(s) across ${result.features.length} feature(s)`,
  );
  process.stderr.write(
    `\n  Enrichment: ${applied.enrichmentPath}\n` +
      `  Regenerated: ${applied.regeneratedDocuments.join(", ") || "nothing (no feature docs matched)"}\n`,
  );
}
