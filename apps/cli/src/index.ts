#!/usr/bin/env node
import { Command } from "commander";
import { ExitCode, isXForgeError, XFORGE_VERSION } from "@xforge/shared";
import { createContext, type GlobalOptions } from "./context.js";
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runDocs } from "./commands/docs.js";
import { runSync } from "./commands/sync.js";
import { runCheck } from "./commands/check.js";
import { runInspect, type InspectTarget } from "./commands/inspect.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runTestDoctor } from "./commands/test/doctor.js";
import { runTestPlan } from "./commands/test/plan.js";
import { runTestApprove } from "./commands/test/approve.js";
import { runTestGenerate } from "./commands/test/generate.js";
import { runTestNavigation } from "./commands/test/navigation.js";
import { runTestRun } from "./commands/test/run.js";
import {
  runTestBugs,
  runTestClean,
  runTestReport,
  runTestStatus,
} from "./commands/test/reports.js";
import { runDevDoctor } from "./commands/dev/doctor.js";
import { runDevPlan } from "./commands/dev/plan.js";
import { runDevRun } from "./commands/dev/run.js";
import { runDevAuto } from "./commands/dev/auto.js";
import {
  runDevClean,
  runDevReport,
  runDevReview,
  runDevStatus,
} from "./commands/dev/reports.js";
import { runDevAccept, runDevReject } from "./commands/dev/accept.js";
import {
  runDevDismissSpec,
  runDevInspectSpec,
  runDevSyncDocs,
} from "./commands/dev/spec.js";
import { runDevGate } from "./commands/dev/gates.js";

/**
 * XForge CLI entrypoint (blueprint §24). All business logic lives in the
 * command modules / core package; this file only wires Commander to them and
 * translates errors into exit codes.
 */

function globalOpts(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals();
  return {
    cwd: opts.cwd,
    json: opts.json,
    verbose: opts.verbose,
    quiet: opts.quiet,
  };
}

async function run(
  fn: (ctx: ReturnType<typeof createContext>) => Promise<unknown>,
  cmd: Command,
): Promise<void> {
  const ctx = createContext(globalOpts(cmd));
  try {
    await fn(ctx);
  } catch (error) {
    handleError(ctx.json, error);
  }
}

function handleError(json: boolean, error: unknown): never {
  if (isXForgeError(error)) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ error: error.toJSON() }, null, 2) + "\n",
      );
    } else {
      process.stderr.write(`✗ ${error.message}\n`);
    }
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    process.stdout.write(
      JSON.stringify({ error: { code: "UNEXPECTED", message } }, null, 2) +
        "\n",
    );
  } else {
    process.stderr.write(`✗ Unexpected error: ${message}\n`);
  }
  process.exit(ExitCode.ConfigOrRuntimeError);
}

const program = new Command();

program
  .name("xforge")
  .description("XForge — Project Knowledge Compiler & AI Development Toolkit")
  .version(XFORGE_VERSION, "-V, --version")
  .option("--cwd <dir>", "run as if started in <dir>")
  .option("--json", "emit machine-readable JSON to stdout", false)
  .option("-v, --verbose", "verbose (debug) logging", false)
  .option("-q, --quiet", "only log errors", false)
  .showHelpAfterError();

program
  .command("init")
  .description("Initialize XForge in the current repository")
  .option("--profile <profile>", "project profile: ios-swift | generic")
  .option("--output <dir>", "documentation output directory")
  .option("--non-interactive", "do not prompt", false)
  .option("--force", "overwrite an existing config", false)
  .action(async (opts, cmd: Command) => {
    await run(
      (ctx) =>
        runInit(ctx, {
          profile: opts.profile,
          output: opts.output,
          nonInteractive: opts.nonInteractive,
          force: opts.force,
        }),
      cmd,
    );
  });

program
  .command("doctor")
  .description("Check environment and configuration health")
  .action(async (_opts, cmd: Command) => {
    await run(async (ctx) => {
      const result = await runDoctor(ctx);
      if (!result.ok) process.exit(result.exitCode);
    }, cmd);
  });

const docs = program
  .command("docs")
  .description("Generate project documentation from source + docs")
  .option("--focus <topics>", "comma-separated focus areas")
  .option("--prd <path>", "path to a PRD document")
  .option("--input <path>", "additional input document")
  .option("--language <lang>", "output language (e.g. vi, en)")
  .option("--dry-run", "do not write files", false)
  .action(async (opts, cmd: Command) => {
    await run(
      (ctx) =>
        runDocs(ctx, {
          focus: opts.focus,
          prd: opts.prd,
          input: opts.input,
          language: opts.language,
          dryRun: opts.dryRun,
        }),
      cmd,
    );
  });

docs
  .command("sync")
  .description("Regenerate documentation for changed files")
  .action(async (_opts, cmd: Command) => {
    await run((ctx) => runSync(ctx), cmd);
  });

docs
  .command("check")
  .description("Check for documentation drift (exit 1 if drift found)")
  .action(async (_opts, cmd: Command) => {
    await run((ctx) => runCheck(ctx), cmd);
  });

program
  .command("upgrade")
  .description(
    "Bring a project initialized by an older XForge up to date (never overwrites your settings)",
  )
  .option("--dry-run", "report what would change without writing", false)
  .action(async (opts, cmd: Command) => {
    await run((ctx) => runUpgrade(ctx, { dryRun: opts.dryRun }), cmd);
  });

program
  .command("inspect")
  .description("Inspect the Project Model")
  .argument(
    "[target]",
    "project | features | requirements | evidence | technologies",
    "project",
  )
  .action(async (target: string, _opts, cmd: Command) => {
    const valid: InspectTarget[] = [
      "project",
      "features",
      "requirements",
      "evidence",
      "technologies",
    ];
    const t = valid.includes(target as InspectTarget)
      ? (target as InspectTarget)
      : "project";
    await run((ctx) => runInspect(ctx, t), cmd);
  });

// --- xforge test (XForge Test module, blueprint §6) ---
const test = program
  .command("test")
  .description("XForge Test — Autonomous iOS QA orchestrator");

test
  .command("doctor")
  .description("Check the QA environment and configuration health")
  .action(async (_opts, cmd: Command) => {
    await run(async (ctx) => {
      const result = await runTestDoctor(ctx);
      if (!result.ok) process.exit(result.exitCode);
    }, cmd);
  });

test
  .command("plan")
  .description(
    "Preflight, scaffold navigation, plan, and generate sources (runs no tests)",
  )
  .option("--feature <ids>", "comma-separated feature ids to scope the plan")
  .option("--level <level>", "smoke | critical | regression | full")
  .option("--no-doctor", "skip the environment preflight")
  .option("--no-navigation", "do not scaffold navigation.yaml when missing")
  .option("--no-generate", "do not generate XCUITest sources after planning")
  .option("--probe", "also generate the accessibility probe class", false)
  .option("--force", "overwrite existing generated sources", false)
  .action(async (opts, cmd: Command) => {
    await run(
      (ctx) =>
        runTestPlan(ctx, {
          feature: opts.feature,
          level: opts.level,
          doctor: opts.doctor,
          navigation: opts.navigation,
          generate: opts.generate,
          probe: opts.probe,
          force: opts.force,
        }),
      cmd,
    );
  });

test
  .command("navigation")
  .description("Inspect (or scaffold) the navigation graph used for BFS paths")
  .option("--init", "scaffold navigation.yaml from the Project Model", false)
  .option("--force", "overwrite an existing navigation.yaml", false)
  .action(async (opts, cmd: Command) => {
    await run(
      (ctx) => runTestNavigation(ctx, { init: opts.init, force: opts.force }),
      cmd,
    );
  });

test
  .command("generate")
  .description("Generate XCUITest sources for a plan (writes Swift, no build)")
  .argument("<plan-id>", "the plan id, e.g. XFPLAN-20260729-001")
  .option("--probe", "also emit the accessibility-tree probe class", false)
  .option("--force", "overwrite existing generated sources", false)
  .action(async (planId: string, opts, cmd: Command) => {
    await run(
      (ctx) =>
        runTestGenerate(ctx, planId, {
          probe: opts.probe,
          force: opts.force,
        }),
      cmd,
    );
  });

test
  .command("approve")
  .description("Approve a test plan (one-time, immutable manifest)")
  .argument("<plan-id>", "the plan id, e.g. XFPLAN-20260729-001")
  .option("--verify", "verify approval status without writing", false)
  .action(async (planId: string, opts, cmd: Command) => {
    await run(
      (ctx) => runTestApprove(ctx, planId, { verify: opts.verify }),
      cmd,
    );
  });

test
  .command("run")
  .description("Run an approved plan (dry run by default; --execute for real)")
  .argument("<plan-id>", "the approved plan id")
  .option("--execute", "actually invoke xcodebuild/simctl (needs Xcode)", false)
  .action(async (planId: string, opts, cmd: Command) => {
    await run((ctx) => runTestRun(ctx, planId, { execute: opts.execute }), cmd);
  });

test
  .command("status")
  .description("Show the status of a run (latest by default)")
  .argument("[run-id]", "run id (defaults to the latest run)")
  .option("--latest", "use the most recent run", false)
  .action(async (runId: string | undefined, _opts, cmd: Command) => {
    await run((ctx) => runTestStatus(ctx, runId), cmd);
  });

test
  .command("report")
  .description("Print a run's QA summary (latest by default)")
  .argument("[run-id]", "run id (defaults to the latest run)")
  .option("--latest", "use the most recent run", false)
  .action(async (runId: string | undefined, _opts, cmd: Command) => {
    await run((ctx) => runTestReport(ctx, runId), cmd);
  });

test
  .command("bugs")
  .description("List deduplicated bugs from a run (latest by default)")
  .argument("[run-id]", "run id (defaults to the latest run)")
  .option("--latest", "use the most recent run", false)
  .action(async (runId: string | undefined, _opts, cmd: Command) => {
    await run((ctx) => runTestBugs(ctx, runId), cmd);
  });

test
  .command("clean")
  .description("Remove XForge-managed run artifacts and cache")
  .argument("[target]", "runs | cache (default: both)")
  .action(async (target: string, _opts, cmd: Command) => {
    await run((ctx) => runTestClean(ctx, target), cmd);
  });

// --- xforge dev (XForge Dev module, blueprint §6) ---
const dev = program
  .command("dev")
  .description("XForge Dev — Spec-first autonomous development orchestrator");

dev
  .command("doctor")
  .description("Check the development environment and configuration health")
  .action(async (_opts, cmd: Command) => {
    await run(async (ctx) => {
      const result = await runDevDoctor(ctx);
      if (!result.ok) process.exit(result.exitCode);
    }, cmd);
  });

dev
  .command("plan")
  .description(
    "Resolve the Effective Spec and generate a dev plan (no code changes)",
  )
  .option("--feature <id>", "feature id to plan")
  .option("--request <text>", "user request that may override docs this run")
  .option("--auto", "plan for auto mode (still policy-bounded)", false)
  .action(async (opts, cmd: Command) => {
    await run(
      (ctx) =>
        runDevPlan(ctx, {
          feature: opts.feature,
          request: opts.request,
          mode: opts.auto ? "auto" : "plan-first",
        }),
      cmd,
    );
  });

dev
  .command("run")
  .description(
    "Run a dev plan (dry-run preview by default; --execute for real)",
  )
  .argument("<plan-id>", "the dev plan id")
  .option("--dry-run", "show what a run would do (default)", false)
  .option(
    "--execute",
    "create worktrees, integrate, and write a delivery package",
    false,
  )
  .action(async (planId: string, opts, cmd: Command) => {
    await run(
      (ctx) =>
        runDevRun(ctx, planId, {
          dryRun: opts.dryRun,
          execute: opts.execute,
        }),
      cmd,
    );
  });

dev
  .command("auto")
  .description("Plan + run without mid-run questions (policy-bounded)")
  .option("--feature <id>", "feature id to plan and run")
  .option("--request <text>", "user request that may override docs this run")
  .option("--execute", "execute if the auto policy is satisfied", false)
  .action(async (opts, cmd: Command) => {
    await run(
      (ctx) =>
        runDevAuto(ctx, {
          feature: opts.feature,
          request: opts.request,
          execute: opts.execute,
        }),
      cmd,
    );
  });

dev
  .command("status")
  .description("Show a dev run's status (latest by default)")
  .argument("[run-id]", "run id (defaults to the latest run)")
  .action(async (runId: string | undefined, _opts, cmd: Command) => {
    await run((ctx) => runDevStatus(ctx, runId), cmd);
  });

dev
  .command("report")
  .description("Print a dev run's delivery summary (latest by default)")
  .argument("[run-id]", "run id (defaults to the latest run)")
  .action(async (runId: string | undefined, _opts, cmd: Command) => {
    await run((ctx) => runDevReport(ctx, runId), cmd);
  });

dev
  .command("review")
  .description("Print a dev run's static review (latest by default)")
  .argument("[run-id]", "run id (defaults to the latest run)")
  .action(async (runId: string | undefined, _opts, cmd: Command) => {
    await run((ctx) => runDevReview(ctx, runId), cmd);
  });

dev
  .command("accept")
  .description("Accept a run's code (independent from docs sync, §4.4)")
  .argument("<run-id>", "the run id")
  .action(async (runId: string, _opts, cmd: Command) => {
    await run((ctx) => runDevAccept(ctx, runId), cmd);
  });

dev
  .command("reject")
  .description("Reject a run's code")
  .argument("<run-id>", "the run id")
  .action(async (runId: string, _opts, cmd: Command) => {
    await run((ctx) => runDevReject(ctx, runId), cmd);
  });

dev
  .command("clean")
  .description("Remove XForge-managed runs or worktrees (never main checkout)")
  .argument("[target]", "runs | worktrees", "runs")
  .action(async (target: string, _opts, cmd: Command) => {
    const t = target === "worktrees" ? "worktrees" : "runs";
    await run((ctx) => runDevClean(ctx, t), cmd);
  });

// Optional quality gates (opt-in; never run during `dev run`).
for (const kind of ["build", "test", "ui-check", "performance"] as const) {
  dev
    .command(kind)
    .description(`Optional ${kind} gate (opt-in; dry-run unless --execute)`)
    .argument("<plan-id>", "the dev plan id")
    .option("--execute", "actually invoke the command", false)
    .action(async (planId: string, opts, cmd: Command) => {
      await run(
        (ctx) => runDevGate(ctx, kind, planId, { execute: opts.execute }),
        cmd,
      );
    });
}

// Staged Spec journal commands.
dev
  .command("inspect-spec")
  .description("Print a plan's Staged Spec journal")
  .argument("<plan-id>", "the dev plan id")
  .action(async (planId: string, _opts, cmd: Command) => {
    await run((ctx) => runDevInspectSpec(ctx, planId), cmd);
  });

dev
  .command("sync-docs")
  .description("Apply the Staged Spec's proposed doc patches (drift-protected)")
  .argument("<plan-id>", "the dev plan id")
  .action(async (planId: string, _opts, cmd: Command) => {
    await run((ctx) => runDevSyncDocs(ctx, planId), cmd);
  });

dev
  .command("dismiss-spec")
  .description("Dismiss a plan's Staged Spec changes (docs untouched)")
  .argument("<plan-id>", "the dev plan id")
  .action(async (planId: string, _opts, cmd: Command) => {
    await run((ctx) => runDevDismissSpec(ctx, planId), cmd);
  });

program.parseAsync(process.argv).catch((error) => {
  handleError(false, error);
});
