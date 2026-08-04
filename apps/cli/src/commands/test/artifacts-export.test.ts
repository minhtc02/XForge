import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult, CommandSpec } from "@xforge/test-core";
import { exportProbeDump, exportScreenshots } from "./artifacts-export.js";

/**
 * `xcresulttool` is stubbed here: the point is the extraction logic and — more
 * importantly — that every way it can go wrong yields "nothing extracted"
 * rather than an exception. A run must not fail because an artifact was
 * unreadable.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-artifacts-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const BUNDLE = {
  actions: {
    _values: [
      {
        actionResult: {
          testsRef: {
            summaries: {
              _values: [
                {
                  identifier: {
                    _value: "XForgeUITests/test_TC_ALARM_003()",
                  },
                  attachments: {
                    _values: [
                      {
                        name: { _value: "xforge-probe" },
                        uniformTypeIdentifier: { _value: "public.json" },
                        payloadRef: { id: { _value: "ATT-PROBE" } },
                      },
                      {
                        name: { _value: "alarm-list.png" },
                        uniformTypeIdentifier: { _value: "public.png" },
                        payloadRef: { id: { _value: "ATT-SHOT" } },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    ],
  },
};

const PROBE_DUMP = [
  {
    target: "alarm-list",
    reached: true,
    elements: [
      {
        identifier: "alarm-list",
        label: "",
        type: "Other",
        isEnabled: true,
        isHittable: false,
        width: 393,
        height: 852,
      },
    ],
  },
];

/**
 * A runner that answers `xcresulttool get` with a bundle graph and materialises
 * whatever `xcresulttool export` is asked for.
 */
function stubRunner(options: {
  bundle?: unknown;
  getCode?: number;
  exportCode?: number;
  payloads?: Record<string, string>;
}) {
  const calls: CommandSpec[] = [];
  const runner = {
    calls,
    async run(spec: CommandSpec): Promise<CommandResult> {
      calls.push(spec);
      const base = {
        spec,
        stdout: "",
        stderr: "",
        durationMs: 0,
      };
      if (spec.args.includes("get")) {
        return {
          ...base,
          code: options.getCode ?? 0,
          stdout:
            options.bundle === undefined
              ? JSON.stringify(BUNDLE)
              : typeof options.bundle === "string"
                ? options.bundle
                : JSON.stringify(options.bundle),
        };
      }
      // export: write the payload to --output-path, as the real tool does.
      const code = options.exportCode ?? 0;
      if (code === 0) {
        const idIndex = spec.args.indexOf("--id");
        const outIndex = spec.args.indexOf("--output-path");
        const id = spec.args[idIndex + 1]!;
        const out = spec.args[outIndex + 1]!;
        await mkdir(dirname(out), { recursive: true });
        await writeFile(
          out,
          options.payloads?.[id] ?? JSON.stringify(PROBE_DUMP),
        );
      }
      return { ...base, code };
    },
  };
  return runner;
}

describe("exportProbeDump", () => {
  it("extracts the probe attachment and parses it", async () => {
    const out = join(root, "artifacts/probe/xforge-probe.json");
    const result = await exportProbeDump(stubRunner({}), "a.xcresult", out);
    expect(result?.screens[0]?.target).toBe("alarm-list");
    expect(result?.path).toBe(out);
  });

  it("asks xcresulttool for the probe attachment by id", async () => {
    const runner = stubRunner({});
    await exportProbeDump(runner, "a.xcresult", join(root, "p.json"));
    const exportCall = runner.calls.find((c) => c.args.includes("export"));
    expect(exportCall?.args).toContain("ATT-PROBE");
  });

  it("returns undefined when the bundle cannot be read", async () => {
    const result = await exportProbeDump(
      stubRunner({ getCode: 1 }),
      "a.xcresult",
      join(root, "p.json"),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the tool emits unparseable output", async () => {
    const result = await exportProbeDump(
      stubRunner({ bundle: "not json" }),
      "a.xcresult",
      join(root, "p.json"),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the bundle has no probe attachment", async () => {
    const result = await exportProbeDump(
      stubRunner({ bundle: { actions: { _values: [] } } }),
      "a.xcresult",
      join(root, "p.json"),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the export command fails", async () => {
    const result = await exportProbeDump(
      stubRunner({ exportCode: 1 }),
      "a.xcresult",
      join(root, "p.json"),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the exported payload is not a screen array", async () => {
    const result = await exportProbeDump(
      stubRunner({ payloads: { "ATT-PROBE": '{"not":"an array"}' } }),
      "a.xcresult",
      join(root, "p.json"),
    );
    expect(result).toBeUndefined();
  });
});

describe("exportScreenshots", () => {
  it("files each screenshot under the case that produced it", async () => {
    const screensDir = join(root, "artifacts/screens");
    const written = await exportScreenshots(
      stubRunner({ payloads: { "ATT-SHOT": "png-bytes" } }),
      "a.xcresult",
      screensDir,
    );
    expect(written).toHaveLength(1);
    // `XForgeUITests/test_TC_ALARM_003()` → folder `TC_ALARM_003`.
    expect(await readdir(screensDir)).toEqual(["TC_ALARM_003"]);
    expect(await readdir(join(screensDir, "TC_ALARM_003"))).toEqual([
      "alarm-list.png",
    ]);
  });

  it("does not export the probe dump as a screenshot", async () => {
    const written = await exportScreenshots(
      stubRunner({}),
      "a.xcresult",
      join(root, "screens"),
    );
    expect(written.every((p) => p.endsWith(".png"))).toBe(true);
    expect(written).toHaveLength(1);
  });

  it("returns an empty list when the bundle is unreadable", async () => {
    expect(
      await exportScreenshots(
        stubRunner({ getCode: 1 }),
        "a.xcresult",
        join(root, "screens"),
      ),
    ).toEqual([]);
  });

  it("skips an attachment that fails to export rather than throwing", async () => {
    await expect(
      exportScreenshots(
        stubRunner({ exportCode: 1 }),
        "a.xcresult",
        join(root, "screens"),
      ),
    ).resolves.toEqual([]);
  });
});
