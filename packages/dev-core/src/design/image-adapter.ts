import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { hashContent } from "@xforge/core";
import type {
  DesignAdapter,
  DesignContext,
  DesignFetchRequest,
  DesignSnapshot,
} from "./adapter.js";

/**
 * User-provided reference image adapter (blueprint §12, §4.3). Treats a local
 * image file as the visual source of truth. The "source version" is the image
 * content hash, so a changed image is detectable. No network, no MCP.
 */

export interface ReferenceImageEntry {
  id: string;
  /** Absolute or project-relative path to the image file. */
  path: string;
  device?: string;
  name?: string;
}

export interface FileImageAdapterOptions {
  /** Map of image id -> entry. */
  images: ReferenceImageEntry[];
  snapshotDir?: string;
}

export class FileReferenceImageAdapter implements DesignAdapter {
  private readonly byId: Map<string, ReferenceImageEntry>;
  constructor(private readonly options: FileImageAdapterOptions) {
    this.byId = new Map(options.images.map((i) => [i.id, i]));
  }

  async authenticate(): Promise<boolean> {
    // Available iff at least one referenced image exists on disk.
    return this.options.images.some((i) => existsSync(i.path));
  }

  async fetchContext(req: DesignFetchRequest): Promise<DesignContext | null> {
    const entry = this.byId.get(req.id);
    if (!entry || !existsSync(entry.path)) return null;
    return {
      name: entry.name ?? basename(entry.path),
      device: entry.device ?? req.device,
    };
  }

  async captureSnapshot(
    req: DesignFetchRequest,
  ): Promise<DesignSnapshot | null> {
    const entry = this.byId.get(req.id);
    if (!entry || !existsSync(entry.path)) return null;
    const context = await this.fetchContext(req);
    if (!context) return null;
    const version = await this.imageVersion(entry.path);
    const image = basename(entry.path);
    return {
      id: req.id,
      kind: "reference-image",
      image_path: this.options.snapshotDir
        ? join(this.options.snapshotDir, image)
        : entry.path,
      context,
      source_version: version,
      captured_at: new Date().toISOString(),
    };
  }

  async sourceVersion(): Promise<string> {
    // Combined hash across all referenced images.
    const parts: string[] = [];
    for (const i of this.options.images)
      parts.push(await this.imageVersion(i.path));
    return hashContent(parts.join("|"));
  }

  private async imageVersion(path: string): Promise<string> {
    if (!existsSync(path)) return "missing";
    try {
      const buf = await readFile(path);
      return hashContent(buf.toString("base64").slice(0, 4096));
    } catch {
      return "unreadable";
    }
  }
}
