import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  DesignAdapter,
  DesignContext,
  DesignFetchRequest,
  DesignSnapshot,
} from "./adapter.js";

/**
 * File-backed Figma adapter (master prompt §Figma architecture). Reads node
 * context from a local fixture so planning + tests are offline and
 * deterministic. Shaped identically to a future MCP-backed adapter.
 */
interface FixtureNode {
  name?: string;
  width?: number;
  height?: number;
  device?: string;
  variables?: Record<string, string | number>;
  component_hierarchy?: string[];
  ui_states?: string[];
  image?: string;
}
interface Fixture {
  file_version?: string;
  nodes?: Record<string, FixtureNode>;
}

export interface FileFigmaAdapterOptions {
  fixturePath: string;
  snapshotDir?: string;
}

export class FileFigmaAdapter implements DesignAdapter {
  private cache: Fixture | null = null;
  constructor(private readonly options: FileFigmaAdapterOptions) {}

  private async load(): Promise<Fixture> {
    if (this.cache) return this.cache;
    if (!existsSync(this.options.fixturePath)) {
      this.cache = {};
      return this.cache;
    }
    const text = await readFile(this.options.fixturePath, "utf8");
    this.cache = this.options.fixturePath.endsWith(".json")
      ? (JSON.parse(text) as Fixture)
      : ((parseYaml(text) as Fixture) ?? {});
    return this.cache;
  }

  async authenticate(): Promise<boolean> {
    return existsSync(this.options.fixturePath);
  }

  async fetchContext(req: DesignFetchRequest): Promise<DesignContext | null> {
    const node = (await this.load()).nodes?.[req.id];
    if (!node) return null;
    return {
      node_id: req.id,
      name: node.name ?? req.id,
      width: node.width,
      height: node.height,
      device: node.device ?? req.device,
      variables: node.variables,
      component_hierarchy: node.component_hierarchy,
      ui_states: node.ui_states,
    };
  }

  async captureSnapshot(
    req: DesignFetchRequest,
  ): Promise<DesignSnapshot | null> {
    const context = await this.fetchContext(req);
    if (!context) return null;
    const node = (await this.load()).nodes?.[req.id];
    const image = node?.image ?? `${sanitize(req.id)}.png`;
    return {
      id: req.id,
      kind: "figma",
      image_path: this.options.snapshotDir
        ? join(this.options.snapshotDir, image)
        : image,
      context,
      source_version: await this.sourceVersion(),
      captured_at: new Date().toISOString(),
    };
  }

  async sourceVersion(): Promise<string> {
    return (await this.load()).file_version ?? "fixture-unknown";
  }
}

function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "-");
}
