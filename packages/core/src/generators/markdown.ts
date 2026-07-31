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
    dataModels: "Mô hình dữ liệu",
    persistence: "Lưu trữ",
    migrations: "Migration dữ liệu",
    api: "API & endpoint",
    notifications: "Thông báo",
    analytics: "Analytics",
    thirdParty: "Dịch vụ bên thứ ba",
    security: "Bảo mật & quyền riêng tư",
    accessibility: "Khả năng tiếp cận",
    performance: "Hiệu năng",
    permissions: "Quyền",
    capabilities: "Capability",
    backgroundModes: "Background mode",
    urlSchemes: "URL scheme",
    dependencies: "Thư viện phụ thuộc",
    summary: "Tóm tắt",
    productIntention: "Mục tiêu sản phẩm",
    userFlows: "Luồng người dùng",
    screens: "Màn hình & điểm vào",
    mainComponents: "Thành phần chính",
    businessRules: "Quy tắc nghiệp vụ",
    networking: "Kết nối mạng",
    errorHandling: "Xử lý lỗi",
    edgeCases: "Trường hợp biên",
    analyticsEvents: "Sự kiện analytics",
    prdTraceability: "Đối chiếu PRD",
    knownGaps: "Khoảng trống đã biết",
    codeReferences: "Tham chiếu mã nguồn",
    needsLlm: "Chưa phát hiện (cần phân tích ngữ nghĩa)",
    grantable: "Simulator cấp được",
    notGrantable: "Simulator KHÔNG cấp được",
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
    dataModels: "Data Models",
    persistence: "Persistence",
    migrations: "Migrations",
    api: "API & Endpoints",
    notifications: "Notifications",
    analytics: "Analytics",
    thirdParty: "Third-party Services",
    security: "Security & Privacy",
    accessibility: "Accessibility",
    performance: "Performance",
    permissions: "Permissions",
    capabilities: "Capabilities",
    backgroundModes: "Background modes",
    urlSchemes: "URL schemes",
    dependencies: "Dependencies",
    summary: "Summary",
    productIntention: "Product intention",
    userFlows: "User flows",
    screens: "Screens and entry points",
    mainComponents: "Main components",
    businessRules: "Business rules",
    networking: "Networking",
    errorHandling: "Error handling",
    edgeCases: "Edge cases",
    analyticsEvents: "Analytics events",
    prdTraceability: "PRD traceability",
    knownGaps: "Known gaps",
    codeReferences: "Code references",
    needsLlm: "Not detected (requires semantic analysis)",
    grantable: "Simulator-grantable",
    notGrantable: "NOT simulator-grantable",
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
  const frameworks =
    byCategory.size === 0
      ? tr.notDetected
      : [...byCategory.entries()]
          .map(
            ([cat, names]) =>
              `## ${cat}\n\n${names.map((n) => `- ${n}`).join("\n")}`,
          )
          .join("\n\n");
  const body = [
    frameworks,
    "",
    `## ${tr.dependencies}`,
    "",
    bullets(
      model.dependencies.map(
        (d) =>
          `**${d.name}** (${d.manager}${d.requirement ? `, ${d.requirement}` : ""})`,
      ),
      tr.notDetected,
    ),
  ].join("\n");
  return doc(model, tr.techStack, body);
}

export function generateArchitecture(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body = [
    featureOverviewDiagram(model.project.name, model.features),
    "",
    "## Layers",
    "",
    model.architecture.length > 0
      ? model.architecture
          .map(
            (c) =>
              `- **${c.name}** — ${c.file_count} file(s)${c.features.length > 0 ? ` — ${c.features.join(", ")}` : ""}`,
          )
          .join("\n")
      : tr.notDetected,
    "",
    `## ${tr.features}`,
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

/** Frameworks whose use implies a runtime privacy prompt (blueprint §8). */
const PERMISSION_FRAMEWORKS: Readonly<Record<string, string>> = {
  CoreLocation: "location",
  AVFoundation: "camera / microphone",
  AVKit: "camera / microphone",
  UserNotifications: "notifications",
  HealthKit: "health",
  Contacts: "contacts",
  ContactsUI: "contacts",
  EventKit: "calendar / reminders",
  Photos: "photos",
  PhotosUI: "photos",
  Speech: "speech recognition",
  CoreBluetooth: "bluetooth",
  CoreMotion: "motion",
  LocalAuthentication: "biometrics",
  AppTrackingTransparency: "tracking",
};

function bullets(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : fallback;
}

/** A single feature document following the §8 section structure. */
export function generateFeatureDoc(feature: Feature, ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const mine = <T extends { feature?: string }>(rows: T[]): T[] =>
    rows.filter((r) => r.feature === feature.id);

  const reqs = model.requirements.filter((r) =>
    feature.requirements.includes(r.id),
  );
  const tests = mine(model.test_cases);
  const dataModels = mine(model.data_models);
  const persistence = mine(model.persistence_entities);
  const endpoints = mine(model.api_endpoints);
  const events = mine(model.analytics_events);
  const a11y = mine(model.accessibility_identifiers);
  const gaps = model.gaps.filter((g) => g.feature === feature.id);
  const permissionFrameworks = feature.frameworks.filter(
    (f) => f in PERMISSION_FRAMEWORKS,
  );
  const notificationFrameworks = feature.frameworks.filter((f) =>
    /Notification/i.test(f),
  );
  const networkFrameworks = feature.frameworks.filter((f) =>
    /^(Network|Alamofire|URLSession)$/.test(f),
  );
  const byRole = new Map<string, string[]>();
  for (const path of feature.source_files) {
    const role = model.source_files.find((s) => s.path === path)?.role ?? "?";
    byRole.set(role, [...(byRole.get(role) ?? []), path]);
  }

  const sections: Array<[string, string]> = [
    [tr.summary, feature.summary ?? tr.needsLlm],
    [
      tr.productIntention,
      reqs.length > 0
        ? bullets(
            reqs.map((r) => `\`${r.id}\` — ${r.description}`),
            tr.notDetected,
          )
        : tr.notDetected,
    ],
    [
      tr.status,
      `${feature.status} (${tr.confidence} ${feature.confidence.toFixed(2)})`,
    ],
    [tr.userFlows, tr.needsLlm],
    [
      tr.screens,
      bullets(
        feature.entry_points.map(
          (e) => `\`${e.name}\`${e.file ? ` — \`${e.file}\`` : ""}`,
        ),
        tr.notDetected,
      ),
    ],
    [
      tr.mainComponents,
      byRole.size > 0
        ? [...byRole.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
              ([role, paths]) =>
                `- **${role}** — ${paths.map((p) => `\`${p}\``).join(", ")}`,
            )
            .join("\n")
        : tr.notDetected,
    ],
    [tr.businessRules, tr.needsLlm],
    [
      tr.dataModels,
      bullets(
        dataModels.map(
          (m) =>
            `\`${m.name}\` (${m.kind}) — \`${m.file}${m.start_line ? `:${m.start_line}` : ""}\``,
        ),
        tr.notDetected,
      ),
    ],
    [
      tr.persistence,
      bullets(
        persistence.map(
          (p) =>
            `\`${p.name}\` — ${p.mechanism} — \`${p.file}${p.start_line ? `:${p.start_line}` : ""}\``,
        ),
        tr.notDetected,
      ),
    ],
    [
      tr.networking,
      bullets(
        [
          ...networkFrameworks.map((f) => `\`${f}\``),
          ...endpoints.map(
            (e) =>
              `\`${e.url}\` — \`${e.file}${e.start_line ? `:${e.start_line}` : ""}\``,
          ),
        ],
        tr.notDetected,
      ),
    ],
    [
      tr.notifications,
      bullets(
        notificationFrameworks.map((f) => `\`${f}\``),
        tr.notDetected,
      ),
    ],
    [
      tr.permissions,
      bullets(
        permissionFrameworks.map(
          (f) => `\`${f}\` → ${PERMISSION_FRAMEWORKS[f]} (INFERRED)`,
        ),
        tr.notDetected,
      ),
    ],
    [tr.errorHandling, tr.needsLlm],
    [tr.edgeCases, tr.needsLlm],
    [
      tr.analyticsEvents,
      bullets(
        events.map(
          (e) =>
            `\`${e.name}\` — \`${e.file}${e.start_line ? `:${e.start_line}` : ""}\``,
        ),
        tr.notDetected,
      ),
    ],
    [
      tr.accessibility,
      a11y.length > 0
        ? `${a11y.filter((i) => !i.dynamic).length} static, ${a11y.filter((i) => i.dynamic).length} dynamic accessibility identifier(s).\n\n` +
          bullets(
            a11y
              .slice(0, 20)
              .map(
                (i) =>
                  `${i.dynamic ? `\`${i.expression}\` (dynamic)` : `\`${i.value}\``} — \`${i.file}${i.start_line ? `:${i.start_line}` : ""}\``,
              ),
            tr.notDetected,
          )
        : tr.notDetected,
    ],
    [
      tr.tests,
      bullets(
        tests.map(
          (c) =>
            `\`${c.name}\` (${c.kind}) — \`${c.file}${c.start_line ? `:${c.start_line}` : ""}\``,
        ),
        tr.notDetected,
      ),
    ],
    [
      tr.prdTraceability,
      reqs.length > 0
        ? bullets(
            reqs.map((r) => `\`${r.id}\` — ${r.implementation_status}`),
            tr.notDetected,
          )
        : tr.notDetected,
    ],
    [
      tr.knownGaps,
      bullets(
        gaps.map((g) => g.description),
        tr.notDetected,
      ),
    ],
    [
      tr.codeReferences,
      bullets(
        feature.source_files.map((f) => `\`${f}\``),
        tr.notDetected,
      ),
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

// --- data/ (blueprint §7) ---------------------------------------------------

export function generateDataModelsDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body =
    model.data_models.length === 0
      ? tr.notDetected
      : model.data_models
          .map((m) => {
            const where = `\`${m.file}${m.start_line ? `:${m.start_line}` : ""}\``;
            const conf =
              m.conformances.length > 0
                ? ` — ${m.conformances.join(", ")}`
                : " — INFERRED (model-role file)";
            return `- **${m.name}** (${m.kind})${conf} — ${where}${m.feature ? ` — ${m.feature}` : ""}`;
          })
          .join("\n");
  return doc(model, tr.dataModels, body);
}

export function generatePersistenceDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const mechanisms = model.technologies.filter(
    (tech) => tech.category === "persistence",
  );
  const body = [
    `## ${tr.techStack}`,
    "",
    bullets(
      mechanisms.map((m) => `**${m.name}**`),
      tr.notDetected,
    ),
    "",
    `## ${tr.dataModels}`,
    "",
    bullets(
      model.persistence_entities.map(
        (e) =>
          `**${e.name}** — ${e.mechanism} — \`${e.file}${e.start_line ? `:${e.start_line}` : ""}\``,
      ),
      tr.notDetected,
    ),
  ].join("\n");
  return doc(model, tr.persistence, body);
}

export function generateMigrationsDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  // Migration artifacts are file-shaped: .xcdatamodeld versions, mapping models,
  // or a SwiftData `VersionedSchema`. We only report what was actually seen.
  const modelFiles = model.source_files
    .map((f) => f.path)
    .filter((p) => /xcdatamodeld|xcmappingmodel|Migration/i.test(p));
  const versionedSchemas = model.symbols.filter((s) =>
    /VersionedSchema|SchemaMigrationPlan|MigrationStage/.test(s.name),
  );
  const body = bullets(
    [
      ...modelFiles.map((p) => `\`${p}\``),
      ...versionedSchemas.map((s) => `\`${s.name}\` — \`${s.file}\``),
    ],
    tr.notDetected,
  );
  return doc(model, tr.migrations, body);
}

// --- integrations/ (blueprint §7) -------------------------------------------

export function generateApiDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const byHost = new Map<string, typeof model.api_endpoints>();
  for (const e of model.api_endpoints) {
    byHost.set(e.host, [...(byHost.get(e.host) ?? []), e]);
  }
  const networking = model.technologies.filter(
    (tech) => tech.category === "networking" || tech.category === "backend",
  );
  const body = [
    `## ${tr.techStack}`,
    "",
    bullets(
      networking.map((n) => `**${n.name}**`),
      tr.notDetected,
    ),
    "",
    `## ${tr.api}`,
    "",
    byHost.size === 0
      ? tr.notDetected
      : [...byHost.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([host, list]) =>
              `### ${host}\n\n` +
              list
                .map(
                  (e) =>
                    `- \`${e.url}\` — \`${e.file}${e.start_line ? `:${e.start_line}` : ""}\``,
                )
                .join("\n"),
          )
          .join("\n\n"),
  ].join("\n");
  return doc(model, tr.api, body);
}

export function generateNotificationsDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const notifTech = model.technologies.filter(
    (tech) => tech.category === "notifications",
  );
  const pushCapability = model.capabilities.filter((c) =>
    /Notification/i.test(c),
  );
  const body = [
    `## ${tr.techStack}`,
    "",
    bullets(
      notifTech.map(
        (n) =>
          `**${n.name}** — ${n.evidence.map((e) => `\`${e.file}\``).join(", ") || tr.notDetected}`,
      ),
      tr.notDetected,
    ),
    "",
    `## ${tr.capabilities}`,
    "",
    bullets(
      pushCapability.map((c) => `**${c}**`),
      tr.notDetected,
    ),
    "",
    `## ${tr.backgroundModes}`,
    "",
    bullets(
      model.background_modes.map((m) => `\`${m}\``),
      tr.notDetected,
    ),
  ].join("\n");
  return doc(model, tr.notifications, body);
}

export function generateAnalyticsDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const byFeature = new Map<string, typeof model.analytics_events>();
  for (const e of model.analytics_events) {
    const key = e.feature ?? "—";
    byFeature.set(key, [...(byFeature.get(key) ?? []), e]);
  }
  const body =
    byFeature.size === 0
      ? tr.notDetected
      : [...byFeature.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([feature, list]) =>
              `## ${feature}\n\n` +
              list
                .map(
                  (e) =>
                    `- \`${e.name}\` — \`${e.file}${e.start_line ? `:${e.start_line}` : ""}\``,
                )
                .join("\n"),
          )
          .join("\n\n");
  return doc(model, tr.analytics, body);
}

export function generateThirdPartyDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const body = [
    `## ${tr.dependencies}`,
    "",
    bullets(
      model.dependencies.map(
        (d) =>
          `**${d.name}** (${d.manager}${d.requirement ? `, ${d.requirement}` : ""})${d.url ? ` — ${d.url}` : ""}`,
      ),
      tr.notDetected,
    ),
    "",
    `## ${tr.techStack}`,
    "",
    bullets(
      model.technologies
        .filter((tech) => tech.category === "backend")
        .map((tech) => `**${tech.name}**`),
      tr.notDetected,
    ),
  ].join("\n");
  return doc(model, tr.thirdParty, body);
}

// --- quality/ (blueprint §7) ------------------------------------------------

export function generateSecurityDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const grantable = model.permissions.filter((p) => p.simctl_grantable);
  const notGrantable = model.permissions.filter(
    (p) => !p.simctl_grantable && p.source === "plist",
  );
  const entitlements = model.permissions.filter(
    (p) => p.source === "entitlement",
  );
  const body = [
    `## ${tr.permissions}`,
    "",
    model.permissions.length === 0
      ? tr.notDetected
      : [
          `### ${tr.grantable}`,
          "",
          bullets(
            grantable.map(
              (p) =>
                `\`${p.key}\` (${p.service})${p.purpose ? ` — "${p.purpose}"` : ""}`,
            ),
            tr.notDetected,
          ),
          "",
          `### ${tr.notGrantable}`,
          "",
          bullets(
            notGrantable.map(
              (p) =>
                `\`${p.key}\` (${p.service})${p.purpose ? ` — "${p.purpose}"` : ""}`,
            ),
            tr.notDetected,
          ),
        ].join("\n"),
    "",
    `## ${tr.capabilities}`,
    "",
    bullets(
      entitlements.map((p) => `**${p.service}** — \`${p.key}\``),
      tr.notDetected,
    ),
    "",
    `## ${tr.urlSchemes}`,
    "",
    bullets(
      model.url_schemes.map((s) => `\`${s}://\``),
      tr.notDetected,
    ),
  ].join("\n");
  return doc(model, tr.security, body);
}

export function generateAccessibilityDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const ids = model.accessibility_identifiers;
  const staticIds = ids.filter((i) => !i.dynamic);
  const dynamicIds = ids.filter((i) => i.dynamic);
  const viewFiles = model.source_files.filter((f) => f.role === "view");
  const covered = new Set(ids.map((i) => i.file));
  const uncovered = viewFiles.filter((f) => !covered.has(f.path));

  const body = [
    `- ${tr.sourceFiles}: ${viewFiles.length} view file(s)`,
    `- ${tr.accessibility}: ${staticIds.length} static, ${dynamicIds.length} dynamic identifier(s)`,
    "",
    `## ${tr.notDetected} — view files without an accessibility identifier`,
    "",
    bullets(
      uncovered.map((f) => `\`${f.path}\``),
      tr.notDetected,
    ),
    "",
    "## Identifiers",
    "",
    bullets(
      staticIds.map(
        (i) =>
          `\`${i.value}\` — \`${i.file}${i.start_line ? `:${i.start_line}` : ""}\``,
      ),
      tr.notDetected,
    ),
    ...(dynamicIds.length > 0
      ? [
          "",
          "## Dynamic (unresolvable statically)",
          "",
          bullets(
            dynamicIds.map(
              (i) =>
                `\`${i.expression}\` — \`${i.file}${i.start_line ? `:${i.start_line}` : ""}\``,
            ),
            tr.notDetected,
          ),
        ]
      : []),
  ].join("\n");
  return doc(model, tr.accessibility, body);
}

export function generatePerformanceDoc(ctx: GenContext): string {
  const { model, language } = ctx;
  const tr = t(language);
  const perfTests = model.test_cases.filter((c) =>
    /performance|measure|benchmark/i.test(c.name),
  );
  const largest = [...model.source_files]
    .filter((f) => typeof f.loc === "number")
    .sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))
    .slice(0, 10);
  const body = [
    `## ${tr.tests}`,
    "",
    bullets(
      perfTests.map((c) => `\`${c.name}\` — \`${c.file}\``),
      tr.notDetected,
    ),
    "",
    `## ${tr.sourceFiles}`,
    "",
    bullets(
      largest.map((f) => `\`${f.path}\` — ${f.loc} LOC`),
      tr.notDetected,
    ),
    "",
    `## ${tr.backgroundModes}`,
    "",
    bullets(
      model.background_modes.map((m) => `\`${m}\``),
      tr.notDetected,
    ),
  ].join("\n");
  return doc(model, tr.performance, body);
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
