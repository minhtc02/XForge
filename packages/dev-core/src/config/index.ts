import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ConfigError } from "@xforge/shared";
import { formatZodIssues } from "@xforge/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { DEV_CONFIG_VERSION, DevConfig } from "./schema.js";

export * from "./schema.js";

export const DEV_CONFIG_RELATIVE_PATH = ".xforge/dev/config.yaml";

export function devConfigPath(projectRoot: string): string {
  return join(projectRoot, DEV_CONFIG_RELATIVE_PATH);
}

export function validateDevConfig(input: unknown): DevConfig {
  if (typeof input !== "object" || input === null) {
    throw new ConfigError("Dev config must be a YAML mapping");
  }
  const version = (input as Record<string, unknown>).version;
  if (version !== undefined && version !== DEV_CONFIG_VERSION) {
    throw new ConfigError(
      `Unsupported dev config version ${String(version)}; expected ${DEV_CONFIG_VERSION}`,
      { details: { found: version, supported: DEV_CONFIG_VERSION } },
    );
  }
  const result = DevConfig.safeParse(input);
  if (!result.success) {
    throw new ConfigError("Dev config failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

export function defaultDevConfig(): DevConfig {
  return validateDevConfig({ version: DEV_CONFIG_VERSION });
}

/** Load the dev config, returning defaults when none exists. */
export async function loadDevConfig(projectRoot: string): Promise<DevConfig> {
  const path = devConfigPath(projectRoot);
  if (!existsSync(path)) return defaultDevConfig();
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, "utf8"));
  } catch (cause) {
    throw new ConfigError(`Dev config at ${path} is not valid YAML`, { cause });
  }
  return validateDevConfig(raw);
}

export function serializeDevConfig(config: DevConfig): string {
  const body = stringifyYaml(config, { indent: 2 });
  return `# XForge Dev configuration (see blueprint §22).\n# Default behavior is implement-only; build/test/UI/perf/docs-sync are opt-in.\n${body}`;
}

export async function writeDevConfig(
  projectRoot: string,
  config: DevConfig,
): Promise<string> {
  const path = devConfigPath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeDevConfig(config), "utf8");
  return path;
}
