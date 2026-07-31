import { basename } from "node:path";
import {
  analyzeCoverage,
  analyzeSwiftFile,
  collectAccessibilityIdentifiers,
  collectSymbols,
  frameworksByFeature,
  detectAnalyticsEvents,
  detectApiEndpoints,
  detectArchitecture,
  detectDataModels,
  detectDependencies,
  detectDocumentedFeatures,
  detectFeatures,
  detectPermissions,
  detectPersistenceEntities,
  detectProject,
  detectTechnologies,
  detectTestCases,
  featureResolver,
  mergeTechnologies,
  hashContent,
  parsePlist,
  parsePrdDocument,
  parseProjectModel,
  plistFacts,
  readTextFileSafe,
  scanFiles,
  type AnalyzedSource,
  type Assumption,
  type Feature,
  type PlistFacts,
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
  const documents: Array<{ path: string; content: string }> = [];
  const plistSources: Array<{ path: string; facts: PlistFacts }> = [];

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
      continue;
    }
    // Info.plist / entitlements (§6.2) — declared permissions & capabilities.
    if (/Info\.plist$/.test(file.path) || file.path.endsWith(".entitlements")) {
      plistSources.push({
        path: file.path,
        facts: plistFacts(parsePlist(content)),
      });
      continue;
    }
    // Hand-written docs, used for the "implemented but undocumented" report.
    if (
      file.path.endsWith(".md") &&
      matchesAny(file.path, config.sources.documents)
    ) {
      documents.push({ path: file.path, content });
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
  const coverage = analyzeCoverage(requirements, features, {
    documentedFeatures: detectDocumentedFeatures(features, documents),
  });

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

  // --- iOS entity extraction (§10) ---
  const featureOf = featureResolver(coverage.features);
  const frameworks = frameworksByFeature(analyzed, coverage.features);
  for (const f of coverage.features) {
    f.frameworks = frameworks.get(f.id) ?? [];
  }
  const dataModels = detectDataModels(analyzed, featureOf);
  const persistenceEntities = detectPersistenceEntities(analyzed, featureOf);
  const analyticsEvents = detectAnalyticsEvents(analyzed, featureOf);
  const apiEndpoints = detectApiEndpoints(analyzed, featureOf);
  const testCases = detectTestCases(analyzed, featureOf);
  const architecture = detectArchitecture(analyzed, featureOf);
  const dependencies = detectDependencies({
    packageSwift: packageSwiftEntry
      ? await readTextFileSafe(projectRoot, packageSwiftEntry.path)
      : null,
    packageSwiftPath: packageSwiftEntry?.path,
    podfile: podfileEntry
      ? await readTextFileSafe(projectRoot, podfileEntry.path)
      : null,
    podfilePath: podfileEntry?.path,
  });

  const infoPlist = plistSources.find((p) => /Info\.plist$/.test(p.path));
  const entitlements = plistSources.find((p) =>
    p.path.endsWith(".entitlements"),
  );
  const permissions = plistSources.flatMap((p) =>
    detectPermissions(p.facts, p.path, p.path),
  );
  const capabilities = [
    ...new Set(
      plistSources.flatMap((p) => p.facts.capabilities.map((c) => c.label)),
    ),
  ].sort();
  const backgroundModes = [
    ...new Set(plistSources.flatMap((p) => p.facts.backgroundModes)),
  ].sort();
  const urlSchemes = [
    ...new Set(plistSources.flatMap((p) => p.facts.urlSchemes)),
  ].sort();
  void infoPlist;
  void entitlements;

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
    symbols: collectSymbols(analyzed),
    architecture,
    data_models: dataModels,
    persistence_entities: persistenceEntities,
    permissions,
    analytics_events: analyticsEvents,
    api_endpoints: apiEndpoints,
    dependencies,
    test_cases: testCases,
    accessibility_identifiers: collectAccessibilityIdentifiers(
      analyzed,
      featureOf,
    ),
    capabilities,
    background_modes: backgroundModes,
    url_schemes: urlSchemes,
    gaps: coverage.gaps,
    assumptions: buildAssumptions({
      features: coverage.features,
      requirements: coverage.requirements,
      dataModels,
      hasPlist: plistSources.length > 0,
      hasDocuments: documents.length > 0,
    }),
    metadata: {
      generator_version: XFORGE_VERSION,
      last_generated_at: new Date().toISOString(),
    },
  });

  return { model, files, fileIndex, matrix: coverage.matrix };
}

/**
 * Record what the deterministic pipeline had to infer (§3.3, §10.1). Every
 * assumption points at something a human can confirm; nothing is invented.
 */
function buildAssumptions(input: {
  features: Feature[];
  requirements: Requirement[];
  dataModels: ProjectModel["data_models"];
  hasPlist: boolean;
  hasDocuments: boolean;
}): Assumption[] {
  const assumptions: Assumption[] = [];
  let seq = 0;
  const add = (description: string, confidence: number): void => {
    seq += 1;
    assumptions.push({
      id: `assumption-${String(seq).padStart(3, "0")}`,
      description,
      confidence,
      needs_confirmation: confidence < 0.75,
    });
  };

  // Features found only by name-prefix clustering are boundary guesses (§13.3).
  for (const f of input.features) {
    if (f.confidence <= 0.7) {
      add(
        `Feature "${f.id}" was clustered from file naming, not an explicit config or Features/ folder — confirm its boundary.`,
        f.confidence,
      );
    }
  }

  // Data models recognized only by file role, not by a conformance.
  for (const m of input.dataModels) {
    if (m.conformances.length === 0) {
      add(
        `"${m.name}" (${m.file}) is treated as a data model because of its file role, not a Codable/Identifiable conformance.`,
        0.7,
      );
    }
  }

  if (input.requirements.length === 0) {
    add(
      "No PRD requirements were found, so no as-intended behaviour could be compared against the implementation.",
      0.5,
    );
  }
  if (!input.hasPlist) {
    add(
      "No Info.plist or entitlements file was read, so declared permissions and capabilities are unknown.",
      0.5,
    );
  }
  if (!input.hasDocuments) {
    add(
      "No hand-written documents were found, so the 'implemented but undocumented' report treats every feature as undocumented.",
      0.6,
    );
  }
  return assumptions;
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
