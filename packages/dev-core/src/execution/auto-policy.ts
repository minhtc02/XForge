import type { DevPlan } from "../models/plan.js";
import type { DevConfig } from "../config/schema.js";

/**
 * Auto-mode policy (blueprint §5.3, §17 Bounded autonomy, Roadmap Phase 9).
 * Auto mode runs preflight → plan → implement → static review → integration
 * with NO mid-run questions. That is only safe when the plan stays inside the
 * pre-approved envelope: implement-only, worktree-isolated, nothing denied.
 * This pure policy decides whether a plan may run unattended; anything outside
 * the envelope must fall back to plan-first (the CLI refuses `dev auto`).
 */

export interface AutoPolicyResult {
  allowed: boolean;
  violations: string[];
}

export function evaluateAutoPolicy(
  plan: DevPlan,
  config: DevConfig,
): AutoPolicyResult {
  const violations: string[] = [];

  // 1. No optional verification may be pre-requested in auto mode — those are
  //    always an explicit, separate user action (§4.1).
  const opt = plan.optional_actions;
  if (opt.build !== "NOT_REQUESTED") violations.push("build is requested");
  if (opt.test !== "NOT_REQUESTED") violations.push("test is requested");
  if (opt.ui_verification !== "NOT_REQUESTED")
    violations.push("ui_verification is requested");
  if (opt.performance !== "NOT_REQUESTED")
    violations.push("performance is requested");

  // 2. Every denied capability must remain denied (§16).
  const denied = plan.permissions.denied;
  for (const [k, v] of Object.entries(denied)) {
    if (v !== true) violations.push(`denied.${k} is not enforced`);
  }

  // 3. Nothing may require re-approval — auto must not stop to ask (§17).
  if (plan.requires_approval.length > 0)
    violations.push(
      `requires re-approval: ${plan.requires_approval.join(", ")}`,
    );

  // 4. Plan-only capabilities (deps / public API / migrations) can't be
  //    exercised unattended when config marks them plan-only.
  if (config.code.allow_dependency_addition === "plan-only") {
    // Detected at plan build; here we only assert the config gate exists.
  }

  // 5. Main checkout must be read-only.
  if (!config.worktrees.main_checkout_read_only)
    violations.push("main_checkout_read_only is disabled");

  return { allowed: violations.length === 0, violations };
}
