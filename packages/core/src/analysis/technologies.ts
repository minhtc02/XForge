import type { Evidence, Technology } from "../project-model/schema.js";
import type { AnalyzedSource } from "./features.js";

/**
 * Technology detection from Swift imports + declarations (blueprint §9, §13.3).
 *
 * Deterministic: maps recognized framework imports to a categorized technology
 * with evidence (the files that import it). Categories mirror the Project Model
 * example (ui, concurrency, persistence, notifications, networking, ...).
 * Unknown imports are ignored rather than guessed at.
 */

interface FrameworkRule {
  /** Exact import module name. */
  module: string;
  name: string;
  category: string;
}

const FRAMEWORKS: FrameworkRule[] = [
  { module: "SwiftUI", name: "SwiftUI", category: "ui" },
  { module: "UIKit", name: "UIKit", category: "ui" },
  { module: "AppKit", name: "AppKit", category: "ui" },
  { module: "WidgetKit", name: "WidgetKit", category: "ui" },
  { module: "Charts", name: "Swift Charts", category: "ui" },
  { module: "CoreData", name: "Core Data", category: "persistence" },
  { module: "SwiftData", name: "SwiftData", category: "persistence" },
  { module: "Realm", name: "Realm", category: "persistence" },
  { module: "RealmSwift", name: "Realm", category: "persistence" },
  { module: "GRDB", name: "GRDB", category: "persistence" },
  { module: "SQLite", name: "SQLite", category: "persistence" },
  {
    module: "UserNotifications",
    name: "UserNotifications",
    category: "notifications",
  },
  { module: "Combine", name: "Combine", category: "concurrency" },
  { module: "Foundation", name: "Foundation", category: "foundation" },
  { module: "CoreLocation", name: "Core Location", category: "location" },
  { module: "MapKit", name: "MapKit", category: "location" },
  { module: "AVFoundation", name: "AVFoundation", category: "media" },
  { module: "AVKit", name: "AVKit", category: "media" },
  { module: "HealthKit", name: "HealthKit", category: "health" },
  { module: "StoreKit", name: "StoreKit", category: "commerce" },
  { module: "CloudKit", name: "CloudKit", category: "sync" },
  { module: "CoreBluetooth", name: "Core Bluetooth", category: "connectivity" },
  { module: "Network", name: "Network", category: "networking" },
  { module: "Alamofire", name: "Alamofire", category: "networking" },
  { module: "URLSession", name: "URLSession", category: "networking" },
  { module: "FirebaseCore", name: "Firebase", category: "backend" },
  { module: "FirebaseAuth", name: "Firebase Auth", category: "backend" },
  { module: "FirebaseFirestore", name: "Cloud Firestore", category: "backend" },
  { module: "XCTest", name: "XCTest", category: "testing" },
];

const FRAMEWORK_BY_MODULE = new Map(FRAMEWORKS.map((f) => [f.module, f]));

/**
 * Detect concurrency usage (async/await, actors) which is not import-based.
 * These are language features, surfaced as concurrency technologies.
 */
function detectLanguageConcurrency(
  sources: AnalyzedSource[],
): Map<string, Evidence[]> {
  const found = new Map<string, Evidence[]>();
  for (const s of sources) {
    if (s.analysis.types.some((t) => t.kind === "actor")) {
      push(found, "actors", { file: s.path, kind: "source", confidence: 0.9 });
    }
  }
  return found;
}

function push(map: Map<string, Evidence[]>, key: string, ev: Evidence): void {
  const list = map.get(key) ?? [];
  list.push(ev);
  map.set(key, list);
}

/** Build categorized technologies from analyzed Swift sources. */
export function detectTechnologies(sources: AnalyzedSource[]): Technology[] {
  // module name -> evidence files
  const byTech = new Map<
    string,
    { rule: FrameworkRule; evidence: Evidence[] }
  >();

  for (const s of sources) {
    for (const mod of s.analysis.imports) {
      const rule = FRAMEWORK_BY_MODULE.get(mod);
      if (!rule) continue;
      const entry = byTech.get(rule.name) ?? { rule, evidence: [] };
      entry.evidence.push({
        file: s.path,
        kind: s.analysis.role === "test" ? "test" : "source",
        confidence: 0.95,
        description: `imports ${mod}`,
      });
      byTech.set(rule.name, entry);
    }
  }

  const technologies: Technology[] = [...byTech.values()].map((e) => ({
    name: e.rule.name,
    category: e.rule.category,
    confidence: 0.95,
    // Cap evidence to keep the model compact but representative.
    evidence: e.evidence.slice(0, 5),
  }));

  // Language-level concurrency (actors).
  const concurrency = detectLanguageConcurrency(sources);
  for (const [name, evidence] of concurrency) {
    technologies.push({
      name: name === "actors" ? "Swift actors" : name,
      category: "concurrency",
      confidence: 0.9,
      evidence: evidence.slice(0, 5),
    });
  }

  return technologies.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Merge import-derived technologies with detector-derived ones (dependency
 * managers, test frameworks) without duplicating by name.
 */
export function mergeTechnologies(...lists: Technology[][]): Technology[] {
  const byName = new Map<string, Technology>();
  for (const list of lists) {
    for (const tech of list) {
      const existing = byName.get(tech.name);
      if (!existing) {
        byName.set(tech.name, { ...tech });
        continue;
      }
      existing.evidence = [...existing.evidence, ...tech.evidence].slice(0, 5);
      existing.confidence = Math.max(existing.confidence, tech.confidence);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
