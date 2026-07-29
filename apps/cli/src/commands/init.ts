import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { AlreadyExistsError, type Logger } from "@xforge/shared";
import {
  configPath,
  defaultConfig,
  detectProject,
  ensureStateDirs,
  loadConfig,
  readTextFileSafe,
  scanFiles,
  writeConfig,
  type DetectionResult,
} from "@xforge/core";
import { emitResult, type CliContext } from "../context.js";

export interface InitOptions {
  profile?: "ios-swift" | "generic";
  output?: string;
  nonInteractive?: boolean;
  force?: boolean;
}

export interface InitResult {
  projectRoot: string;
  configPath: string;
  detection: DetectionResult;
  createdConfig: boolean;
  createdOutputDir: string;
  stateDirs: string[];
}

/**
 * `xforge init` (blueprint §5.2, §24.1, master prompt §4).
 *
 * Deterministically scans the repository, detects project type, writes
 * `.xforge/config.yaml` + `.xforge/state/` and creates the docs output dir.
 * Refuses to overwrite an existing config unless `--force`.
 */
export async function runInit(
  ctx: CliContext,
  options: InitOptions,
): Promise<InitResult> {
  const { projectRoot, logger } = ctx;
  const cfgPath = configPath(projectRoot);
  const configExists = existsSync(cfgPath);

  if (configExists && !options.force) {
    throw new AlreadyExistsError(
      "XForge is already initialized here. Re-run with --force to overwrite the config.",
      { details: { configPath: cfgPath } },
    );
  }

  logger.info("Scanning repository", { root: projectRoot });
  const files = await scanFiles(projectRoot);

  // Read a couple of lightweight signal files (never sensitive ones).
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

  const profile = options.profile ?? detection.profile;
  const projectName =
    detection.platform === "iOS"
      ? deriveProjectName(projectRoot, detection)
      : basename(projectRoot);

  const config = defaultConfig({ name: projectName, profile });
  if (options.output) config.output.root = options.output;

  const writtenConfigPath = await writeConfig(projectRoot, config);
  const stateDirs = await ensureStateDirs(projectRoot);

  const outputDir = join(projectRoot, config.output.root);
  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, "_meta"), { recursive: true });

  const result: InitResult = {
    projectRoot,
    configPath: writtenConfigPath,
    detection,
    createdConfig: true,
    createdOutputDir: config.output.root,
    stateDirs,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderInitSummary(logger, result),
  );
  return result;
}

function deriveProjectName(
  projectRoot: string,
  detection: DetectionResult,
): string {
  if (detection.packageName) return detection.packageName;
  const proj = detection.xcodeProjects[0] ?? detection.xcodeWorkspaces[0];
  if (proj) {
    return basename(proj).replace(/\.(xcodeproj|xcworkspace)$/, "");
  }
  return basename(projectRoot);
}

function renderInitSummary(logger: Logger, result: InitResult): void {
  const d = result.detection;
  logger.success("XForge initialized");
  const lines = [
    ["Platform", d.platform],
    ["Languages", d.languages.join(", ") || "—"],
    ["UI", d.ui.join(", ") || "—"],
    ["Dependency manager", d.dependencyManagers.join(", ") || "—"],
    ["Tests", d.tests.join(", ") || "—"],
    ["Xcode projects", d.xcodeProjects.join(", ") || "—"],
    ["Spec Kit", d.hasSpecKit ? "Found" : "Not found"],
    ["BMAD", d.hasBmad ? "Found" : "Not found"],
    ["PRD candidates", d.prdCandidates.slice(0, 3).join(", ") || "None"],
    ["Swift files", String(d.swiftFileCount)],
    ["Documentation output", result.createdOutputDir],
  ];
  const width = Math.max(...lines.map(([k]) => k!.length));
  process.stderr.write("\nDetected:\n");
  for (const [k, v] of lines) {
    process.stderr.write(`  ${k!.padEnd(width)}  ${v}\n`);
  }
  process.stderr.write(`\nConfig written to ${result.configPath}\n`);
  process.stderr.write("Next: run `xforge docs` to generate documentation.\n");
}

/** Load config after init for verification/inspection. */
export async function loadInitializedConfig(projectRoot: string) {
  return loadConfig(projectRoot);
}
