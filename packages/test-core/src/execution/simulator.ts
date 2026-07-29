import type { SimulatorShard, TestPlan } from "../models/plan.js";
import type { TestConfig } from "../config/schema.js";
import type { CommandSpec } from "./runner.js";

/**
 * Simulator worker lifecycle + build strategy (blueprint §15.2, §16).
 *
 * Phase 1 models the lifecycle and produces the deterministic *command plan*
 * (build once → test-without-building per worker) without executing it. The
 * command strings are derived from project config — never hard-coded workspace
 * or scheme (§15).
 */

export type WorkerPhase =
  | "create-or-reuse"
  | "boot"
  | "wait-boot"
  | "reset-state"
  | "install-app"
  | "run-tests"
  | "collect-artifacts"
  | "shutdown";

export const WORKER_LIFECYCLE: WorkerPhase[] = [
  "create-or-reuse",
  "boot",
  "wait-boot",
  "reset-state",
  "install-app",
  "run-tests",
  "collect-artifacts",
  "shutdown",
];

export interface WorkerState {
  shardId: string;
  simulatorName: string;
  /** UDID assigned at runtime; unknown during planning. */
  udid?: string;
  phase: WorkerPhase;
  retriesInfrastructure: number;
}

export interface BuildCommandContext {
  workspace?: string;
  project?: string;
  scheme: string;
  configuration: string;
  derivedDataPath: string;
}

function projectFlags(ctx: BuildCommandContext): string[] {
  // Prefer workspace, fall back to project; never invent one.
  if (ctx.workspace && ctx.workspace !== "auto")
    return ["-workspace", ctx.workspace];
  if (ctx.project && ctx.project !== "auto") return ["-project", ctx.project];
  return [];
}

/** The single build-for-testing command (blueprint §15.2). */
export function buildForTestingCommand(ctx: BuildCommandContext): CommandSpec {
  return {
    label: "build-for-testing",
    command: "xcodebuild",
    args: [
      ...projectFlags(ctx),
      "-scheme",
      ctx.scheme,
      "-configuration",
      ctx.configuration,
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      ctx.derivedDataPath,
      "build-for-testing",
    ],
  };
}

/** Per-worker test-without-building command (blueprint §15.2). */
export function testWithoutBuildingCommand(
  ctx: BuildCommandContext,
  shard: SimulatorShard,
  udidPlaceholder: string,
  resultBundlePath: string,
): CommandSpec {
  return {
    label: `test-without-building:${shard.id}`,
    command: "xcodebuild",
    args: [
      ...projectFlags(ctx),
      "-scheme",
      ctx.scheme,
      "-destination",
      `platform=iOS Simulator,id=${udidPlaceholder}`,
      "-derivedDataPath",
      ctx.derivedDataPath,
      "-resultBundlePath",
      resultBundlePath,
      "test-without-building",
    ],
  };
}

export interface ExecutionPlan {
  build: CommandSpec;
  workers: Array<{ shard: SimulatorShard; test: CommandSpec }>;
  derivedDataPath: string;
}

/**
 * Produce a dry-run execution plan from an approved-shape plan + config.
 * No commands are executed; this is the deterministic command list the runner
 * will later execute (build once, then one test invocation per shard).
 */
export function buildExecutionPlan(
  plan: TestPlan,
  config: TestConfig,
  runId: string,
): ExecutionPlan {
  const ctx: BuildCommandContext = {
    workspace: config.project.workspace,
    project: config.project.project,
    scheme: config.project.scheme,
    configuration: config.project.configuration,
    derivedDataPath: ".xforge/test/DerivedData",
  };
  return {
    build: buildForTestingCommand(ctx),
    derivedDataPath: ctx.derivedDataPath,
    workers: plan.shards.map((shard) => ({
      shard,
      test: testWithoutBuildingCommand(
        ctx,
        shard,
        `<UDID:${shard.simulator_name}>`,
        `${config.output.runs_root}/${runId}/xcresult/${shard.id}.xcresult`,
      ),
    })),
  };
}
