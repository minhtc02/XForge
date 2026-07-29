import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generateArchitecture,
  generateAssumptions,
  generateBuildAndRelease,
  generateCoverageDoc,
  generateEvidenceJsonl,
  generateFeatureDoc,
  generateFeatureIndex,
  generateGapsDoc,
  generateGettingStarted,
  generateOverview,
  generatePrinciples,
  generateReport,
  generateRepositoryStructure,
  generateTechnologyStack,
  generateTestingStrategy,
  generateUndocumentedCode,
  loadConfig,
  mergeManualContent,
  serializeProjectModel,
  statePath,
  type GenContext,
  type ProjectModel,
} from "@xforge/core";
import type { Logger } from "@xforge/shared";
import { buildProjectModel } from "../model-builder.js";
import { emitResult, type CliContext } from "../context.js";

export interface DocsOptions {
  focus?: string;
  prd?: string;
  input?: string;
  language?: string;
  dryRun?: boolean;
}

export interface DocsResult {
  projectRoot: string;
  dryRun: boolean;
  modelPath: string;
  fileIndexPath: string;
  writtenFiles: string[];
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

  logger.info("Building Canonical Project Model");
  const { model, fileIndex, matrix } = await buildProjectModel(
    projectRoot,
    config,
  );

  const genCtx: GenContext = {
    model,
    language: config.output.language,
    matrix,
  };
  const outRoot = config.output.root;
  const writtenFiles: string[] = [];

  const write = async (rel: string, content: string): Promise<void> => {
    if (options.dryRun) return;
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

  // Quality (§7).
  await write("quality/testing-strategy.md", generateTestingStrategy(genCtx));

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
  const modelJson = serializeProjectModel(model);
  const modelStatePath = statePath(projectRoot, "projectModel");
  const fileIndexPath = statePath(projectRoot, "fileIndex");
  const metaModelPath = join(
    projectRoot,
    outRoot,
    "_meta",
    "project-model.json",
  );
  if (!options.dryRun) {
    await writeFileEnsured(modelStatePath, modelJson);
    await writeFileEnsured(metaModelPath, modelJson);
    await writeFileEnsured(
      fileIndexPath,
      JSON.stringify(
        { files: fileIndex, generated_at: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
    await writeFileEnsured(
      join(projectRoot, outRoot, "_meta", "evidence.jsonl"),
      generateEvidenceJsonl(model),
    );
    await writeFileEnsured(
      join(projectRoot, outRoot, "_meta", "generation-report.json"),
      generateReport(model, writtenFiles),
    );
    writtenFiles.push(
      join(outRoot, "_meta", "project-model.json"),
      join(outRoot, "_meta", "evidence.jsonl"),
      join(outRoot, "_meta", "generation-report.json"),
    );
  }

  const result: DocsResult = {
    projectRoot,
    dryRun: Boolean(options.dryRun),
    modelPath: metaModelPath,
    fileIndexPath,
    writtenFiles,
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
          "- [Đối chiếu PRD](./traceability/prd-coverage.md)",
          "- [Khoảng trống triển khai](./traceability/implementation-gaps.md)",
        ]
      : [
          "- [Project overview](./project-overview.md)",
          "- [Principles](./principles.md)",
          "- [Technology stack](./technology-stack.md)",
          "- [Architecture](./architecture.md)",
          "- [Repository structure](./repository-structure.md)",
          "- [Features](./features/index.md)",
          "- [PRD coverage](./traceability/prd-coverage.md)",
          "- [Implementation gaps](./traceability/implementation-gaps.md)",
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
    `\n  Features:      ${result.stats.features}\n` +
      `  Requirements:  ${result.stats.requirements}\n` +
      `  Swift files:   ${result.stats.swiftFiles}\n` +
      `  Technologies:  ${result.stats.technologies}\n` +
      `  Gaps:          ${result.stats.gaps}\n`,
  );
  if (!result.dryRun) {
    process.stderr.write(`\n  Project model: ${result.modelPath}\n`);
    process.stderr.write(`  Wrote ${result.writtenFiles.length} files.\n`);
  }
}
