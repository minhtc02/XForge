import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "@xforge/shared";
import { canPrompt } from "./prompt.js";
import type { CliContext } from "./context.js";

/**
 * The gate matters more than the prompt. A prompt that fires in CI hangs the
 * build; one that fires under `--json` corrupts the output. An earlier version
 * of `xforge docs` did both, so these lock the conditions down.
 */

function ctx(json: boolean): CliContext {
  return {
    projectRoot: "/tmp",
    json,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

const originalIn = process.stdin.isTTY;
const originalOut = process.stdout.isTTY;

function setTty(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value: stdin,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: stdout,
    configurable: true,
  });
}

afterEach(() => {
  setTty(originalIn as boolean, originalOut as boolean);
});

describe("canPrompt", () => {
  it("allows prompting only at a full terminal", () => {
    setTty(true, true);
    expect(canPrompt(ctx(false))).toBe(true);
  });

  it("never prompts under --json", () => {
    setTty(true, true);
    expect(canPrompt(ctx(true))).toBe(false);
  });

  it("never prompts when stdin is piped — the CI case", () => {
    setTty(false, true);
    expect(canPrompt(ctx(false))).toBe(false);
  });

  it("never prompts when stdout is redirected", () => {
    setTty(true, false);
    expect(canPrompt(ctx(false))).toBe(false);
  });

  it("never prompts when neither is a terminal", () => {
    setTty(false, false);
    expect(canPrompt(ctx(false))).toBe(false);
  });
});
