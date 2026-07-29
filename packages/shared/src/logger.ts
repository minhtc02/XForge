/**
 * Minimal structured logger.
 *
 * Two output modes:
 *  - `text` (default): human-friendly lines on stderr, with an optional symbol.
 *  - `json`: one JSON object per line on stderr (structured logging).
 *
 * Machine-readable command *results* are written to stdout by the CLI; all
 * diagnostic logging goes to stderr so `--json` result payloads stay clean.
 *
 * The logger never formats secret values itself, but callers should redact
 * anything sensitive before logging (see @xforge/core redaction utilities).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFormat = "text" | "json";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const TEXT_SYMBOL: Record<LogLevel, string> = {
  debug: "·",
  info: "•",
  warn: "!",
  error: "✗",
};

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  /** Sink for output; defaults to writing to stderr. Injectable for tests. */
  sink?: (line: string) => void;
}

export interface Logger {
  readonly level: LogLevel;
  readonly format: LogFormat;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Print a plain success/status line (text mode only; no-op in json mode). */
  success(message: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function defaultSink(line: string): void {
  process.stderr.write(line + "\n");
}

class StructuredLogger implements Logger {
  readonly level: LogLevel;
  readonly format: LogFormat;
  private readonly sink: (line: string) => void;
  private readonly bindings: Record<string, unknown>;

  constructor(
    options: LoggerOptions = {},
    bindings: Record<string, unknown> = {},
  ) {
    this.level = options.level ?? "info";
    this.format = options.format ?? "text";
    this.sink = options.sink ?? defaultSink;
    this.bindings = bindings;
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (!this.enabled(level)) return;
    const merged = { ...this.bindings, ...fields };
    if (this.format === "json") {
      this.sink(
        JSON.stringify({
          time: new Date().toISOString(),
          level,
          message,
          ...merged,
        }),
      );
      return;
    }
    const suffix =
      Object.keys(merged).length > 0 ? " " + formatFields(merged) : "";
    this.sink(`${TEXT_SYMBOL[level]} ${message}${suffix}`);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write("error", message, fields);
  }

  success(message: string): void {
    if (this.format === "json") return;
    this.sink(`✓ ${message}`);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new StructuredLogger(
      { level: this.level, format: this.format, sink: this.sink },
      { ...this.bindings, ...bindings },
    );
  }
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(" ");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  return JSON.stringify(value);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new StructuredLogger(options);
}
