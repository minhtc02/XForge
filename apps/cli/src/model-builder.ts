import { basename } from "node:path";
import {
  analyzeCoverage,
  analyzeSwiftFile,
  detectFeatures,
  detectProject,
  detectTechnologies,
  mergeTechnologies,
  hashContent,
  parsePrdDocument,
  parseProjectModel,
  readTextFileSafe,
  scanFiles,
  type AnalyzedSource,
  type Feature,
  type ProjectModel,
  type ProjectPrinciple,
  type Requirement,
  type ScannedFile,
  type SourceType,
  type Technology,
  type XForgeConfig,
} from "@xforge/core";
import { XFORGE_VERSION } from "@xforge/shared";
import type { CoverageRow } from "@xforge/core";

/**
 * Deterministic Project Model builder (blueprint §15.1) — now the full
 * pipeline: scan → Swift analysis → feature detection → PRD parsing →
 * coverage/gap analysis → validated {@link ProjectModel}.
 *
 * Everything here is deterministic and evidence-linked. Prose/semantic
 * refinement remains the LLM layer's job; this builds the structured skeleton
 * those layers enrich.
 */

export interface BuildModelResult {
  model: ProjectModel;
  files: ScannedFile[];
  fileIndex: Record<string, string>;
  matrix: CoverageRow[];
}

export async function buildProjectModel(
  projectRoot: string,
  config: XForgeConfig,
): Promise<BuildModelResult> {
  const files = await scanFiles(projectRoot, {
    exclude: [...config.exclude, `${config.output.root}/**`],
  });

  const packageSwiftEntry = files.find((f) => f.path.endsWith("Package.swift"));
  const podfileEntry = files.find((f) => basename(f.path) === "Podfile");
  const detection = detectProject(files, {
    packageSwift: packageSwiftEntry
      ? await readTextFileSafe(projectRoot, packageSwiftEntry.path)
      : null,
    podfile: podfileEntry
      ? await readTextFileSafe(projectRoot, podfileEntry.path)
      : null,
  });

  // --- Swift source analysis + file index (incremental sync §21) ---
  const fileIndex: Record<string, string> = {};
  const sourceFiles: ProjectModel["source_files"] = [];
  const analyzed: AnalyzedSource[] = [];

  for (const file of files) {
    if (file.sensitive) continue;
    const content = await readTextFileSafe(projectRoot, file.path);
    if (content === null) continue;
    fileIndex[file.path] = hashContent(content);
    if (
      file.path.endsWith(".swift") &&
      !/(^|\/)Package\.swift$/.test(file.path)
    ) {
      const analysis = analyzeSwiftFile(file.path, content);
      analyzed.push({ path: file.path, analysis });
      sourceFiles.push({
        path: file.path,
        language: "swift",
        hash: fileIndex[file.path],
        loc: analysis.lineCount,
        role: analysis.role,
      });
    }
  }

  // --- Feature detection (§13) ---
  const explicit = Object.fromEntries(
    Object.entries(config.features).map(([id, f]) => [id, { paths: f.paths }]),
  );
  const features: Feature[] = detectFeatures({ sources: analyzed, explicit });

  // --- PRD / Spec Kit / BMAD requirement parsing (§12) ---
  const requirements = await parseRequirements(projectRoot, config, files);

  // --- Coverage + gap analysis (§12) ---
  const coverage = analyzeCoverage(requirements, features);

  // --- Principles from constitution (§3.1) ---
  const principles = await parsePrinciples(projectRoot, config, files);

  // Technologies: detector-derived (dependency managers, test frameworks from
  // file structure) merged with import-derived (frameworks from Swift source).
  const technologies = mergeTechnologies(
    buildTechnologies(detection),
    detectTechnologies(analyzed),
  );

  const projectName =
    detection.packageName ??
    (detection.xcodeProjects[0]
      ? basename(detection.xcodeProjects[0]).replace(/\.xcodeproj$/, "")
      : basename(projectRoot));

  const model = parseProjectModel({
    project: {
      id: slugify(
        config.project.name === "auto" ? projectName : config.project.name,
      ),
      name: config.project.name === "auto" ? projectName : config.project.name,
      type: detection.platform === "iOS" ? "ios-application" : "unknown",
      platforms: detection.platform === "iOS" ? ["ios"] : [],
      languages: detection.languages,
    },
    principles,
    technologies,
    features: coverage.features,
    requirements: coverage.requirements,
    source_files: sourceFiles,
    gaps: coverage.gaps,
    metadata: {
      generator_version: XFORGE_VERSION,
      last_generated_at: new Date().toISOString(),
    },
  });

  return { model, files, fileIndex, matrix: coverage.matrix };
}

/** Determine which config source list a given path belongs to. */
function sourceTypeForPath(
  path: string,
  config: XForgeConfig,
): SourceType | undefined {
  if (matchesAny(path, config.sources.prd)) return "prd";
  if (matchesAny(path, config.sources.bmad)) return "bmad";
  if (matchesAny(path, config.sources.speckit)) return "speckit";
  return undefined;
}

async function parseRequirements(
  projectRoot: string,
  config: XForgeConfig,
  files: ScannedFile[],
): Promise<Requirement[]> {
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (file.sensitive || !file.path.endsWith(".md")) continue;
    // The constitution is project *rules* (§3.1), not requirements — it feeds
    // principles, not the PRD requirement set. Never mix the two truths.
    if (/constitution\.md$/i.test(file.path)) continue;
    const sourceType = sourceTypeForPath(file.path, config);
    if (!sourceType) continue;
    const content = await readTextFileSafe(projectRoot, file.path);
    if (content === null) continue;
    for (const req of parsePrdDocument({
      path: file.path,
      content,
      sourceType,
    })) {
      if (seen.has(req.id)) continue;
      seen.add(req.id);
      const { line, ...rest } = req;
      requirements.push({
        ...rest,
        evidence: [
          { file: file.path, kind: "prd", start_line: line, confidence: 0.6 },
        ],
      });
    }
  }
  return requirements;
}

async function parsePrinciples(
  projectRoot: string,
  config: XForgeConfig,
  files: ScannedFile[],
): Promise<ProjectPrinciple[]> {
  const principles: ProjectPrinciple[] = [];
  const seen = new Set<string>();
  let counter = 0;
  for (const file of files) {
    if (file.sensitive) continue;
    const isConstitution =
      matchesAny(file.path, config.sources.speckit) &&
      /constitution\.md$/i.test(file.path);
    const isClaudeMd = /(^|\/)CLAUDE\.md$/.test(file.path);
    if (!isConstitution && !isClaudeMd) continue;
    const content = await readTextFileSafe(projectRoot, file.path);
    if (content === null) continue;
    for (const line of content.split("\n")) {
      const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
      if (!m?.[1]) continue;
      counter += 1;
      const id = `principle-${String(counter).padStart(3, "0")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      principles.push({
        id,
        description: m[1],
        source_type: "constitution",
        sources: [file.path],
      });
    }
  }
  return principles;
}

function buildTechnologies(
  detection: ReturnType<typeof detectProject>,
): Technology[] {
  return [
    ...detection.ui.map((name): Technology => ({
      name,
      category: "ui",
      confidence: 0.8,
      evidence: [],
    })),
    ...detection.dependencyManagers.map((name): Technology => ({
      name,
      category: "dependency-manager",
      confidence: 0.95,
      evidence: [],
    })),
    ...detection.tests.map((name): Technology => ({
      name,
      category: "testing",
      confidence: 0.9,
      evidence: [],
    })),
  ];
}

/** Minimal glob matcher for config source globs. */
function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

function globToRegExp(glob: string): RegExp {
  // Tokenize so `**` (any depth) and `*` (single segment) are unambiguous
  // and the pattern is never built via placeholder characters.
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp("^" + out + "$");
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}
