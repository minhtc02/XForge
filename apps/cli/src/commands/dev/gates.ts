import {
  DryRunCommandRunner,
  SpawnCommandRunner,
  runGate,
  type GateKind,
} from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";
import { loadPlan } from "./shared.js";

/**
 * Optional quality gate commands (blueprint §20). build/test/ui-check/
 * performance are ALWAYS opt-in — invoked explicitly, never during `dev run`
 * (§4.1). Each defaults to a dry run that records the exact command plan; pass
 * `--execute` to actually invoke it. UI/performance hand off to XForge Test
 * rather than duplicating its engines.
 */

export interface DevGateOptions {
  execute?: boolean;
}

export interface DevGateResult {
  planId: string;
  kind: GateKind;
  executed: boolean;
  command: string;
  args: string[];
  handoff?: string;
  code: number;
}

export async function runDevGate(
  ctx: CliContext,
  kind: GateKind,
  planId: string,
  options: DevGateOptions,
): Promise<DevGateResult> {
  const { plan } = await loadPlan(ctx.projectRoot, planId);
  const integration = plan.worktrees.find((w) => w.is_integration);
  const worktreePath = integration?.path ?? plan.worktrees[0]?.path ?? ".";
  const runner = options.execute
    ? new SpawnCommandRunner({ cwd: ctx.projectRoot })
    : new DryRunCommandRunner();

  const outcome = await runGate({
    kind,
    plan,
    runner,
    dryRun: !options.execute,
    projectRoot: ctx.projectRoot,
    worktreePath,
  });

  const result: DevGateResult = {
    planId,
    kind,
    executed: outcome.executed,
    command: outcome.spec.command,
    args: outcome.spec.args,
    handoff: outcome.handoff,
    code: outcome.code,
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    ctx.logger.info(
      `${kind} gate (${outcome.executed ? "executed" : "dry run"})${outcome.handoff ? ` → handoff to ${outcome.handoff}` : ""}`,
    );
    process.stderr.write(
      `\n  Command: ${outcome.spec.command} ${outcome.spec.args.join(" ")}\n` +
        `  (opt-in; never runs during 'dev run')\n`,
    );
  });
  return result;
}
