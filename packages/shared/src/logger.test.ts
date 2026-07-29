import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe("logger", () => {
  it("respects the level threshold", () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: "warn", sink });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("w");
    expect(lines[1]).toContain("e");
  });

  it("emits one JSON object per line in json mode", () => {
    const { lines, sink } = capture();
    const log = createLogger({ format: "json", level: "info", sink });
    log.info("hello", { count: 3 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({ level: "info", message: "hello", count: 3 });
    expect(typeof parsed.time).toBe("string");
  });

  it("success() is a no-op in json mode", () => {
    const { lines, sink } = capture();
    const log = createLogger({ format: "json", sink });
    log.success("done");
    expect(lines).toHaveLength(0);
  });

  it("child loggers merge bindings", () => {
    const { lines, sink } = capture();
    const log = createLogger({ format: "json", sink }).child({ cmd: "init" });
    log.info("run", { step: 1 });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({ cmd: "init", step: 1 });
  });

  it("formats fields in text mode", () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink });
    log.info("scanned", { files: 12, path: "a b" });
    expect(lines[0]).toBe('• scanned files=12 path="a b"');
  });
});
