import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { configPath, loadConfig, statePath } from "@xforge/core";
import { ExitCode } from "@xforge/shared";
import { loadDevConfig, worktreeRoot } from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";

const exec = promisify(execFile);

export interface DevDoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DevDoctorResult {
  checks: DevDoctorCheck[];
  ok: boolean;
  exitCode: number;
}

/**
 * `xforge dev doctor` (blueprint §28 Phase 1, master prompt §Phase 1).
 * Validates the environment for spec-first development planning. Git worktree
 * support and a clean-enough main checkout matter here; iOS build tooling does
 * NOT (this module never builds by default).
 */
export async function runDevDoctor(ctx: CliContext): Promise<DevDoctorResult> {
  const { projectRoot } = ctx;
  const checks: DevDoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js >= 20",
    status: nodeMajor >= 20 ? "ok" : "fail",
    detail: `v${process.versions.node}`,
  });

  // Git repository is required — worktrees need it.
  const hasGit = existsSync(join(projectRoot, ".git"));
  checks.push({
    name: "Git repository",
    status: hasGit ? "ok" : "fail",
    detail: hasGit ? "found" : "not a git repository",
  });

  // Git worktree support.
  checks.push(
    await checkCommand(
      "git",
      ["worktree", "list"],
      "Git worktree support",
      false,
    ),
  );

  // Main checkout state (dirty is a warning — dev never writes to main).
  checks.push(await checkCleanMain(projectRoot, hasGit));

  // XForge config + project model.
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
  checks.push({
    name: "Canonical Project Model",
    status: existsSync(statePath(projectRoot, "projectModel")) ? "ok" : "fail",
    detail: existsSync(statePath(projectRoot, "projectModel"))
      ? "found"
      : "run `xforge docs`",
  });

  // Dev config (optional; defaults used if absent).
  const devConfig = await loadDevConfig(projectRoot);
  checks.push({
    name: "Dev config",
    status: "ok",
    detail: existsSync(join(projectRoot, ".xforge/dev/config.yaml"))
      ? "found"
      : "using defaults",
  });

  // Docs paths.
  const docsRoot = join(projectRoot, "docs/project");
  checks.push({
    name: "Docs (source of truth)",
    status: existsSync(docsRoot) ? "ok" : "warn",
    detail: existsSync(docsRoot)
      ? "docs/project"
      : "no docs/project (docs are default source)",
  });

  // Worktree root writability (never inside main source).
  checks.push({
    name: "Worktree root",
    status: "ok",
    detail: `${devConfig.worktrees.root} (main checkout read-only)`,
    // Purely informational — the dir is created lazily under .xforge/.
  });
  void worktreeRoot;

  // Figma / image adapter readiness (optional).
  checks.push({
    name: "Figma design map",
    status: existsSync(join(projectRoot, devConfig.figma.design_map))
      ? "ok"
      : "warn",
    detail: devConfig.figma.enabled
      ? existsSync(join(projectRoot, devConfig.figma.design_map))
        ? "found"
        : "enabled, no design-map.yaml (reference images allowed)"
      : "figma disabled",
  });

  // Disk.
  checks.push(await checkDisk(projectRoot));

  const ok = checks.every((c) => c.status !== "fail");
  const result: DevDoctorResult = {
    checks,
    ok,
    exitCode: ok ? ExitCode.Success : ExitCode.ConfigOrRuntimeError,
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderDoctor(result),
  );
  return result;
}

async function checkCommand(
  cmd: string,
  args: string[],
  label: string,
  optional: boolean,
): Promise<DevDoctorCheck> {
  try {
    await exec(cmd, args, { timeout: 8000 });
    return { name: label, status: "ok", detail: "available" };
  } catch {
    return {
      name: label,
      status: optional ? "warn" : "fail",
      detail: optional ? "not available (optional)" : "not available",
    };
  }
}

async function checkCleanMain(
  projectRoot: string,
  hasGit: boolean,
): Promise<DevDoctorCheck> {
  if (!hasGit)
    return { name: "Main checkout state", status: "warn", detail: "no git" };
  try {
    const { stdout } = await exec("git", ["status", "--porcelain"], {
      cwd: projectRoot,
      timeout: 8000,
    });
    const dirty = stdout.trim().length > 0;
    return {
      name: "Main checkout state",
      status: dirty ? "warn" : "ok",
      detail: dirty
        ? "dirty (dev never writes to main; worktrees branch from base)"
        : "clean",
    };
  } catch {
    return { name: "Main checkout state", status: "warn", detail: "unknown" };
  }
}

async function checkDisk(projectRoot: string): Promise<DevDoctorCheck> {
  try {
    const stats = await statfs(projectRoot);
    const freeGb = (stats.bsize * stats.bavail) / 1024 ** 3;
    return {
      name: "Disk space",
      status: freeGb >= 2 ? "ok" : "warn",
      detail: `${freeGb.toFixed(1)} GB free`,
    };
  } catch {
    return { name: "Disk space", status: "warn", detail: "unknown" };
  }
}

function renderDoctor(result: DevDoctorResult): void {
  const symbol = { ok: "✓", warn: "!", fail: "✗" } as const;
  process.stderr.write("\nXForge Dev doctor\n\n");
  const width = Math.max(...result.checks.map((c) => c.name.length));
  for (const c of result.checks) {
    process.stderr.write(
      `  ${symbol[c.status]} ${c.name.padEnd(width)}  ${c.detail}\n`,
    );
  }
  process.stderr.write(
    result.ok
      ? "\nReady to plan. Run `xforge dev plan --feature <id>`.\n"
      : "\nSome required checks failed; resolve them before planning.\n",
  );
}
