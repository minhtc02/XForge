/**
 * Structured error hierarchy for XForge.
 *
 * Every user-facing failure should map to an {@link XForgeError} subclass so the
 * CLI can render a consistent message and choose the right process exit code.
 *
 * Exit code convention (see blueprint §22):
 *   0 — success
 *   1 — expected operational failure (drift found, validation failed, etc.)
 *   2 — configuration or runtime error
 */

/** Process exit codes used across the CLI. */
export const ExitCode = {
  Success: 0,
  OperationalFailure: 1,
  ConfigOrRuntimeError: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Base class for all XForge errors. */
export class XForgeError extends Error {
  /** Stable machine-readable code, e.g. `CONFIG_INVALID`. */
  readonly code: string;
  /** Suggested process exit code. */
  readonly exitCode: ExitCodeValue;
  /** Optional structured detail, safe to serialize (must not contain secrets). */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      exitCode?: ExitCodeValue;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.exitCode = options.exitCode ?? ExitCode.ConfigOrRuntimeError;
    this.details = options.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serialize to a plain object suitable for `--json` output. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      exitCode: this.exitCode,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Configuration is missing, malformed, or fails schema validation. */
export class ConfigError extends XForgeError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, {
      code: "CONFIG_INVALID",
      exitCode: ExitCode.ConfigOrRuntimeError,
      ...options,
    });
  }
}

/** A required file, directory, or repository was not found. */
export class NotFoundError extends XForgeError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, {
      code: "NOT_FOUND",
      exitCode: ExitCode.ConfigOrRuntimeError,
      ...options,
    });
  }
}

/** A resource already exists and would be overwritten without `--force`. */
export class AlreadyExistsError extends XForgeError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, {
      code: "ALREADY_EXISTS",
      exitCode: ExitCode.ConfigOrRuntimeError,
      ...options,
    });
  }
}

/** Data failed schema/model validation (e.g. Project Model or generation output). */
export class ValidationError extends XForgeError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, {
      code: "VALIDATION_FAILED",
      exitCode: ExitCode.OperationalFailure,
      ...options,
    });
  }
}

/** Documentation drift detected against the last known state. */
export class DriftError extends XForgeError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, {
      code: "DRIFT_DETECTED",
      exitCode: ExitCode.OperationalFailure,
      ...options,
    });
  }
}

/** Type guard for {@link XForgeError}. */
export function isXForgeError(value: unknown): value is XForgeError {
  return value instanceof XForgeError;
}
