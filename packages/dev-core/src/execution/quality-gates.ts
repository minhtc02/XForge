import type { DevPlan } from "../models/plan.js";
import type { CommandRunner, CommandSpec } from "./runner.js";

/**
 * Optional quality gates (blueprint §20, Roadmap Phase 8). Build / test /
 * UI-check / performance are ALWAYS opt-in (§4.1, §19): none of these run during
 * a normal `dev run`. They are separate commands the user invokes explicitly,
 * and even then default to a dry run that records the exact command plan. UI and
 * performance verification hand off to XForge Test rather than duplicating its
 * simulator/visual engine (§22 reuse_xforge_test_visual_engine).
 */

export type GateKind = "build" | "test" | "ui-check" | "performance";

export interface GateInput {
  kind: GateKind;
  plan: DevPlan;
  runner: CommandRunner;
  dryRun: boolean;
  projectRoot: string;
  /** The integration worktree path the gate runs against. */
  worktreePath: string;
}

export interface GateOutcome {
  kind: GateKind;
  spec: CommandSpec;
  code: number;
  executed: boolean;
  handoff?: string;
}

/** Build the command-spec for a gate (never runs). Handoffs carry no spec exec. */
export function gateSpec(input: GateInput): CommandSpec {
  const cwd = `${input.projectRoot}/${input.worktreePath}`;
  switch (input.kind) {
    case "build":
      return {
        label: "xcodebuild build (opt-in)",
        command: "xcodebuild",
        args: ["build", "-quiet"],
        cwd,
      };
    case "test":
      return {
        label: "xcodebuild test (opt-in)",
        command: "xcodebuild",
        args: ["test", "-quiet"],
        cwd,
      };
    case "ui-check":
      return {
        label: "xforge test (UI verification handoff)",
        command: "xforge",
        args: ["test", "plan", "--dev-run", input.plan.id],
        cwd: input.projectRoot,
      };
    case "performance":
      return {
        label: "xforge test (performance handoff)",
        command: "xforge",
        args: ["test", "plan", "--dev-run", input.plan.id, "--level", "full"],
        cwd: input.projectRoot,
      };
  }
}

export async function runGate(input: GateInput): Promise<GateOutcome> {
  const spec = gateSpec(input);
  const handoff =
    input.kind === "ui-check" || input.kind === "performance"
      ? "XForge Test"
      : undefined;
  if (input.dryRun) {
    await input.runner.run(spec);
    return { kind: input.kind, spec, code: 0, executed: false, handoff };
  }
  const res = await input.runner.run(spec);
  return { kind: input.kind, spec, code: res.code, executed: true, handoff };
}
