import type { TestPlan } from "../models/plan.js";
import type { TestConfig } from "../config/schema.js";
import type { RunResult, TestExecution } from "../models/result.js";
import type { TestStatus } from "../models/enums.js";
import type { CommandRunner } from "./runner.js";
import { buildExecutionPlan } from "./simulator.js";
import { computeRunStats } from "../reporting/report.js";

/**
 * QA Lead orchestration (blueprint §17.1, §15.2, §20). Build once, then run one
 * test invocation per shard. Continues on individual failure (§4.1) and retries
 * infrastructure failures up to the configured limit (§20.2). The actual
 * per-case results come from the xcresult parser; when running dry (or when a
 * shard's command fails to produce results) cases are marked BLOCKED, never
 * silently passed.
 */

export interface OrchestratorInput {
  plan: TestPlan;
  config: TestConfig;
  runId: string;
  runner: CommandRunner;
  dryRun: boolean;
  /**
   * Parse a shard's result bundle into executions. Injected so the orchestrator
   * stays pure/testable; the CLI supplies an xcresulttool-backed implementation.
   */
  collectShardResults?: (
    shardId: string,
    resultBundlePath: string,
  ) => Promise<TestExecution[]>;
  /**
   * Run the pre-flight accessibility probe (blueprint §13, optimization Phase
   * 4). Returns the screens it could not reach; a non-empty result aborts the
   * matrix, because every case behind an unreachable screen would only fail by
   * timeout and be triaged as a product bug.
   */
  runProbe?: (resultBundlePath: string) => Promise<{ unreachable: string[] }>;
  /** Whether to emit + run the probe invocation at all. */
  includeProbe?: boolean;
  /** UI test target used for `-only-testing:` identifiers. */
  uiTestTarget?: string;
  now?: () => Date;
}

function blockedExecutionsForShard(
  plan: TestPlan,
  shardId: string,
  status: TestStatus,
  message: string,
): TestExecution[] {
  const shard = plan.shards.find((s) => s.id === shardId);
  if (!shard) return [];
  return shard.case_ids.map((caseId) => ({
    case_id: caseId,
    shard_id: shardId,
    status,
    duration_ms: 0,
    message,
    retries: 0,
    evidence: [],
    verdict_source: "xcuitest",
  }));
}

export async function orchestrateRun(
  input: OrchestratorInput,
): Promise<RunResult> {
  const now = input.now ?? (() => new Date());
  const started = now().toISOString();
  const execPlan = buildExecutionPlan(input.plan, input.config, input.runId, {
    includeProbe: input.includeProbe,
    uiTestTarget: input.uiTestTarget,
  });
  const executions: TestExecution[] = [];

  // --- Build once (blueprint §15.2). ---
  let buildOk = true;
  if (!input.dryRun) {
    const buildResult = await input.runner.run(execPlan.build);
    buildOk = buildResult.code === 0;
  } else {
    // Dry-run records the command but performs no work.
    await input.runner.run(execPlan.build);
  }

  if (!buildOk) {
    // No test can run — every case is infrastructure-blocked, but the run
    // still completes (we never crash the whole pipeline).
    for (const shard of input.plan.shards) {
      executions.push(
        ...blockedExecutionsForShard(
          input.plan,
          shard.id,
          "INFRASTRUCTURE_FAILURE",
          "build-for-testing failed",
        ),
      );
    }
    return finalize(input, executions, started, now);
  }

  // --- Pre-flight accessibility probe (optimization Phase 4). ---
  // Runs after the single build, before the matrix: it does not save the build,
  // it saves running every shard into a wall of timeouts when the UI drifted.
  if (execPlan.probe && !input.dryRun && input.runProbe) {
    const probeResult = await input.runner.run(execPlan.probe.test);
    if (probeResult.code === 0) {
      const { unreachable } = await input.runProbe(
        execPlan.probe.resultBundlePath,
      );
      if (unreachable.length > 0) {
        for (const shard of input.plan.shards) {
          executions.push(
            ...blockedExecutionsForShard(
              input.plan,
              shard.id,
              "BLOCKED",
              `pre-flight probe could not reach: ${unreachable.join(", ")}`,
            ).map((e) => ({ ...e, verdict_source: "probe" as const })),
          );
        }
        return finalize(input, executions, started, now);
      }
    }
  } else if (execPlan.probe && input.dryRun) {
    await input.runner.run(execPlan.probe.test);
  }

  const maxInfraRetries = input.config.execution.retry_infrastructure_failure;

  // --- Per-shard test (continue on failure, §4.1). ---
  for (const worker of execPlan.workers) {
    if (input.dryRun) {
      for (const setup of worker.setup) await input.runner.run(setup);
      await input.runner.run(worker.test);
      executions.push(
        ...blockedExecutionsForShard(
          input.plan,
          worker.shard.id,
          "SKIPPED",
          "dry run — not executed",
        ),
      );
      continue;
    }

    // Apply this shard's OS-level state before its tests. A setup failure is an
    // environment problem, never a product bug (§4.4).
    let setupOk = true;
    for (const setup of worker.setup) {
      const result = await input.runner.run(setup);
      if (result.code !== 0) {
        setupOk = false;
        executions.push(
          ...blockedExecutionsForShard(
            input.plan,
            worker.shard.id,
            "ENVIRONMENT_BLOCKED",
            `state setup failed: ${setup.label}`,
          ),
        );
        break;
      }
    }
    if (!setupOk) continue;

    let attempt = 0;
    let shardExecs: TestExecution[] = [];
    for (;;) {
      const result = await input.runner.run(worker.test);
      const bundle = extractResultBundlePath(worker.test.args);
      if (result.code === 0 && input.collectShardResults && bundle) {
        shardExecs = await input.collectShardResults(worker.shard.id, bundle);
        break;
      }
      // Command failed: treat as infrastructure failure, retry up to limit.
      attempt += 1;
      if (attempt > maxInfraRetries) {
        shardExecs = blockedExecutionsForShard(
          input.plan,
          worker.shard.id,
          "INFRASTRUCTURE_FAILURE",
          `shard failed after ${attempt} attempt(s)`,
        ).map((e) => ({ ...e, retries: attempt - 1 }));
        break;
      }
    }
    executions.push(...shardExecs);
  }

  return finalize(input, executions, started, now);
}

function finalize(
  input: OrchestratorInput,
  executions: TestExecution[],
  started: string,
  now: () => Date,
): RunResult {
  const stats = computeRunStats(executions);
  return {
    schema_version: 1,
    run_id: input.runId,
    plan_id: input.plan.id,
    project_id: input.plan.project_id,
    started_at: started,
    finished_at: now().toISOString(),
    dry_run: input.dryRun,
    executions,
    stats,
    gate_passed: stats.gate_passed,
  };
}

/** Recover the `-resultBundlePath` value from a test command's args. */
export function extractResultBundlePath(args: string[]): string | undefined {
  const idx = args.indexOf("-resultBundlePath");
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Make a run id like XFRUN-20260729-001. */
export function makeRunId(date: Date, sequence: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `XFRUN-${y}${m}${d}-${String(sequence).padStart(3, "0")}`;
}
