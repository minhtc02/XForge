import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileFigmaAdapter } from "./file-figma-adapter.js";
import { FileReferenceImageAdapter } from "./image-adapter.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "xforge-dev-design-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileFigmaAdapter", () => {
  it("reads node context and freezes a snapshot", async () => {
    const fixture = join(dir, "figma.yaml");
    await writeFile(
      fixture,
      [
        "file_version: fixture-v1",
        "nodes:",
        '  "120:450":',
        "    name: Habit Editor",
        "    device: iPhone-15-Pro",
        "    ui_states: [default, weekdays-selected]",
      ].join("\n"),
    );
    const adapter = new FileFigmaAdapter({
      fixturePath: fixture,
      snapshotDir: "snaps",
    });
    expect(await adapter.authenticate()).toBe(true);
    const ctx = await adapter.fetchContext({ id: "120:450" });
    expect(ctx?.name).toBe("Habit Editor");
    expect(ctx?.ui_states).toContain("weekdays-selected");
    const snap = await adapter.captureSnapshot({ id: "120:450" });
    expect(snap?.kind).toBe("figma");
    expect(snap?.source_version).toBe("fixture-v1");
    expect(snap?.image_path).toContain("snaps");
  });

  it("returns false auth and null when the fixture is missing", async () => {
    const adapter = new FileFigmaAdapter({
      fixturePath: join(dir, "none.yaml"),
    });
    expect(await adapter.authenticate()).toBe(false);
    expect(await adapter.fetchContext({ id: "x" })).toBeNull();
  });
});

describe("FileReferenceImageAdapter", () => {
  it("uses image content hash as the source version", async () => {
    const img = join(dir, "editor.png");
    await writeFile(img, "PNGDATA-v1");
    const adapter = new FileReferenceImageAdapter({
      images: [
        { id: "editor", path: img, device: "iPhone SE", name: "Editor" },
      ],
    });
    expect(await adapter.authenticate()).toBe(true);
    const snap = await adapter.captureSnapshot({ id: "editor" });
    expect(snap?.kind).toBe("reference-image");
    const v1 = await adapter.sourceVersion();

    await writeFile(img, "PNGDATA-v2-changed");
    const adapter2 = new FileReferenceImageAdapter({
      images: [{ id: "editor", path: img }],
    });
    const v2 = await adapter2.sourceVersion();
    expect(v1).not.toBe(v2);
  });

  it("returns null snapshot for a missing image", async () => {
    const adapter = new FileReferenceImageAdapter({
      images: [{ id: "gone", path: join(dir, "missing.png") }],
    });
    expect(await adapter.authenticate()).toBe(false);
    expect(await adapter.captureSnapshot({ id: "gone" })).toBeNull();
  });
});
