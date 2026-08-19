import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ConfigError, ValidationError } from "@xforge/shared";
import type { ProjectModel } from "../project-model/schema.js";
import { statePath } from "../state/index.js";

/**
 * Semantic enrichment — the LLM-written half of the docs model.
 *
 * The deterministic parser can see structure but not intent, so four sections
 * of every feature doc (user flows, business rules, error handling, edge
 * cases) render as "requires semantic analysis". This module is the write-back
 * path for the conclusions of whoever CAN read the code and judge intent —
 * the same split as `test review` and `test a11y`: the agent fills a template,
 * the CLI validates evidence and performs the merge. A documented claim with
 * no source ref behind it is rejected, because a generated doc sentence with
 * no file:line behind it is a bug (§3.2).
 */

export const SEMANTIC_SECTIONS = [
  "user_flows",
  "business_rules",
  "error_handling",
  "edge_cases",
] as const;
export type SemanticSectionKey = (typeof SEMANTIC_SECTIONS)[number];

export const SemanticSourceRef = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
});
export type SemanticSourceRef = z.infer<typeof SemanticSourceRef>;

export const SemanticStatus = z.enum([
  "documented",
  "not_applicable",
  "unknown",
]);
export type SemanticStatus = z.infer<typeof SemanticStatus>;

export const SemanticSection = z.object({
  status: SemanticStatus.default("unknown"),
  /** Markdown content. Must be non-empty when status is `documented`. */
  text: z.string().default(""),
  /** Evidence for the claim. Must be non-empty when status is `documented`. */
  sources: z.array(SemanticSourceRef).default([]),
  /** Why nothing is documented here (for `not_applicable` / `unknown`). */
  note: z.string().optional(),
});
export type SemanticSection = z.infer<typeof SemanticSection>;

export const SemanticFeature = z.object({
  user_flows: SemanticSection.default({}),
  business_rules: SemanticSection.default({}),
  error_handling: SemanticSection.default({}),
  edge_cases: SemanticSection.default({}),
});
export type SemanticFeature = z.infer<typeof SemanticFeature>;

export const SemanticEnrichment = z.object({
  schema_version: z.literal(1),
  updated_at: z.string(),
  features: z.record(z.string(), SemanticFeature),
});
export type SemanticEnrichment = z.infer<typeof SemanticEnrichment>;

/** Where the merged, trusted enrichment lives. */
export function semanticPath(projectRoot: string): string {
  return statePath(projectRoot, "semanticEnrichment");
}

/** Where the unfilled template the agent works from lives. */
export function semanticTemplatePath(projectRoot: string): string {
  return statePath(projectRoot, "semanticTemplate");
}

export function parseSemanticEnrichment(raw: unknown): SemanticEnrichment {
  const result = SemanticEnrichment.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Semantic enrichment failed validation", {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}

/** Read the merged enrichment, or null when nothing has been applied yet. */
export async function loadSemanticEnrichment(
  projectRoot: string,
): Promise<SemanticEnrichment | null> {
  const path = semanticPath(projectRoot);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new ConfigError(`Semantic enrichment at ${path} is not valid JSON`, {
      cause,
    });
  }
  return parseSemanticEnrichment(raw);
}

/**
 * Evidence checks the schema cannot express. A `documented` section needs
 * actual text and at least one source, and every source file must exist in
 * the project model — a ref to a file the scanner never saw is a guess.
 */
export function validateSemanticEvidence(
  enrichment: SemanticEnrichment,
  model: ProjectModel,
): string[] {
  const errors: string[] = [];
  const knownFiles = new Set(model.source_files.map((s) => s.path));
  const knownFeatures = new Set(model.features.map((f) => f.id));

  for (const [featureId, feature] of Object.entries(enrichment.features)) {
    if (!knownFeatures.has(featureId)) {
      errors.push(
        `features.${featureId}: unknown feature id — not in the project model.`,
      );
      continue;
    }
    for (const key of SEMANTIC_SECTIONS) {
      const section = feature[key];
      if (section.status !== "documented") continue;
      if (!section.text.trim()) {
        errors.push(
          `features.${featureId}.${key}: status "documented" requires non-empty text.`,
        );
      }
      if (section.sources.length === 0) {
        errors.push(
          `features.${featureId}.${key}: status "documented" requires at least one source ref.`,
        );
      }
      for (const source of section.sources) {
        if (!knownFiles.has(source.file)) {
          errors.push(
            `features.${featureId}.${key}: source "${source.file}" is not in the project model.`,
          );
        }
      }
    }
  }
  return errors;
}

/** Merge a validated patch into the existing enrichment (per feature). */
export function mergeSemanticEnrichment(
  existing: SemanticEnrichment | null,
  patch: SemanticEnrichment,
): SemanticEnrichment {
  return {
    schema_version: 1,
    updated_at: patch.updated_at,
    features: {
      ...(existing ? existing.features : {}),
      ...patch.features,
    },
  };
}

const EMPTY_SECTION: SemanticSection = {
  status: "unknown",
  text: "",
  sources: [],
};

/**
 * The template an agent fills. Every feature gets its four sections plus a
 * `_files` hint listing the source files it may cite — the instruction keys
 * are stripped by the schema on apply, so they can never leak into the model.
 */
export function buildSemanticTemplate(
  model: ProjectModel,
  existing: SemanticEnrichment | null,
  generatedAt: string,
): Record<string, unknown> {
  const features: Record<string, unknown> = {};
  for (const feature of model.features) {
    const previous = existing?.features[feature.id];
    features[feature.id] = {
      _files: [...feature.source_files].sort(),
      user_flows: previous?.user_flows ?? EMPTY_SECTION,
      business_rules: previous?.business_rules ?? EMPTY_SECTION,
      error_handling: previous?.error_handling ?? EMPTY_SECTION,
      edge_cases: previous?.edge_cases ?? EMPTY_SECTION,
    };
  }
  return {
    _instructions:
      "Fill each section for the features you analyzed. status: documented " +
      "requires non-empty text AND sources citing real files from _files " +
      "(file paths exactly as listed, optional line numbers). Use " +
      "not_applicable (with a note) when a section genuinely does not apply, " +
      "and leave unknown when you did not investigate. Remove the _files and " +
      "_instructions keys if you like — they are ignored on apply. Then run: " +
      "xforge docs semantic --apply",
    schema_version: 1,
    updated_at: generatedAt,
    features,
  };
}
