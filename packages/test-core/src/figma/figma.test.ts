import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileFigmaAdapter } from "./file-adapter.js";

let dir: string;
let fixturePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xforge-figma-"));
  fixturePath = join(dir, "figma-fixture.yaml");
  await writeFile(
    fixturePath,
    [
      "file_version: fixture-v1",
      "nodes:",
      '  "10:23":',
      "    name: Alarm List - Empty",
      "    width: 393",
      "    height: 852",
      "    device: iPhone-15-Pro",
    ].join("\n"),
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileFigmaAdapter", () => {
  it("authenticates when the fixture exists", async () => {
    const adapter = new FileFigmaAdapter({ fixturePath });
    expect(await adapter.authenticate()).toBe(true);
  });

  it("returns false auth when the fixture is missing", async () => {
    const adapter = new FileFigmaAdapter({
      fixturePath: join(dir, "nope.yaml"),
    });
    expect(await adapter.authenticate()).toBe(false);
  });

  it("fetches node metadata", async () => {
    const adapter = new FileFigmaAdapter({ fixturePath });
    const meta = await adapter.fetchNodeMetadata({ node_id: "10:23" });
    expect(meta?.name).toBe("Alarm List - Empty");
    expect(meta?.width).toBe(393);
    expect(meta?.device).toBe("iPhone-15-Pro");
  });

  it("returns null for unknown nodes", async () => {
    const adapter = new FileFigmaAdapter({ fixturePath });
    expect(await adapter.fetchNodeMetadata({ node_id: "99:99" })).toBeNull();
  });

  it("captures a snapshot with a stable file version", async () => {
    const adapter = new FileFigmaAdapter({ fixturePath, snapshotDir: "snaps" });
    const snap = await adapter.captureSnapshot({ node_id: "10:23" });
    expect(snap?.figma_file_version).toBe("fixture-v1");
    expect(snap?.screenshot_path).toContain("snaps");
    expect(snap?.node_id).toBe("10:23");
  });
});
