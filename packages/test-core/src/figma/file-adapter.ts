import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  DesignSnapshot,
  FigmaAdapter,
  FigmaFetchRequest,
  FigmaNodeMetadata,
} from "./adapter.js";

/**
 * File-backed Figma adapter (master prompt §7). Reads node metadata from a
 * local fixture file instead of calling Figma, so planning and unit tests are
 * deterministic and offline. Shaped identically to a future MCP-backed adapter.
 *
 * Fixture format (YAML or JSON), keyed by node id:
 *   version: 1
 *   file_version: "fixture-v1"
 *   nodes:
 *     "10:23":
 *       name: Alarm List - Empty
 *       width: 393
 *       height: 852
 *       device: iPhone-15-Pro
 */

interface FixtureNode {
  name?: string;
  width?: number;
  height?: number;
  device?: string;
  variables?: Record<string, string | number>;
  screenshot?: string;
}

interface Fixture {
  file_version?: string;
  nodes?: Record<string, FixtureNode>;
}

export interface FileFigmaAdapterOptions {
  /** Absolute path to the fixture file. */
  fixturePath: string;
  /** Directory where snapshot screenshots are considered to live. */
  snapshotDir?: string;
}

export class FileFigmaAdapter implements FigmaAdapter {
  private cache: Fixture | null = null;

  constructor(private readonly options: FileFigmaAdapterOptions) {}

  private async load(): Promise<Fixture> {
    if (this.cache) return this.cache;
    if (!existsSync(this.options.fixturePath)) {
      this.cache = {};
      return this.cache;
    }
    const text = await readFile(this.options.fixturePath, "utf8");
    const parsed = this.options.fixturePath.endsWith(".json")
      ? (JSON.parse(text) as Fixture)
      : (parseYaml(text) as Fixture);
    this.cache = parsed ?? {};
    return this.cache;
  }

  async authenticate(): Promise<boolean> {
    // File-backed adapter is always "authenticated" when the fixture exists.
    return existsSync(this.options.fixturePath);
  }

  async fetchNodeMetadata(
    req: FigmaFetchRequest,
  ): Promise<FigmaNodeMetadata | null> {
    const fixture = await this.load();
    const node = fixture.nodes?.[req.node_id];
    if (!node) return null;
    return {
      node_id: req.node_id,
      name: node.name ?? req.node_id,
      width: node.width,
      height: node.height,
      device: node.device ?? req.device,
      variables: node.variables,
    };
  }

  async captureSnapshot(
    req: FigmaFetchRequest,
  ): Promise<DesignSnapshot | null> {
    const metadata = await this.fetchNodeMetadata(req);
    if (!metadata) return null;
    const fixture = await this.load();
    const node = fixture.nodes?.[req.node_id];
    const screenshot = node?.screenshot ?? `${sanitize(req.node_id)}.png`;
    const screenshot_path = this.options.snapshotDir
      ? join(this.options.snapshotDir, screenshot)
      : screenshot;
    return {
      node_id: req.node_id,
      screenshot_path,
      metadata,
      figma_file_version: await this.fileVersion(),
      captured_at: new Date().toISOString(),
    };
  }

  async fileVersion(): Promise<string> {
    const fixture = await this.load();
    return fixture.file_version ?? "fixture-unknown";
  }
}

function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "-");
}
