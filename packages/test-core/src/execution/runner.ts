/**
 * Command runner abstraction (blueprint §15, master prompt §8).
 *
 * The runner isolates all shell execution behind an interface so Phase 1 can
 * produce a *dry-run* command list without executing anything, and later phases
 * can swap in a real `execa`-backed runner. This keeps planning fully
 * deterministic and testable, and guarantees no destructive command runs
 * outside XForge directories (§29) because callers construct the commands.
 */

export interface CommandSpec {
  /** Human label for logs / dry-run output. */
  label: string;
  command: string;
  args: string[];
  cwd?: string;
}

export interface CommandResult {
  spec: CommandSpec;
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

/**
 * A runner that executes nothing and records the commands it was asked to run.
 * Used for Phase 1 dry-run execution plans and for unit tests.
 */
export class DryRunCommandRunner implements CommandRunner {
  readonly recorded: CommandSpec[] = [];

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.recorded.push(spec);
    return {
      spec,
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
    };
  }
}
