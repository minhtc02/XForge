import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  loadConfig,
  readProjectModel,
  scanFiles,
  statePath,
  type ProjectModel,
} from "@xforge/core";
import { NotFoundError } from "@xforge/shared";
import { loadTestConfig, type TestConfig } from "@xforge/test-core";
import type { CliContext } from "../../context.js";

/**
 * Shared loading helpers for `xforge test` commands. All of these reuse XForge
 * Core (config, project model, scanner) rather than re-implementing discovery
 * (blueprint §2.2 — reuse, never fork).
 */

export interface TestModelContext {
  model: ProjectModel;
  testConfig: TestConfig;
}

/** Load the Canonical Project Model + test config, or throw a clear error. */
export async function loadTestModelContext(
  ctx: CliContext,
): Promise<TestModelContext> {
  await loadConfig(ctx.projectRoot); // ensures XForge is initialized
  const modelPath = statePath(ctx.projectRoot, "projectModel");
  if (!existsSync(modelPath)) {
    throw new NotFoundError(
      "No Canonical Project Model found. Run `xforge docs` first.",
      { details: { modelPath } },
    );
  }
  // Full model: reconciliation and sharding reason over individual files,
  // which live in the appendices rather than the core file.
  const model = await readProjectModel(ctx.projectRoot, { full: true });
  const testConfig = await loadTestConfig(ctx.projectRoot);
  return { model, testConfig };
}

/** Count existing Swift test files (blueprint §7.3, plan sources). */
export async function inventoryExistingTests(
  projectRoot: string,
  globs: string[],
): Promise<number> {
  const files = await scanFiles(projectRoot, { include: globs });
  return files.filter((f) => !f.sensitive && f.path.endsWith(".swift")).length;
}

/**
 * Lightweight environment probe for planning/doctor (no shell execution here;
 * structural detection only, so planning stays deterministic and offline).
 */
export interface EnvProbe {
  hasUiTestTarget: boolean;
  hasAccessibilityIdentifiers: boolean;
}

export async function probeEnvironment(projectRoot: string): Promise<EnvProbe> {
  const files = await scanFiles(projectRoot, {});
  const hasUiTestTarget = files.some(
    (f) => /UITests?\//i.test(f.path) || /UITests?\.swift$/.test(f.path),
  );
  // Heuristic: look for accessibilityIdentifier usage in any non-sensitive swift file.
  let hasAccessibilityIdentifiers = false;
  for (const f of files) {
    if (f.sensitive || !f.path.endsWith(".swift")) continue;
    try {
      const content = await readFile(`${projectRoot}/${f.path}`, "utf8");
      if (content.includes("accessibilityIdentifier")) {
        hasAccessibilityIdentifiers = true;
        break;
      }
    } catch {
      // ignore unreadable files
    }
  }
  return { hasUiTestTarget, hasAccessibilityIdentifiers };
}
