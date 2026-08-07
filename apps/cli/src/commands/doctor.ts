import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { configPath, globRootDir, loadConfig, stateRoot } from "@xforge/core";
import { ExitCode, type Logger } from "@xforge/shared";
import { emitResult, type CliContext } from "../context.js";

const exec = promisify(execFile);

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ok: boolean;
  exitCode: number;
}

/**
 * `xforge doctor` (blueprint §24.4, master prompt §4).
 *
 * Environment + config health checks. Optional tooling (Xcode CLT, SourceKit)
 * produces a warning rather than a failure so XForge stays usable off-Mac.
 */
export async function runDoctor(ctx: CliContext): Promise<DoctorResult> {
  const { projectRoot } = ctx;
  const checks: DoctorCheck[] = [];

  // Node version
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js >= 20",
    status: nodeMajor >= 20 ? "ok" : "fail",
    detail: `v${process.versions.node}`,
  });

  // Git
  checks.push(await checkCommand("git", ["--version"], "Git"));

  // Project root / git repo
  checks.push({
    name: "Project root",
    status: "ok",
    detail: projectRoot,
  });
  checks.push({
    name: "Git repository",
    status: existsSync(join(projectRoot, ".git")) ? "ok" : "warn",
    detail: existsSync(join(projectRoot, ".git"))
      ? "found"
      : "no .git directory",
  });

  // Config validity
  const cfgPath = configPath(projectRoot);
  if (!existsSync(cfgPath)) {
    checks.push({
      name: "XForge config",
      status: "warn",
      detail: "not initialized (run `xforge init`)",
    });
  } else {
    try {
      const cfg = await loadConfig(projectRoot);
      checks.push({
        name: "XForge config",
        status: "ok",
        detail: `valid (profile: ${cfg.project.profile})`,
      });
      // Output directory
      const outDir = join(projectRoot, cfg.output.root);
      checks.push({
        name: "Output directory",
        status: existsSync(outDir) ? "ok" : "warn",
        detail: existsSync(outDir)
          ? cfg.output.root
          : `missing: ${cfg.output.root}`,
      });

      // The project's own documents — the default source of truth for `docs`.
      const projectDocsRoot =
        globRootDir(cfg.sources.project_docs[0] ?? "") ?? "docs/project";
      const projectDocsDir = join(projectRoot, projectDocsRoot);
      checks.push({
        name: "Project docs (source)",
        status: existsSync(projectDocsDir) ? "ok" : "warn",
        detail: existsSync(projectDocsDir)
          ? projectDocsRoot
          : `missing: ${projectDocsRoot} — \`docs\` will have no intent to compare against`,
      });

      // Reading and writing the same tree makes a run agree with itself.
      const outputRoot = cfg.output.root.replace(/\/+$/, "");
      const overlaps =
        outputRoot === projectDocsRoot ||
        outputRoot.startsWith(`${projectDocsRoot}/`);
      if (overlaps) {
        checks.push({
          name: "Docs input/output separation",
          status: "fail",
          detail:
            `output.root (${outputRoot}) is inside the project docs tree ` +
            `(${projectDocsRoot}); \`docs\` would read its own output as ` +
            "requirements. Run `xforge upgrade` for the fix.",
        });
      }
    } catch (e) {
      checks.push({
        name: "XForge config",
        status: "fail",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // State directory
  checks.push({
    name: "State directory",
    status: existsSync(stateRoot(projectRoot)) ? "ok" : "warn",
    detail: existsSync(stateRoot(projectRoot)) ? ".xforge/" : "not created",
  });

  // Xcode command line tools (optional)
  checks.push(
    await checkCommand(
      "xcode-select",
      ["-p"],
      "Xcode command line tools",
      true,
    ),
  );

  // SourceKit-LSP (optional)
  checks.push(
    await checkCommand(
      "sourcekit-lsp",
      ["--help"],
      "SourceKit-LSP (optional)",
      true,
    ),
  );

  const ok = checks.every((c) => c.status !== "fail");
  const result: DoctorResult = {
    checks,
    ok,
    exitCode: ok ? ExitCode.Success : ExitCode.ConfigOrRuntimeError,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderDoctor(ctx.logger, result),
  );
  return result;
}

async function checkCommand(
  cmd: string,
  args: string[],
  label: string,
  optional = false,
): Promise<DoctorCheck> {
  try {
    const { stdout } = await exec(cmd, args, { timeout: 5000 });
    return {
      name: label,
      status: "ok",
      detail: stdout.split("\n")[0]?.trim() || "available",
    };
  } catch {
    return {
      name: label,
      status: optional ? "warn" : "fail",
      detail: optional ? "not available (optional)" : "not found",
    };
  }
}

function renderDoctor(logger: Logger, result: DoctorResult): void {
  const symbol = { ok: "✓", warn: "!", fail: "✗" } as const;
  process.stderr.write("\nXForge doctor\n\n");
  const width = Math.max(...result.checks.map((c) => c.name.length));
  for (const c of result.checks) {
    process.stderr.write(
      `  ${symbol[c.status]} ${c.name.padEnd(width)}  ${c.detail}\n`,
    );
  }
  process.stderr.write(
    result.ok
      ? "\nAll required checks passed.\n"
      : "\nSome required checks failed.\n",
  );
  void logger;
}
