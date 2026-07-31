import type {
  AccessibilityIdentifier,
  AnalyticsEvent,
  ApiEndpoint,
  ArchitectureComponent,
  DataModel,
  Dependency,
  Permission,
  PersistenceEntity,
  Symbol as ModelSymbol,
  TestCase,
} from "../project-model/schema.js";
import type { PlistFacts } from "../ios/plist.js";
import { SIMCTL_GRANTABLE_SERVICES } from "../ios/plist.js";
import type { AnalyzedSource } from "./features.js";

/**
 * Structured iOS entity extraction (blueprint §10 entity list, §7 `data/`,
 * `integrations/` and `quality/` documents).
 *
 * Everything here is derived deterministically from facts the Swift parser and
 * plist reader already collected, and every entity carries the file (and where
 * known, the line) it came from — so the documents built on top of them satisfy
 * the evidence-first rule (§3.2). Nothing is inferred without a source.
 */

/** Resolve which feature owns a source path. */
export type FeatureResolver = (path: string) => string | undefined;

/** Build a resolver from features' `source_files`. */
export function featureResolver(
  features: Array<{ id: string; source_files: string[] }>,
): FeatureResolver {
  const byPath = new Map<string, string>();
  for (const f of features) {
    for (const p of f.source_files) byPath.set(p, f.id);
  }
  return (path) => byPath.get(path);
}

const MODEL_CONFORMANCES = new Set([
  "Codable",
  "Decodable",
  "Encodable",
  "Identifiable",
  "Hashable",
  "Equatable",
]);

/** Types that mean "this is not a plain data model". */
const NON_MODEL_CONFORMANCES = new Set([
  "View",
  "App",
  "Scene",
  "ObservableObject",
  "XCTestCase",
  "UIViewController",
  "NSManagedObject",
  "ViewModifier",
  "PreviewProvider",
]);

/** Value types the app models its data with. */
export function detectDataModels(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): DataModel[] {
  const models: DataModel[] = [];
  for (const s of sources) {
    if (s.analysis.role === "test") continue;
    for (const type of s.analysis.types) {
      if (type.kind === "protocol" || type.kind === "extension") continue;
      if (type.inherits.some((c) => NON_MODEL_CONFORMANCES.has(c))) continue;
      const matched = type.inherits.filter((c) => MODEL_CONFORMANCES.has(c));
      const byRole = s.analysis.role === "model";
      if (matched.length === 0 && !byRole) continue;
      models.push({
        name: type.name,
        kind: type.kind,
        file: s.path,
        start_line: type.line,
        conformances: matched,
        feature: featureOf(s.path),
        evidence: [
          {
            file: s.path,
            start_line: type.line,
            kind: "source",
            confidence: matched.length > 0 ? 0.95 : 0.7,
            description:
              matched.length > 0
                ? `Conforms to ${matched.join(", ")}`
                : "Declared in a model-role file",
          },
        ],
      });
    }
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/** Types persisted by a storage mechanism, with the mechanism named. */
export function detectPersistenceEntities(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): PersistenceEntity[] {
  const entities: PersistenceEntity[] = [];
  for (const s of sources) {
    if (s.analysis.role === "test") continue;
    const imports = new Set(s.analysis.imports);
    const attrs = new Set(s.analysis.attributes);
    const isSwiftData = imports.has("SwiftData") && attrs.has("Model");
    const isRealm = imports.has("RealmSwift") || imports.has("Realm");

    for (const type of s.analysis.types) {
      if (type.kind === "protocol" || type.kind === "extension") continue;
      let mechanism: string | undefined;
      if (type.inherits.includes("NSManagedObject")) mechanism = "Core Data";
      else if (isSwiftData && type.kind === "class") mechanism = "SwiftData";
      else if (isRealm && type.inherits.includes("Object")) mechanism = "Realm";
      if (!mechanism) continue;
      entities.push({
        name: type.name,
        mechanism,
        file: s.path,
        start_line: type.line,
        feature: featureOf(s.path),
        evidence: [
          {
            file: s.path,
            start_line: type.line,
            kind: "source",
            confidence: 0.95,
            description: `Persisted via ${mechanism}`,
          },
        ],
      });
    }
  }
  return entities.sort((a, b) => a.name.localeCompare(b.name));
}

/** Analytics event names passed to recognized logging APIs. */
export function detectAnalyticsEvents(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.analysis.role === "test") continue;
    for (const ref of s.analysis.analyticsEvents) {
      const key = `${ref.value}@${s.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        name: ref.value,
        file: s.path,
        start_line: ref.line,
        feature: featureOf(s.path),
        evidence: [
          {
            file: s.path,
            start_line: ref.line,
            kind: "source",
            confidence: 0.9,
            description: "Analytics event name literal",
          },
        ],
      });
    }
  }
  return events.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Hosts that appear in source as documentation/licence references rather than
 * as endpoints the app calls. Filtering them keeps `integrations/api.md`
 * meaningful instead of listing every comment link.
 */
const NON_API_HOSTS = new Set([
  "developer.apple.com",
  "docs.swift.org",
  "swift.org",
  "www.swift.org",
  "github.com",
  "www.github.com",
  "www.apache.org",
  "opensource.org",
  "www.w3.org",
  "schemas.xmlsoap.org",
  "www.apple.com",
]);

/** Absolute URL literals that look like endpoints the app talks to. */
export function detectApiEndpoints(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.analysis.role === "test") continue;
    for (const ref of s.analysis.urlLiterals) {
      const host = hostOf(ref.value);
      if (!host || NON_API_HOSTS.has(host)) continue;
      if (seen.has(ref.value)) continue;
      seen.add(ref.value);
      endpoints.push({
        url: ref.value,
        host,
        file: s.path,
        start_line: ref.line,
        feature: featureOf(s.path),
        evidence: [
          {
            file: s.path,
            start_line: ref.line,
            kind: "source",
            confidence: 0.85,
            description: "Absolute URL literal",
          },
        ],
      });
    }
  }
  return endpoints.sort((a, b) => a.url.localeCompare(b.url));
}

function hostOf(url: string): string | undefined {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m?.[1]?.toLowerCase();
}

/** Existing automated tests, split unit vs UI by target path convention. */
export function detectTestCases(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): TestCase[] {
  const cases: TestCase[] = [];
  for (const s of sources) {
    if (s.analysis.role !== "test") continue;
    const kind = /UITests?[./]/i.test(s.path) ? "ui" : "unit";
    for (const fn of s.analysis.testMethods) {
      cases.push({
        name: fn.name,
        file: s.path,
        start_line: fn.line,
        kind,
        feature: featureOf(s.path),
      });
    }
  }
  return cases.sort(
    (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
  );
}

const ROLE_COMPONENTS: Record<string, { id: string; name: string }> = {
  view: { id: "presentation-views", name: "Presentation — Views" },
  "view-model": {
    id: "presentation-view-models",
    name: "Presentation — View Models",
  },
  repository: { id: "data-repositories", name: "Data — Repositories" },
  service: { id: "domain-services", name: "Domain — Services" },
  scheduler: { id: "domain-schedulers", name: "Domain — Schedulers" },
  model: { id: "domain-models", name: "Domain — Models" },
  coordinator: { id: "navigation-coordinators", name: "Navigation" },
  "app-entry": { id: "app-entry", name: "App Entry" },
  other: { id: "supporting-code", name: "Supporting code" },
};

/** Group source files into architectural layers by detected role. */
export function detectArchitecture(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): ArchitectureComponent[] {
  const byComponent = new Map<string, ArchitectureComponent>();
  for (const s of sources) {
    if (s.analysis.role === "test") continue;
    const spec = ROLE_COMPONENTS[s.analysis.role] ?? ROLE_COMPONENTS.other!;
    const existing = byComponent.get(spec.id) ?? {
      id: spec.id,
      name: spec.name,
      role: s.analysis.role,
      file_count: 0,
      files: [],
      features: [],
    };
    existing.files.push(s.path);
    existing.file_count += 1;
    const feature = featureOf(s.path);
    if (feature && !existing.features.includes(feature)) {
      existing.features.push(feature);
    }
    byComponent.set(spec.id, existing);
  }
  return [...byComponent.values()]
    .map((c) => ({
      ...c,
      files: c.files.sort(),
      features: c.features.sort(),
    }))
    .sort((a, b) => b.file_count - a.file_count || a.id.localeCompare(b.id));
}

/** Declared permissions, annotated with whether a simulator can grant them. */
export function detectPermissions(
  facts: PlistFacts,
  plistFile: string,
  entitlementsFile?: string,
): Permission[] {
  const permissions: Permission[] = facts.permissions.map((p) => ({
    key: p.key,
    service: p.service,
    purpose: p.purpose,
    source: "plist" as const,
    simctl_grantable: SIMCTL_GRANTABLE_SERVICES.has(p.service),
    evidence: [
      {
        file: plistFile,
        start_line: p.line,
        kind: "plist" as const,
        confidence: 1,
        description: p.key,
      },
    ],
  }));

  for (const cap of facts.capabilities) {
    permissions.push({
      key: cap.key,
      service: cap.label,
      source: "entitlement",
      simctl_grantable: false,
      evidence: [
        {
          file: entitlementsFile ?? plistFile,
          start_line: cap.line,
          kind: "entitlement" as const,
          confidence: 1,
          description: cap.key,
        },
      ],
    });
  }
  return permissions.sort((a, b) => a.key.localeCompare(b.key));
}

const SPM_PACKAGE_RE =
  /\.package\s*\(\s*(?:name:\s*"([^"]+)"\s*,\s*)?url:\s*"([^"]+)"([^)]*)\)/g;
const POD_RE = /^\s*pod\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/;

/** Third-party dependencies from Package.swift and Podfile. */
export function detectDependencies(input: {
  packageSwift?: string | null;
  packageSwiftPath?: string;
  podfile?: string | null;
  podfilePath?: string;
}): Dependency[] {
  const deps: Dependency[] = [];

  if (input.packageSwift && input.packageSwiftPath) {
    const lines = input.packageSwift.split("\n");
    SPM_PACKAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPM_PACKAGE_RE.exec(input.packageSwift)) !== null) {
      const url = m[2] ?? "";
      const name =
        m[1] ??
        url
          .split("/")
          .pop()
          ?.replace(/\.git$/, "") ??
        url;
      const requirement = /from:\s*"([^"]+)"/.exec(m[3] ?? "")?.[1];
      deps.push({
        name,
        manager: "spm",
        requirement,
        url,
        evidence: [
          {
            file: input.packageSwiftPath,
            start_line: lineOfOffset(lines, input.packageSwift, m.index),
            kind: "manifest",
            confidence: 1,
            description: `Swift Package: ${url}`,
          },
        ],
      });
    }
  }

  if (input.podfile && input.podfilePath) {
    const lines = input.podfile.split("\n");
    for (const [i, line] of lines.entries()) {
      const m = POD_RE.exec(line);
      if (!m?.[1]) continue;
      deps.push({
        name: m[1],
        manager: "cocoapods",
        requirement: m[2],
        evidence: [
          {
            file: input.podfilePath,
            start_line: i + 1,
            kind: "manifest",
            confidence: 1,
            description: `CocoaPods pod: ${m[1]}`,
          },
        ],
      });
    }
  }

  return deps.sort((a, b) => a.name.localeCompare(b.name));
}

function lineOfOffset(
  lines: string[],
  content: string,
  offset: number,
): number | undefined {
  const before = content.slice(0, offset);
  const line = before.split("\n").length;
  return line >= 1 && line <= lines.length ? line : undefined;
}

/**
 * Every `accessibilityIdentifier` declared in source, with its feature. This is
 * the inventory the docs use for the accessibility report and that XForge Test
 * reconciles generated locators against before a run.
 */
export function collectAccessibilityIdentifiers(
  sources: AnalyzedSource[],
  featureOf: FeatureResolver,
): AccessibilityIdentifier[] {
  const out: AccessibilityIdentifier[] = [];
  for (const s of sources) {
    if (s.analysis.role === "test") continue;
    for (const id of s.analysis.accessibilityIdentifiers) {
      out.push({
        value: id.value,
        expression: id.expression,
        file: s.path,
        start_line: id.line,
        dynamic: id.dynamic,
        feature: featureOf(s.path),
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || (a.start_line ?? 0) - (b.start_line ?? 0),
  );
}

/** Frameworks each feature's files import, for per-feature doc sections. */
export function frameworksByFeature(
  sources: AnalyzedSource[],
  features: Array<{ id: string; source_files: string[] }>,
): Map<string, string[]> {
  const byPath = new Map(sources.map((s) => [s.path, s.analysis.imports]));
  const result = new Map<string, string[]>();
  for (const f of features) {
    const frameworks = new Set<string>();
    for (const path of f.source_files) {
      for (const imp of byPath.get(path) ?? []) frameworks.add(imp);
    }
    result.set(f.id, [...frameworks].sort());
  }
  return result;
}

/** Flatten declared types + functions into the model's `symbols` list. */
export function collectSymbols(sources: AnalyzedSource[]): ModelSymbol[] {
  const symbols: ModelSymbol[] = [];
  for (const s of sources) {
    for (const type of s.analysis.types) {
      symbols.push({
        name: type.name,
        kind: type.kind,
        file: s.path,
        start_line: type.line,
      });
    }
    for (const fn of s.analysis.functions) {
      symbols.push({
        name: fn.name,
        kind: "func",
        file: s.path,
        start_line: fn.line,
      });
    }
  }
  return symbols;
}
