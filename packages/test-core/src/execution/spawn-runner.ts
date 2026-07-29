import { execFile } from "node:child_process";
import type { CommandRunner, CommandResult, CommandSpec } from "./runner.js";

/**
 * Real command runner backed by child_process (blueprint §15). Only used when
 * the user explicitly opts into live execution; planning and the default `run`
 * path use {@link DryRunCommandRunner}. Never runs a shell — args are passed as
 * an array so there is no shell-injection surface (§29).
 */
export interface SpawnRunnerOptions {
  timeoutMs?: number;
  cwd?: string;
}

export class SpawnCommandRunner implements CommandRunner {
  constructor(private readonly options: SpawnRunnerOptions = {}) {}

  run(spec: CommandSpec): Promise<CommandResult> {
    const start = Date.now();
    return new Promise<CommandResult>((resolve) => {
      execFile(
        spec.command,
        spec.args,
        {
          cwd: spec.cwd ?? this.options.cwd,
          timeout: this.options.timeoutMs ?? 30 * 60 * 1000,
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: number }).code === "number"
              ? ((error as { code?: number }).code as number)
              : error
                ? 1
                : 0;
          resolve({
            spec,
            code,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            durationMs: Date.now() - start,
          });
        },
      );
    });
  }
}
