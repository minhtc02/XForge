import { describe, expect, it } from "vitest";
import {
  AlreadyExistsError,
  ConfigError,
  DriftError,
  ExitCode,
  isXForgeError,
  ValidationError,
  XForgeError,
} from "./errors.js";

describe("errors", () => {
  it("ConfigError uses the config/runtime exit code", () => {
    const e = new ConfigError("bad config", { details: { field: "version" } });
    expect(e.code).toBe("CONFIG_INVALID");
    expect(e.exitCode).toBe(ExitCode.ConfigOrRuntimeError);
    expect(e.details).toEqual({ field: "version" });
    expect(e).toBeInstanceOf(XForgeError);
    expect(e).toBeInstanceOf(Error);
  });

  it("ValidationError and DriftError are operational failures (exit 1)", () => {
    expect(new ValidationError("x").exitCode).toBe(ExitCode.OperationalFailure);
    expect(new DriftError("x").exitCode).toBe(ExitCode.OperationalFailure);
  });

  it("AlreadyExistsError reports the right code", () => {
    expect(new AlreadyExistsError("x").code).toBe("ALREADY_EXISTS");
  });

  it("isXForgeError narrows correctly", () => {
    expect(isXForgeError(new ConfigError("x"))).toBe(true);
    expect(isXForgeError(new Error("x"))).toBe(false);
    expect(isXForgeError("nope")).toBe(false);
  });

  it("toJSON produces a serializable payload without cause", () => {
    const e = new ConfigError("boom", { details: { a: 1 } });
    const json = e.toJSON();
    expect(json).toMatchObject({
      name: "ConfigError",
      code: "CONFIG_INVALID",
      message: "boom",
      exitCode: 2,
      details: { a: 1 },
    });
  });

  it("preserves the error name for each subclass", () => {
    expect(new DriftError("x").name).toBe("DriftError");
  });
});
