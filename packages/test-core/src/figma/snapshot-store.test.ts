import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureSnapshots,
  readSnapshots,
  snapshotTemplate,
  unresolvedNodes,
  writeSnapshots,
} from "./snapshot-store.js";
import type { FigmaAdapter } from "./adapter.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xforge-snap-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("snapshotTemplate", () => {
  it("lists every node the agent must fill in, marked mcp", () => {
    const template = snapshotTemplate(["10:23", "10:24", "10:23"], "abc");
    expect(Object.keys(template.snapshots)).toEqual(["10:23", "10:24"]);
    expect(template.source).toBe("mcp");
    expect(template.file_key).toBe("abc");
  });

  it("reports every templated node as unresolved until filled", () => {
    expect(unresolvedNodes(snapshotTemplate(["10:23"], "abc"))).toEqual([
      "10:23",
    ]);
  });

  it("stops reporting a node once it has a size", () => {
    const file = snapshotTemplate(["10:23"], "abc");
    file.snapshots["10:23"]!.width = 393;
    expect(unresolvedNodes(file)).toEqual([]);
  });
});

describe("readSnapshots", () => {
  it("round-trips a written file", async () => {
    const path = join(dir, "snapshots.json");
    const file = snapshotTemplate(["10:23"], "abc");
    file.snapshots["10:23"]!.width = 393;
    await writeSnapshots(path, file);
    const read = await readSnapshots(path);
    expect(read?.snapshots["10:23"]?.width).toBe(393);
  });

  it("returns null when there is no file", async () => {
    expect(await readSnapshots(join(dir, "absent.json"))).toBeNull();
  });

  it("returns null for a malformed file rather than throwing", async () => {
    // Unusable design data is an environment condition, not a failed run.
    const path = join(dir, "broken.json");
    await writeFile(path, "{ not json");
    expect(await readSnapshots(path)).toBeNull();
  });

  it("returns null when the shape does not validate", async () => {
    const path = join(dir, "wrong.json");
    await writeFile(path, JSON.stringify({ schema_version: 99 }));
    expect(await readSnapshots(path)).toBeNull();
  });
});

describe("captureSnapshots", () => {
  const adapter = (resolve: (id: string) => boolean): FigmaAdapter => ({
    authenticate: async () => true,
    fetchNodeMetadata: async () => null,
    fileVersion: async () => "v1",
    captureSnapshot: async (req) =>
      resolve(req.node_id)
        ? {
            node_id: req.node_id,
            screenshot_path: `${req.node_id}.png`,
            metadata: {
              node_id: req.node_id,
              name: "Alarm List",
              width: 393,
              height: 852,
              variables: { "color/primary": "#FF0000" },
            },
            figma_file_version: "v1",
            captured_at: "2026-01-01T00:00:00.000Z",
          }
        : null,
  });

  it("captures resolvable nodes with their tokens", async () => {
    const file = await captureSnapshots({
      adapter: adapter(() => true),
      nodeIds: ["10:23"],
      fileKey: "abc",
      source: "rest",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(file.source).toBe("rest");
    expect(file.file_version).toBe("v1");
    expect(file.snapshots["10:23"]?.width).toBe(393);
    expect(file.snapshots["10:23"]?.variables).toEqual({
      "color/primary": "#FF0000",
    });
  });

  it("skips a node it cannot resolve rather than inventing one", async () => {
    const file = await captureSnapshots({
      adapter: adapter((id) => id === "10:23"),
      nodeIds: ["10:23", "99:99"],
      fileKey: "abc",
      source: "rest",
    });
    expect(Object.keys(file.snapshots)).toEqual(["10:23"]);
  });

  it("requests each node once", async () => {
    let calls = 0;
    const counting: FigmaAdapter = {
      ...adapter(() => true),
      captureSnapshot: async (req) => {
        calls += 1;
        return {
          node_id: req.node_id,
          screenshot_path: "",
          metadata: { node_id: req.node_id, name: "", width: 1, height: 1 },
          figma_file_version: "v1",
          captured_at: "",
        };
      },
    };
    await captureSnapshots({
      adapter: counting,
      nodeIds: ["10:23", "10:23"],
      fileKey: "abc",
      source: "rest",
    });
    expect(calls).toBe(1);
  });
});
