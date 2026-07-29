import type {
  Evidence,
  Feature,
  ProjectModel,
} from "../project-model/schema.js";
import type { CoverageRow } from "../prd/coverage.js";
import { generatedBlock } from "../manual-blocks/index.js";
import { featureOverviewDiagram } from "./mermaid.js";

/**
 * Markdown document generators (blueprint §5, §7, §8).
 *
 * Each generator returns a full document string with frontmatter + a generated
 * fence. Content is derived exclusively from the Project Model, and every
 * important implementation claim is followed by a source reference so docs are
 * evidence-first (§3.2). Language is selectable (vi/en) for headings.
 */

export interface GenContext {
  model: ProjectModel;
  language: string;
  matrix?: CoverageRow[];
  sourceCommit?: string;
}

const T = {
  vi: {
    overview: "Tổng quan dự án",
    techStack: "Ngăn xếp công nghệ",
    architecture: "Kiến trúc",
    repoStructure: "Cấu trúc repository",
    principles: "Nguyên tắc dự án",
    features: "Tính năng",
    status: "Trạng thái",
    confidence: "Độ tin cậy",
    sources: "Nguồn",
    entryPoints: "Điểm vào",
    sourceFiles: "File nguồn",
    requirements: "Yêu cầu (PRD)",
    tests: "Kiểm thử",
    notDetected: "Chưa phát hiện",
    coverage: "Đối chiếu PRD",
    gaps: "Khoảng trống triển khai",
    languages: "Ngôn ngữ",
    platforms: "Nền tảng",
    gettingStarted: "Bắt đầu",
    buildRelease: "Build & phát hành",
    testingStrategy: "Chiến lược kiểm thử",
    undocumented: "Code chưa tài liệu hóa",
    assumptions: "Giả định",
    testedFeatures: "Tính năng có test",
    untestedFeatures: "Tính năng chưa có test",
    prerequisites: "Yêu cầu tiên quyết",
  },
  en: {
    overview: "Project Overview",
    techStack: "Technology Stack",
    architecture: "Architecture",
    repoStructure: "Repository Structure",
    principles: "Project Principles",
    features: "Features",
    status: "Status",
    confidence: "Confidence",
    sources: "Sources",
    entryPoints: "Entry points",
    sourceFiles: "Source files",
    requirements: "Requirements (PRD)",
    tests: "Tests",
    notDetected: "Not detected",
    coverage: "PRD Coverage",
    gaps: "Implementation Gaps",
    languages: "Languages",
    platforms: "Platforms",
    gettingStarted: "Getting Started",
    buildRelease: "Build & Release",
    testingStrategy: "Testing Strategy",
    undocumented: "Undocumented Code",
    assumptions: "Assumptions",
    testedFeatures: "Tested features",
    untestedFeatures: "Untested features",
    prerequisites: "Prerequisites",
  },
} as const;

type Labels = Record<keyof (typeof T)["en"], string>;

function t(language: string): Labels {
  return language === "vi" ? T.vi : T.en;
}

export function frontmatter(
  model: ProjectModel,
  extra: Record<string, string | number | boolean> = {},
): string {
  const fields: Record<string, string | number | boolean> = {
    generated_by: "xforge",
    generator_version: model.metadata.generator_version,
    last_generated_at:
      model.metadata.last_generated_at ?? new Date().toISOString(),
    manual_sections_preserved: true,
    ...(model.metadata.source_commit
      ? { source_commit: model.metadata.source_commit }
      : {}),
    ...extra,
  };
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

/** Render an evidence pointer as `path:start-end`. */
export function evidenceRef(e: Evidence): string {
  if (e.start_line && e.end_line)
    return `${e.file}:${e.start_line}-${e.end_line}`;
  if (e.start_line) return `${e.file}:${e.start_line}`;
  return e.file;
}

function sourcesBlock(label: string, evidence: Evidence[]): string {
  if (evidence.length === 0) return "";
  const items = evidence.map(
    (e) =>
      `- \`${evidenceRef(e)}\`${e.description ? ` — ${e.description}` : ""}`,
  );
  return `\n**${label}:**\n\n${items.join("\n")}\n`;
}

function doc(model: ProjectModel, title: string, body: string): string {
  return `${frontmatter(model)}\n# ${title}\n\n${generatedBlock(body.trim())}\n`;
}

export function generateOverview(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const p = model.project;
  const body = [
    `**${p.name}**`,
    "",
    `- ${tr.platforms}: ${p.platforms.join(", ") || tr.notDetected}`,
    `- ${tr.languages}: ${p.languages.join(", ") || tr.notDetected}`,
    `- ${tr.features}: ${model.features.length}`,
    `- ${tr.requirements}: ${model.requirements.length}`,
    "",
    model.features.length > 0
      ? model.features
          .map(
            (f) =>
              `- **${f.name}** — ${f.status} (${tr.confidence} ${f.confidence.toFixed(2)})`,
          )
          .join("\n")
      : tr.notDetected,
  ].join("\n");
  return doc(model, `${p.name} — ${tr.overview}`, body);
}

export function generateTechnologyStack(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const byCategory = new Map<string, string[]>();
  for (const tech of model.technologies) {
    const list = byCategory.get(tech.category) ?? [];
    list.push(tech.name);
    byCategory.set(tech.category, list);
  }
  const body =
    byCategory.size === 0
      ? tr.notDetected
      : [...byCategory.entries()]
          .map(
            ([cat, names]) =>
              `## ${cat}\n\n${names.map((n) => `- ${n}`).join("\n")}`,
          )
          .join("\n\n");
  return doc(model, tr.techStack, body);
}

export function generateArchitecture(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body = [
    featureOverviewDiagram(model.project.name, model.features),
    "",
    model.features
      .map((f) => {
        const roles = f.entry_points
          .map((e) => `${e.name} (${e.kind ?? "?"})`)
          .join(", ");
        return `- **${f.name}**: ${roles || tr.notDetected}`;
      })
      .join("\n"),
  ].join("\n");
  return doc(model, tr.architecture, body);
}

export function generatePrinciples(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body =
    model.principles.length === 0
      ? tr.notDetected
      : model.principles
          .map(
            (pr) =>
              `## ${pr.id}\n\n${pr.description}\n\n**${tr.sources}:** ${pr.sources.map((s) => `\`${s}\``).join(", ") || `(${pr.source_type})`}`,
          )
          .join("\n\n");
  return doc(model, tr.principles, body);
}

export function generateRepositoryStructure(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  // Aggregate source files into a directory tree summary.
  const dirs = new Map<string, number>();
  for (const sf of model.source_files) {
    const dir = sf.path.split("/").slice(0, -1).join("/") || ".";
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  const rows = [...dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, count]) => `- \`${dir}/\` — ${count} Swift file(s)`);
  const body = rows.length === 0 ? tr.notDetected : rows.join("\n");
  return doc(model, tr.repoStructure, body);
}

/** A single feature document following the §8 section structure. */
export function generateFeatureDoc(feature: Feature, ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const reqs = model.requirements.filter((r) =>
    feature.requirements.includes(r.id),
  );
  const testEvidence = feature.evidence.filter((e) => e.kind === "test");

  const sections: Array<[string, string]> = [
    [
      tr.status,
      `${feature.status} (${tr.confidence} ${feature.confidence.toFixed(2)})`,
    ],
    [
      tr.entryPoints,
      feature.entry_points.length > 0
        ? feature.entry_points
            .map((e) => `- \`${e.name}\`${e.file ? ` — \`${e.file}\`` : ""}`)
            .join("\n")
        : tr.notDetected,
    ],
    [
      tr.sourceFiles,
      feature.source_files.length > 0
        ? feature.source_files.map((f) => `- \`${f}\``).join("\n")
        : tr.notDetected,
    ],
    [
      tr.requirements,
      reqs.length > 0
        ? reqs
            .map(
              (r) =>
                `- \`${r.id}\` — ${r.description} (${r.implementation_status})`,
            )
            .join("\n")
        : tr.notDetected,
    ],
    [
      tr.tests,
      testEvidence.length > 0
        ? testEvidence.map((e) => `- \`${evidenceRef(e)}\``).join("\n")
        : tr.notDetected,
    ],
  ];

  const body = [
    sections.map(([h, v]) => `## ${h}\n\n${v}`).join("\n\n"),
    sourcesBlock(tr.sources, feature.evidence),
  ].join("\n");

  return `${frontmatter(model, { feature: feature.id, confidence: feature.confidence })}\n# ${feature.name}\n\n${generatedBlock(body.trim())}\n\n<!-- xforge:manual:start id="${feature.id}-notes" -->\n<!-- xforge:manual:end -->\n`;
}

export function generateFeatureIndex(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body =
    model.features.length === 0
      ? tr.notDetected
      : model.features
          .map(
            (f) =>
              `- [${f.name}](./${f.id}.md) — ${f.status} (${tr.confidence} ${f.confidence.toFixed(2)})`,
          )
          .join("\n");
  return doc(model, tr.features, body);
}

export function generateCoverageDoc(ctx: GenContext): string {
  const { model, language, matrix = [] } = ctx;
  const tr = t(language);
  const header =
    "| Requirement | Feature | Implemented | Tested | Status |\n|---|---|---|---|---|";
  const rows = matrix.map(
    (r) =>
      `| \`${r.requirement}\` | ${r.feature ?? "—"} | ${r.implemented ? "✅" : "❌"} | ${r.tested ? "✅" : "❌"} | ${r.status} |`,
  );
  const body =
    matrix.length === 0 ? tr.notDetected : [header, ...rows].join("\n");
  return doc(model, tr.coverage, body);
}

export function generateGapsDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const groups: Record<string, typeof model.gaps> = {};
  for (const g of model.gaps) {
    const key = g.kind ?? "other";
    (groups[key] ??= []).push(g);
  }
  const body =
    model.gaps.length === 0
      ? tr.notDetected
      : Object.entries(groups)
          .map(
            ([kind, list]) =>
              `## ${kind}\n\n${list.map((g) => `- ${g.description}`).join("\n")}`,
          )
          .join("\n\n");
  return doc(model, tr.gaps, body);
}

/** Serialize all evidence in the model as JSONL (blueprint §7 `evidence.jsonl`). */
export function generateEvidenceJsonl(model: ProjectModel): string {
  const all: Array<Record<string, unknown>> = [];
  for (const f of model.features) {
    for (const e of f.evidence) all.push({ owner: `feature:${f.id}`, ...e });
  }
  for (const r of model.requirements) {
    for (const e of r.evidence)
      all.push({ owner: `requirement:${r.id}`, ...e });
  }
  return (
    all.map((row) => JSON.stringify(row)).join("\n") + (all.length ? "\n" : "")
  );
}

/** The generation report (blueprint §7 `generation-report.json`). */
export function generateReport(
  model: ProjectModel,
  writtenFiles: string[],
): string {
  const byKind = (kind: string) =>
    model.gaps
      .filter((g) => g.kind === kind)
      .map((g) => g.requirement ?? g.feature);
  return (
    JSON.stringify(
      {
        generator_version: model.metadata.generator_version,
        generated_at:
          model.metadata.last_generated_at ?? new Date().toISOString(),
        source_commit: model.metadata.source_commit,
        written_files: writtenFiles,
        stats: {
          features: model.features.length,
          requirements: model.requirements.length,
          swiftFiles: model.source_files.length,
          technologies: model.technologies.length,
        },
        coverage: {
          planned_not_implemented: byKind("planned-not-implemented"),
          implemented_not_in_prd: byKind("implemented-not-in-prd"),
          implemented_not_tested: byKind("implemented-not-tested"),
          implemented_not_documented: byKind("implemented-not-documented"),
        },
      },
      null,
      2,
    ) + "\n"
  );
}

export function generateGettingStarted(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const depMgrs = model.technologies
    .filter((tech) => tech.category === "dependency-manager")
    .map((tech) => tech.name);
  const steps =
    language === "vi"
      ? [
          `## ${tr.prerequisites}`,
          "",
          "- Xcode (bản mới nhất được khuyến nghị)",
          depMgrs.includes("CocoaPods") ? "- CocoaPods" : "",
          "",
          "## Các bước",
          "",
          depMgrs.includes("CocoaPods")
            ? "1. `pod install`\n2. Mở workspace và build."
            : "1. Mở gói Swift Package hoặc project trong Xcode.\n2. Build và chạy.",
        ]
      : [
          `## ${tr.prerequisites}`,
          "",
          "- Xcode (latest recommended)",
          depMgrs.includes("CocoaPods") ? "- CocoaPods" : "",
          "",
          "## Steps",
          "",
          depMgrs.includes("CocoaPods")
            ? "1. `pod install`\n2. Open the workspace and build."
            : "1. Open the Swift package or project in Xcode.\n2. Build and run.",
        ];
  return doc(
    model,
    tr.gettingStarted,
    steps.filter((l) => l !== "").join("\n"),
  );
}

export function generateBuildAndRelease(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const hasSpm = model.technologies.some(
    (tech) => tech.name === "Swift Package Manager",
  );
  const body = [
    hasSpm ? "- `swift build` / `swift test`" : "",
    "- Build via Xcode (`⌘B`) or `xcodebuild`.",
    "- Archive & distribute through Xcode Organizer or `xcodebuild -exportArchive`.",
    "",
    language === "vi"
      ? "> Chi tiết ký & phát hành phụ thuộc cấu hình dự án; xem phần thủ công bên dưới."
      : "> Signing & release specifics depend on project configuration; see the manual section below.",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return doc(model, tr.buildRelease, body);
}

export function generateTestingStrategy(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const tested = model.features.filter((f) =>
    f.evidence.some((e) => e.kind === "test"),
  );
  const untested = model.features.filter(
    (f) => !f.evidence.some((e) => e.kind === "test"),
  );
  const testTech = model.technologies
    .filter((tech) => tech.category === "testing")
    .map((tech) => tech.name);
  const body = [
    `**${tr.tests}:** ${testTech.join(", ") || tr.notDetected}`,
    "",
    `## ${tr.testedFeatures} (${tested.length})`,
    "",
    tested.length > 0
      ? tested.map((f) => `- ${f.name}`).join("\n")
      : tr.notDetected,
    "",
    `## ${tr.untestedFeatures} (${untested.length})`,
    "",
    untested.length > 0
      ? untested.map((f) => `- ${f.name}`).join("\n")
      : tr.notDetected,
  ].join("\n");
  return doc(model, tr.testingStrategy, body);
}

export function generateUndocumentedCode(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  // Swift source files not attributed to any detected feature.
  const inFeatures = new Set(model.features.flatMap((f) => f.source_files));
  const orphans = model.source_files
    .filter((sf) => !inFeatures.has(sf.path) && sf.role !== "test")
    .map((sf) => sf.path);
  const body =
    orphans.length === 0
      ? tr.notDetected
      : orphans.map((p) => `- \`${p}\``).join("\n");
  return doc(model, tr.undocumented, body);
}

export function generateAssumptions(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body =
    model.assumptions.length === 0
      ? tr.notDetected
      : model.assumptions
          .map(
            (a) =>
              `- ${a.description} (${tr.confidence} ${a.confidence.toFixed(2)}${a.needs_confirmation ? ", NEEDS_CONFIRMATION" : ""})`,
          )
          .join("\n");
  return doc(model, tr.assumptions, body);
}
