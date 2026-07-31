import type { SimulatorShard, TestPlan } from "../models/plan.js";
import type { TestConfig } from "../config/schema.js";
import type { CommandSpec } from "./runner.js";
import { stateSetupCommands } from "./simctl.js";

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
  | "apply-state"
  | "run-tests"
  | "collect-artifacts"
  | "shutdown";

export const WORKER_LIFECYCLE: WorkerPhase[] = [
  "create-or-reuse",
  "boot",
  "wait-boot",
  "reset-state",
  "install-app",
  // OS-level state (permissions, fresh install, appearance, deep link) is
  // applied after the app is installed and before tests run — simctl runs in
  // the host process and cannot act between cases of one xcodebuild run.
  "apply-state",
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

/**
 * Per-worker test-without-building command (blueprint §15.2).
 *
 * `onlyTesting` narrows the invocation to specific `Target/Class[/method]`
 * identifiers. That is what lets one shard run a subset of the test bundle,
 * which state buckets and the pre-flight probe both depend on.
 */
export function testWithoutBuildingCommand(
  ctx: BuildCommandContext,
  shard: SimulatorShard,
  udidPlaceholder: string,
  resultBundlePath: string,
  onlyTesting: string[] = [],
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
      ...onlyTesting.flatMap((t) => [`-only-testing:${t}`]),
      "test-without-building",
    ],
  };
}

/**
 * Where `build-for-testing` puts the `.app`. Needed to reinstall after a
 * fresh-install state wipe. Derived from config, never hard-coded (§15).
 */
export function builtAppPath(
  ctx: BuildCommandContext,
  productName: string,
): string {
  return `${ctx.derivedDataPath}/Build/Products/${ctx.configuration}-iphonesimulator/${productName}.app`;
}

export interface ExecutionPlan {
  build: CommandSpec;
  workers: Array<{
    shard: SimulatorShard;
    /** simctl commands applied in the `apply-state` phase, before `test`. */
    setup: CommandSpec[];
    test: CommandSpec;
  }>;
  derivedDataPath: string;
  /** Result bundle for the optional pre-flight probe, when one is planned. */
  probe?: { test: CommandSpec; resultBundlePath: string };
}

/**
 * Produce a dry-run execution plan from an approved-shape plan + config.
 * No commands are executed; this is the deterministic command list the runner
 * will later execute (build once, then one test invocation per shard).
 */
export interface ExecutionPlanOptions {
  /** Emit the pre-flight accessibility probe invocation. */
  includeProbe?: boolean;
  /** UI test target name used to build `-only-testing:` identifiers. */
  uiTestTarget?: string;
}

export function buildExecutionPlan(
  plan: TestPlan,
  config: TestConfig,
  runId: string,
  options: ExecutionPlanOptions = {},
): ExecutionPlan {
  const ctx: BuildCommandContext = {
    workspace: config.project.workspace,
    project: config.project.project,
    scheme: config.project.scheme,
    configuration: config.project.configuration,
    derivedDataPath: ".xforge/test/DerivedData",
  };

  const bundleId = config.project.app_bundle_id;
  const target =
    options.uiTestTarget && options.uiTestTarget !== "auto"
      ? options.uiTestTarget
      : config.project.ui_test_target !== "auto"
        ? config.project.ui_test_target
        : undefined;
  const appPath = builtAppPath(ctx, config.project.scheme);
  const runRoot = `${config.output.runs_root}/${runId}`;

  const workers = plan.shards.map((shard) => {
    const udid = `<UDID:${shard.simulator_name}>`;
    const setup =
      shard.state && bundleId !== "auto"
        ? stateSetupCommands(shard.state, {
            udid,
            bundleId,
            appPath,
            pushPayloadDir: `${runRoot}/push-payloads`,
            deepLinkMode: config.state.deep_link_mode,
          })
        : [];
    return {
      shard,
      setup,
      test: testWithoutBuildingCommand(
        ctx,
        shard,
        udid,
        `${runRoot}/xcresult/${shard.id}.xcresult`,
        // Without a known UI test target we cannot build a valid
        // `-only-testing:` identifier, so the whole bundle runs — correct,
        // just less selective.
        target ? [target] : [],
      ),
    };
  });

  const probe =
    options.includeProbe && target
      ? {
          test: testWithoutBuildingCommand(
            ctx,
            {
              ...plan.shards[0]!,
              id: "probe",
            },
            `<UDID:${plan.shards[0]?.simulator_name ?? "probe"}>`,
            `${runRoot}/xcresult/probe.xcresult`,
            [`${target}/XForgeProbeTests/test_XForgeProbe`],
          ),
          resultBundlePath: `${runRoot}/xcresult/probe.xcresult`,
        }
      : undefined;

  return {
    build: buildForTestingCommand(ctx),
    derivedDataPath: ctx.derivedDataPath,
    workers,
    ...(probe ? { probe } : {}),
  };
}
