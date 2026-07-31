import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { configPath, loadConfig, scanFiles, statePath } from "@xforge/core";
import { ExitCode } from "@xforge/shared";
import { loadTestConfig } from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

const exec = promisify(execFile);

export interface TestDoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface TestDoctorResult {
  checks: TestDoctorCheck[];
  ok: boolean;
  exitCode: number;
}

/**
 * `xforge test doctor` (blueprint §5.1, master prompt §4). Validates the
 * environment for QA planning/execution. Missing iOS tooling is a warning off
 * a Mac; only genuinely required prerequisites fail.
 */
export async function runTestDoctor(
  ctx: CliContext,
  options: { silent?: boolean } = {},
): Promise<TestDoctorResult> {
  const { projectRoot } = ctx;
  const checks: TestDoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js >= 20",
    status: nodeMajor >= 20 ? "ok" : "fail",
    detail: `v${process.versions.node}`,
  });

  checks.push({
    name: "Git repository",
    status: existsSync(join(projectRoot, ".git")) ? "ok" : "warn",
    detail: existsSync(join(projectRoot, ".git")) ? "found" : "no .git",
  });

  // XForge config + project model (hard requirements for planning).
  const hasConfig = existsSync(configPath(projectRoot));
  checks.push({
    name: "XForge config",
    status: hasConfig ? "ok" : "fail",
    detail: hasConfig ? "found" : "run `xforge init`",
  });
  if (hasConfig) {
    try {
      await loadConfig(projectRoot);
    } catch (e) {
      checks.push({
        name: "XForge config valid",
        status: "fail",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const hasModel = existsSync(statePath(projectRoot, "projectModel"));
  checks.push({
    name: "Canonical Project Model",
    status: hasModel ? "ok" : "fail",
    detail: hasModel ? "found" : "run `xforge docs`",
  });

  // Test config (optional — defaults are used if absent).
  const testConfig = await loadTestConfig(projectRoot);
  checks.push({
    name: "Test config",
    status: "ok",
    detail: existsSync(join(projectRoot, ".xforge/test/config.yaml"))
      ? "found"
      : "using defaults",
  });

  // Xcode tooling (optional / platform-dependent).
  checks.push(
    await checkCommand(
      "xcode-select",
      ["-p"],
      "Xcode command line tools",
      true,
    ),
  );
  checks.push(
    await checkCommand(
      "xcrun",
      ["simctl", "help"],
      "simctl (simulators)",
      true,
    ),
  );

  // Simulator runtimes (optional).
  checks.push(await checkRuntimes());

  // Xcode project / workspace / scheme detection (structural).
  const files = await scanFiles(projectRoot, {});
  const hasProject = files.some(
    (f) =>
      /\.xcodeproj\//.test(f.path) ||
      /\.xcworkspace\//.test(f.path) ||
      f.path.endsWith("Package.swift"),
  );
  checks.push({
    name: "Xcode project/workspace/SPM",
    status: hasProject ? "ok" : "warn",
    detail: hasProject ? "found" : "no .xcodeproj/.xcworkspace/Package.swift",
  });
  const hasUiTests = files.some((f) => /UITests?\//i.test(f.path));
  checks.push({
    name: "UI test target",
    status: hasUiTests ? "ok" : "warn",
    detail: hasUiTests ? "found" : "none detected (test-support can scaffold)",
  });

  // Figma prerequisites (optional).
  checks.push({
    name: "Figma design map",
    status: existsSync(join(projectRoot, testConfig.figma.design_map))
      ? "ok"
      : "warn",
    detail: testConfig.figma.enabled
      ? existsSync(join(projectRoot, testConfig.figma.design_map))
        ? "found"
        : "enabled but no design-map.yaml"
      : "figma disabled",
  });

  // Disk space (warn under 5 GB free).
  checks.push(await checkDisk(projectRoot));

  const ok = checks.every((c) => c.status !== "fail");
  const result: TestDoctorResult = {
    checks,
    ok,
    exitCode: ok ? ExitCode.Success : ExitCode.ConfigOrRuntimeError,
  };

  if (!options.silent) {
    emitResult(ctx, result as unknown as Record<string, unknown>, () =>
      renderTestDoctor(result),
    );
  }
  return result;
}

async function checkCommand(
  cmd: string,
  args: string[],
  label: string,
  optional = false,
): Promise<TestDoctorCheck> {
  try {
    const { stdout } = await exec(cmd, args, { timeout: 8000 });
    return {
      name: label,
      status: "ok",
      detail: stdout.split("\n")[0]?.trim().slice(0, 60) || "available",
    };
  } catch {
    return {
      name: label,
      status: optional ? "warn" : "fail",
      detail: optional ? "not available (optional)" : "not found",
    };
  }
}

async function checkRuntimes(): Promise<TestDoctorCheck> {
  try {
    const { stdout } = await exec(
      "xcrun",
      ["simctl", "list", "runtimes", "-j"],
      { timeout: 8000 },
    );
    const parsed = JSON.parse(stdout) as {
      runtimes?: Array<{ name: string; isAvailable?: boolean }>;
    };
    const available = (parsed.runtimes ?? []).filter((r) => r.isAvailable);
    return {
      name: "Simulator runtimes",
      status: available.length > 0 ? "ok" : "warn",
      detail:
        available.length > 0
          ? available
              .map((r) => r.name)
              .join(", ")
              .slice(0, 60)
          : "none installed",
    };
  } catch {
    return {
      name: "Simulator runtimes",
      status: "warn",
      detail: "unavailable (optional)",
    };
  }
}

async function checkDisk(projectRoot: string): Promise<TestDoctorCheck> {
  try {
    const stats = await statfs(projectRoot);
    const freeGb = (stats.bsize * stats.bavail) / 1024 ** 3;
    return {
      name: "Disk space",
      status: freeGb >= 5 ? "ok" : "warn",
      detail: `${freeGb.toFixed(1)} GB free`,
    };
  } catch {
    return { name: "Disk space", status: "warn", detail: "unknown" };
  }
}

function renderTestDoctor(result: TestDoctorResult): void {
  const symbol = { ok: "✓", warn: "!", fail: "✗" } as const;
  process.stderr.write("\nXForge Test doctor\n\n");
  const width = Math.max(...result.checks.map((c) => c.name.length));
  for (const c of result.checks) {
    process.stderr.write(
      `  ${symbol[c.status]} ${c.name.padEnd(width)}  ${c.detail}\n`,
    );
  }
  process.stderr.write(
    result.ok
      ? "\nReady to plan. Run `xforge test plan --feature <id>`.\n"
      : "\nSome required checks failed; resolve them before planning.\n",
  );
}
