import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildDependencyGraph,
  buildModelDigest,
  buildFeatureMap,
  buildGenerationState,
  buildRequirementMap,
  generateAccessibilityDoc,
  generateAnalyticsDoc,
  generateApiDoc,
  generateArchitecture,
  generateAssumptions,
  generateBuildAndRelease,
  generateCoverageDoc,
  generateDataModelsDoc,
  generateEvidenceJsonl,
  generateFeatureDoc,
  generateFeatureIndex,
  generateGapsDoc,
  generateGettingStarted,
  generateMigrationsDoc,
  generateNotificationsDoc,
  generateOverview,
  generatePerformanceDoc,
  generatePersistenceDoc,
  generatePrinciples,
  generateReport,
  generateRepositoryStructure,
  generateSecurityDoc,
  generateTechnologyStack,
  generateTestingStrategy,
  generateThirdPartyDoc,
  generateUndocumentedCode,
  loadConfig,
  mergeManualContent,
  serializeModelDigest,
  serializeProjectModel,
  splitProjectModel,
  statePath,
  writeProjectModel,
  type DocsSource,
  type GenContext,
  type ProjectModel,
  type XForgeConfig,
} from "@xforge/core";
import type { Logger } from "@xforge/shared";
import { buildProjectModel } from "../model-builder.js";
import { canPrompt, selectOne } from "../prompt.js";
import { emitResult, type CliContext } from "../context.js";

export interface DocsOptions {
  focus?: string;
  prd?: string;
  input?: string;
  language?: string;
  dryRun?: boolean;
  /**
   * Which truth to lead with. Undefined means "not specified on the command
   * line" — the configured default applies, confirmed interactively when the
   * terminal allows it.
   */
  source?: DocsSource;
  /** Skip the source confirmation prompt (CI, scripts, `docs sync`). */
  yes?: boolean;
  /**
   * Restrict writes to these output-relative document paths (blueprint §21).
   * `_meta` artifacts and state files are always written — they *are* the model.
   */
  onlyDocuments?: ReadonlySet<string>;
}

export interface DocsResult {
  projectRoot: string;
  dryRun: boolean;
  /** Which truth this run led with. */
  source: DocsSource;
  /** Where the project's own documents were read from, when they were. */
  projectDocGlobs: string[];
  /** How many project documents the run actually found. */
  projectDocCount: number;
  modelPath: string;
  fileIndexPath: string;
  writtenFiles: string[];
  skippedDocuments: number;
  /** Whether `_meta/project-model.json` carries the inventories too. */
  publishedFullModel: boolean;
  /** The agent-facing digest: read this before the model. */
  digestPath: string;
  stats: {
    features: number;
    requirements: number;
    swiftFiles: number;
    technologies: number;
    gaps: number;
  };
  focus?: string;
}

/**
 * Decide which truth `docs` leads with, asking when it is safe to ask.
 *
 * The order is: an explicit `--from-docs` / `--from-code` always wins; then
 * `--yes` or a non-interactive context takes the configured default silently;
 * otherwise the user confirms. The prompt exists because the two answers
 * produce genuinely different documentation, and the configured default is
 * only a guess about which one this particular run wants.
 */
async function resolveDocsSource(
  ctx: CliContext,
  config: XForgeConfig,
  options: DocsOptions,
): Promise<DocsSource> {
  const configured = config.generation.docs_source;
  if (options.source) return options.source;
  if (options.yes || !canPrompt(ctx)) return configured;

  return selectOne<DocsSource>(
    "Which source should this documentation be built from?",
    [
      {
        value: "project-docs",
        label: "Project documents",
        hint: `— ${config.sources.project_docs.join(", ")} lead; code supplies evidence`,
      },
      {
        value: "code",
        label: "Source code",
        hint: "— the repository leads; project documents are secondary",
      },
    ],
    configured === "project-docs" ? 0 : 1,
  );
}

/**
 * `xforge docs` (blueprint §5.3, §7, §24.2).
 *
 * Runs the full deterministic pipeline and writes the documentation tree:
 * overview, principles, technology stack, architecture (+Mermaid), repository
 * structure, per-feature docs, and traceability (coverage + gaps), plus the
 * `_meta` artifacts (project-model.json, evidence.jsonl, generation-report.json).
 * Every write preserves manual blocks (§20).
 */
export async function runDocs(
  ctx: CliContext,
  options: DocsOptions,
): Promise<DocsResult> {
  const { projectRoot, logger } = ctx;
  const config = await loadConfig(projectRoot);
  if (options.language) config.output.language = options.language;

  // Which truth leads. An explicit flag wins; otherwise the configured default
  // is *confirmed* rather than assumed, because generating a whole tree from
  // the wrong source is expensive to notice and annoying to undo. In CI or
  // under --json there is no one to ask, so the configured value stands.
  const source = await resolveDocsSource(ctx, config, options);

  const projectDocGlobs = config.sources.project_docs;

  logger.info("Building Canonical Project Model", { source });
  const { model, fileIndex, matrix, projectDocCount } = await buildProjectModel(
    projectRoot,
    config,
    { docsSource: source },
  );

  // Leading with documents that do not exist would silently degrade to a
  // code-only run and label it "from docs" — say so instead.
  if (source === "project-docs" && projectDocCount === 0) {
    logger.warn(
      `No project documents found under ${projectDocGlobs.join(", ")}. ` +
        "The documentation will describe what the code does, not what it was " +
        "meant to do. Add your PRD/specs there, or re-run with --from-code.",
    );
  }

  // A missing PRD is reported, never prompted for: requirement authoring
  // belongs to the user's own PRD/Spec Kit/BMAD workflow, not to a doc
  // generation run. The only question `docs` asks is which source to lead with.
  if (model.requirements.length === 0) {
    logger.warn(
      "No PRD requirements found — traceability will be empty. Add a PRD " +
        "matching `sources.prd` in .xforge/config.yaml, then re-run.",
    );
  }

  const genCtx: GenContext = {
    model,
    language: config.output.language,
    matrix,
  };
  const outRoot = config.output.root;
  const writtenFiles: string[] = [];
  let skippedDocuments = 0;

  const write = async (rel: string, content: string): Promise<void> => {
    if (options.dryRun) return;
    if (options.onlyDocuments && !options.onlyDocuments.has(rel)) {
      skippedDocuments += 1;
      return;
    }
    const abs = join(projectRoot, outRoot, rel);
    const existing =
      config.generation.preserve_manual_blocks && existsSync(abs)
        ? await readFile(abs, "utf8")
        : undefined;
    await writeFileEnsured(abs, mergeManualContent(content, existing));
    writtenFiles.push(join(outRoot, rel));
  };

  // Core docs (§7).
  await write(
    "index.md",
    renderIndexDoc(model, config.output.language, options.focus),
  );
  await write("project-overview.md", generateOverview(genCtx));
  await write("principles.md", generatePrinciples(genCtx));
  await write("technology-stack.md", generateTechnologyStack(genCtx));
  await write("architecture.md", generateArchitecture(genCtx));
  await write("repository-structure.md", generateRepositoryStructure(genCtx));
  await write("getting-started.md", generateGettingStarted(genCtx));
  await write("build-and-release.md", generateBuildAndRelease(genCtx));

  // Data (§7).
  await write("data/data-models.md", generateDataModelsDoc(genCtx));
  await write("data/persistence.md", generatePersistenceDoc(genCtx));
  await write("data/migrations.md", generateMigrationsDoc(genCtx));

  // Integrations (§7).
  await write("integrations/api.md", generateApiDoc(genCtx));
  await write(
    "integrations/notifications.md",
    generateNotificationsDoc(genCtx),
  );
  await write("integrations/analytics.md", generateAnalyticsDoc(genCtx));
  await write(
    "integrations/third-party-services.md",
    generateThirdPartyDoc(genCtx),
  );

  // Quality (§7).
  await write("quality/testing-strategy.md", generateTestingStrategy(genCtx));
  await write("quality/security.md", generateSecurityDoc(genCtx));
  await write("quality/accessibility.md", generateAccessibilityDoc(genCtx));
  await write("quality/performance.md", generatePerformanceDoc(genCtx));

  // Feature docs (§8).
  await write("features/index.md", generateFeatureIndex(genCtx));
  for (const feature of model.features) {
    await write(
      `features/${feature.id}.md`,
      generateFeatureDoc(feature, genCtx),
    );
  }

  // Traceability (§12).
  await write("traceability/prd-coverage.md", generateCoverageDoc(genCtx));
  await write("traceability/implementation-gaps.md", generateGapsDoc(genCtx));
  await write(
    "traceability/undocumented-code.md",
    generateUndocumentedCode(genCtx),
  );

  // Meta assumptions doc (§7).
  await write("_meta/assumptions.md", generateAssumptions(genCtx));

  // _meta artifacts + persisted state.
  const fileIndexPath = statePath(projectRoot, "fileIndex");
  const metaModelPath = join(
    projectRoot,
    outRoot,
    "_meta",
    "project-model.json",
  );
  const generatedAt = new Date().toISOString();
  if (!options.dryRun) {
    // Working state is split — a small core the agent opens, plus per-file
    // appendices — so reading the model never costs a whole repository's worth
    // of tokens.
    await writeProjectModel(projectRoot, model);

    // The published tree is a different audience: a human or a tool that has
    // only `docs/` should not have to reassemble four files. So `_meta` carries
    // the complete model by default, and the split stays an implementation
    // detail of `.xforge/state/`.
    await writeFileEnsured(
      metaModelPath,
      serializeProjectModel(
        config.generation.publish_full_model
          ? model
          : splitProjectModel(model).core,
      ),
    );

    // The digest is what an agent should open first: a few KB that says what
    // exists and where to look, instead of the whole model.
    const digest = serializeModelDigest(buildModelDigest(model));
    await writeFileEnsured(statePath(projectRoot, "modelDigest"), digest);
    await writeFileEnsured(
      join(projectRoot, outRoot, "_meta", "summary.json"),
      digest,
    );
    await writeFileEnsured(
      fileIndexPath,
      JSON.stringify({ files: fileIndex, generated_at: generatedAt }, null, 2) +
        "\n",
    );
    await writeFileEnsured(
      join(projectRoot, outRoot, "_meta", "evidence.jsonl"),
      generateEvidenceJsonl(model),
    );
    await writeFileEnsured(
      join(projectRoot, outRoot, "_meta", "generation-report.json"),
      generateReport(model, writtenFiles),
    );

    // Remaining §19 state files. These are what make `docs sync` incremental:
    // the dependency graph maps a changed source file to the documents it
    // invalidates, so the next sync rewrites only those.
    const stateFiles: Array<[Parameters<typeof statePath>[1], unknown]> = [
      ["dependencyGraph", buildDependencyGraph(model, generatedAt)],
      ["featureMap", buildFeatureMap(model, generatedAt)],
      ["requirementMap", buildRequirementMap(model, generatedAt)],
      [
        "generationState",
        buildGenerationState({
          model,
          writtenFiles,
          generatedAt,
          fileCount: Object.keys(fileIndex).length,
          scoped: options.onlyDocuments
            ? [...options.onlyDocuments].sort()
            : undefined,
        }),
      ],
    ];
    for (const [key, value] of stateFiles) {
      await writeFileEnsured(
        statePath(projectRoot, key),
        JSON.stringify(value, null, 2) + "\n",
      );
    }

    writtenFiles.push(
      join(outRoot, "_meta", "project-model.json"),
      join(outRoot, "_meta", "summary.json"),
      join(outRoot, "_meta", "evidence.jsonl"),
      join(outRoot, "_meta", "generation-report.json"),
    );
  }

  const result: DocsResult = {
    projectRoot,
    dryRun: Boolean(options.dryRun),
    source,
    projectDocGlobs,
    projectDocCount,
    modelPath: metaModelPath,
    fileIndexPath,
    publishedFullModel: config.generation.publish_full_model,
    digestPath: statePath(projectRoot, "modelDigest"),
    writtenFiles,
    skippedDocuments,
    stats: {
      features: model.features.length,
      requirements: model.requirements.length,
      swiftFiles: model.source_files.length,
      technologies: model.technologies.length,
      gaps: model.gaps.length,
    },
    focus: options.focus,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderDocsSummary(logger, result),
  );
  return result;
}

async function writeFileEnsured(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function renderIndexDoc(
  model: ProjectModel,
  language: string,
  focus?: string,
): string {
  const heading =
    language === "vi" ? "Tài liệu dự án" : "Project Documentation";
  const links =
    language === "vi"
      ? [
          "- [Tổng quan dự án](./project-overview.md)",
          "- [Nguyên tắc dự án](./principles.md)",
          "- [Ngăn xếp công nghệ](./technology-stack.md)",
          "- [Kiến trúc](./architecture.md)",
          "- [Cấu trúc repository](./repository-structure.md)",
          "- [Tính năng](./features/index.md)",
          "- [Mô hình dữ liệu](./data/data-models.md)",
          "- [Lưu trữ](./data/persistence.md)",
          "- [Migration dữ liệu](./data/migrations.md)",
          "- [API & endpoint](./integrations/api.md)",
          "- [Thông báo](./integrations/notifications.md)",
          "- [Analytics](./integrations/analytics.md)",
          "- [Dịch vụ bên thứ ba](./integrations/third-party-services.md)",
          "- [Chiến lược kiểm thử](./quality/testing-strategy.md)",
          "- [Bảo mật & quyền riêng tư](./quality/security.md)",
          "- [Khả năng tiếp cận](./quality/accessibility.md)",
          "- [Hiệu năng](./quality/performance.md)",
          "- [Đối chiếu PRD](./traceability/prd-coverage.md)",
          "- [Khoảng trống triển khai](./traceability/implementation-gaps.md)",
          "- [Code chưa tài liệu hóa](./traceability/undocumented-code.md)",
        ]
      : [
          "- [Project overview](./project-overview.md)",
          "- [Principles](./principles.md)",
          "- [Technology stack](./technology-stack.md)",
          "- [Architecture](./architecture.md)",
          "- [Repository structure](./repository-structure.md)",
          "- [Features](./features/index.md)",
          "- [Data models](./data/data-models.md)",
          "- [Persistence](./data/persistence.md)",
          "- [Migrations](./data/migrations.md)",
          "- [API & endpoints](./integrations/api.md)",
          "- [Notifications](./integrations/notifications.md)",
          "- [Analytics](./integrations/analytics.md)",
          "- [Third-party services](./integrations/third-party-services.md)",
          "- [Testing strategy](./quality/testing-strategy.md)",
          "- [Security & privacy](./quality/security.md)",
          "- [Accessibility](./quality/accessibility.md)",
          "- [Performance](./quality/performance.md)",
          "- [PRD coverage](./traceability/prd-coverage.md)",
          "- [Implementation gaps](./traceability/implementation-gaps.md)",
          "- [Undocumented code](./traceability/undocumented-code.md)",
        ];
  return [
    "---",
    "generated_by: xforge",
    `generator_version: ${model.metadata.generator_version}`,
    `last_generated_at: ${new Date().toISOString()}`,
    "manual_sections_preserved: true",
    "---",
    "",
    `# ${model.project.name} — ${heading}`,
    "",
    "<!-- xforge:generated:start -->",
    language === "vi"
      ? "Bộ tài liệu này được XForge biên dịch từ source code, tests, config và tài liệu dự án."
      : "This documentation set is compiled by XForge from source code, tests, config and project docs.",
    focus ? `\nFocus: ${focus}\n` : "",
    ...links,
    "<!-- xforge:generated:end -->",
    "",
    '<!-- xforge:manual:start id="intro" -->',
    "<!-- xforge:manual:end -->",
    "",
  ].join("\n");
}

function renderDocsSummary(logger: Logger, result: DocsResult): void {
  if (result.dryRun) {
    logger.info("Dry run — no files written");
  } else {
    logger.success("Documentation generated");
  }
  process.stderr.write(
    `\n  Source:        ${
      result.source === "project-docs"
        ? `project documents (${result.projectDocCount} found)`
        : "source code"
    }\n` +
      `  Features:      ${result.stats.features}\n` +
      `  Requirements:  ${result.stats.requirements}\n` +
      `  Swift files:   ${result.stats.swiftFiles}\n` +
      `  Technologies:  ${result.stats.technologies}\n` +
      `  Gaps:          ${result.stats.gaps}\n`,
  );
  if (!result.dryRun) {
    process.stderr.write(
      `\n  Project model: ${result.modelPath}` +
        `${result.publishedFullModel ? " (complete)" : " (core only)"}\n` +
        `  Digest:        ${result.digestPath} — read this first\n` +
        `  Wrote ${result.writtenFiles.length} files.\n`,
    );
    process.stderr.write(
      "\n  Next:\n" +
        `    xforge test plan   # plan, generate and approve QA for ${result.stats.features} feature(s)\n` +
        "    xforge docs check  # in CI: fail when documentation drifts\n",
    );
  }
}
