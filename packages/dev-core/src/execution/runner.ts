/**
 * Command runner abstraction (blueprint §15, §19, master prompt §Worktree
 * safety). All shell execution — git worktree management, optional build/test —
 * lives behind this interface so the default `run` path can produce a *dry-run*
 * command list without executing anything, while `--execute` swaps in a real
 * child_process-backed runner. Callers construct every CommandSpec, so no
 * destructive command is ever synthesised from untrusted input, and args are
 * always an array (no shell, no injection surface).
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
 * Used for the default dry-run execution plans and for unit tests.
 */
export class DryRunCommandRunner implements CommandRunner {
  readonly recorded: CommandSpec[] = [];

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.recorded.push(spec);
    return { spec, code: 0, stdout: "", stderr: "", durationMs: 0 };
  }
}
