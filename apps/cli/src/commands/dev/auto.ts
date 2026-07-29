import { ValidationError } from "@xforge/shared";
import { evaluateAutoPolicy } from "@xforge/dev-core";
import { emitResult, type CliContext } from "../../context.js";
import { runDevPlan } from "./plan.js";
import { runDevRun } from "./run.js";
import { loadDevModelContext, loadPlan } from "./shared.js";

/**
 * `xforge dev auto --feature <id>` (blueprint §5.3, §17 Bounded autonomy). Auto
 * mode plans then runs with NO mid-run questions — but only when the plan stays
 * inside the pre-approved envelope (implement-only, worktree-isolated, nothing
 * denied, no re-approval needed). If the policy is violated, auto REFUSES and
 * falls back to plan-first: the plan is still written, so the user can review
 * and run it explicitly. Optional verification is never triggered by auto.
 */

export interface DevAutoOptions {
  feature?: string;
  request?: string;
  execute?: boolean;
}

export async function runDevAuto(
  ctx: CliContext,
  options: DevAutoOptions,
): Promise<void> {
  if (!options.feature) {
    throw new ValidationError(
      "A feature is required: xforge dev auto --feature <id>",
    );
  }

  // 1. Plan (auto mode).
  const planResult = await runDevPlan(ctx, {
    feature: options.feature,
    request: options.request,
    mode: "auto",
  });

  // 2. Validate the auto policy against the written plan.
  const { plan } = await loadPlan(ctx.projectRoot, planResult.planId);
  const { devConfig } = await loadDevModelContext(ctx);
  const policy = evaluateAutoPolicy(plan, devConfig);

  if (!policy.allowed) {
    emitResult(
      ctx,
      {
        planId: planResult.planId,
        auto: false,
        violations: policy.violations,
      },
      () => {
        ctx.logger.warn(
          `Auto mode refused — plan is outside the pre-approved envelope. Falling back to plan-first.`,
        );
        process.stderr.write(
          `\n  Violations:\n${policy.violations.map((v) => `    - ${v}`).join("\n")}\n` +
            `\n  The plan was written. Review and run it explicitly:\n    xforge dev run ${planResult.planId} --dry-run\n`,
        );
      },
    );
    return;
  }

  // 3. Policy satisfied — proceed without asking. Dry-run unless --execute.
  ctx.logger.info(
    `Auto policy satisfied — proceeding ${options.execute ? "with execution" : "in dry-run preview"}.`,
  );
  await runDevRun(ctx, planResult.planId, { execute: options.execute });
}
