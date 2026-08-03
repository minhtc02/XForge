import type {
  DesignSnapshot,
  FigmaAdapter,
  FigmaFetchRequest,
  FigmaNodeMetadata,
} from "./adapter.js";

/**
 * Figma REST API adapter (blueprint §11).
 *
 * The CLI is a plain Node process: it cannot call the Figma MCP server, which
 * lives on the agent side. So "real Figma" for the deterministic layer means
 * the REST API with a token. Two consequences shape this module:
 *
 *  - **Plan-time only.** Snapshots are fetched while planning and frozen
 *    (§11.4); a run must never reach the network, or a test result would depend
 *    on someone editing a design mid-run.
 *  - **Never fatal.** A missing token, an expired one, a 404 node — none of
 *    these are a product defect, so they downgrade to "no reference available"
 *    and the visual verdict becomes `DESIGN_REFERENCE_MISSING` rather than a
 *    failure. Losing Figma access must not turn a green suite red.
 *
 * The token is read from the environment and never written to the model, the
 * plan, or any log (§23).
 */

const FIGMA_API = "https://api.figma.com/v1";

export interface HttpFigmaOptions {
  /** Figma file key — the segment after `/file/` in a Figma URL. */
  fileKey: string;
  /** Personal access token. Defaults to `FIGMA_TOKEN` in the environment. */
  token?: string;
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
  /** Milliseconds before a request is abandoned. */
  timeoutMs?: number;
}

interface FigmaNodesResponse {
  name?: string;
  version?: string;
  nodes?: Record<
    string,
    {
      document?: {
        name?: string;
        absoluteBoundingBox?: { width?: number; height?: number };
        [key: string]: unknown;
      };
    }
  >;
}

interface FigmaVariablesResponse {
  meta?: {
    variables?: Record<
      string,
      {
        name?: string;
        resolvedType?: string;
        valuesByMode?: Record<string, unknown>;
      }
    >;
  };
}

/**
 * Reads design metadata from Figma over HTTPS. Construct once per plan; it
 * caches per node so a plan referencing the same frame twice fetches once.
 */
export class HttpFigmaAdapter implements FigmaAdapter {
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, FigmaNodeMetadata | null>();
  private version = "unknown";

  constructor(private readonly options: HttpFigmaOptions) {
    this.token = options.token ?? process.env.FIGMA_TOKEN;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Whether a token is present and the file is reachable. */
  async authenticate(): Promise<boolean> {
    if (!this.token) return false;
    const response = await this.request(
      `/files/${this.options.fileKey}?depth=1`,
    );
    return response !== undefined;
  }

  async fetchNodeMetadata(
    request: FigmaFetchRequest,
  ): Promise<FigmaNodeMetadata | null> {
    const cached = this.cache.get(request.node_id);
    if (cached !== undefined) return cached;

    const body = (await this.request(
      `/files/${this.options.fileKey}/nodes?ids=${encodeURIComponent(request.node_id)}`,
    )) as FigmaNodesResponse | undefined;

    if (!body) {
      this.cache.set(request.node_id, null);
      return null;
    }
    if (body.version) this.version = body.version;

    const document = body.nodes?.[request.node_id]?.document;
    if (!document) {
      this.cache.set(request.node_id, null);
      return null;
    }

    const box = document.absoluteBoundingBox ?? {};
    const metadata: FigmaNodeMetadata = {
      node_id: request.node_id,
      name: document.name ?? request.node_id,
      ...(box.width !== undefined ? { width: box.width } : {}),
      ...(box.height !== undefined ? { height: box.height } : {}),
      ...(request.device ? { device: request.device } : {}),
      variables: await this.variables(),
    };
    this.cache.set(request.node_id, metadata);
    return metadata;
  }

  /**
   * Freeze a snapshot for the plan. Images are not downloaded here: the
   * measurement comparison needs only metadata, and an image adds megabytes to
   * every plan for a check that is noisier. Callers that want pixels can pass
   * the returned `screenshot_path` to an image export step.
   */
  async captureSnapshot(
    request: FigmaFetchRequest,
  ): Promise<DesignSnapshot | null> {
    const metadata = await this.fetchNodeMetadata(request);
    if (!metadata) return null;
    return {
      node_id: request.node_id,
      screenshot_path: `${sanitize(request.node_id)}.png`,
      metadata,
      figma_file_version: this.version,
      captured_at: new Date().toISOString(),
    };
  }

  /** A stable identifier for the file version the snapshot came from. */
  async fileVersion(): Promise<string> {
    if (this.version === "unknown") {
      const body = (await this.request(
        `/files/${this.options.fileKey}?depth=1`,
      )) as { version?: string } | undefined;
      if (body?.version) this.version = body.version;
    }
    return this.version;
  }

  /** Design variables, fetched once. Absent on files without variables. */
  private async variables(): Promise<Record<string, string | number>> {
    const body = (await this.request(
      `/files/${this.options.fileKey}/variables/local`,
    )) as FigmaVariablesResponse | undefined;
    const out: Record<string, string | number> = {};
    for (const variable of Object.values(body?.meta?.variables ?? {})) {
      const name = variable.name;
      if (!name) continue;
      const value = Object.values(variable.valuesByMode ?? {})[0];
      if (typeof value === "string" || typeof value === "number") {
        out[name] = value;
      }
    }
    return out;
  }

  /**
   * One request. Any failure — no token, network error, non-2xx — resolves to
   * `undefined`, because Figma being unavailable is an environment condition,
   * never a product defect (§4.4).
   */
  private async request(path: string): Promise<unknown | undefined> {
    if (!this.token) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10_000,
    );
    try {
      const response = await this.fetchImpl(`${FIGMA_API}${path}`, {
        headers: { "X-Figma-Token": this.token },
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sanitize(nodeId: string): string {
  return nodeId.replace(/[^A-Za-z0-9_-]+/g, "_");
}

/**
 * Pick an adapter for the project's configuration.
 *
 * A file-backed adapter is not a lesser option: it is how the Claude plugin
 * feeds real Figma data to the CLI. The agent can call the Figma MCP, write the
 * result to the design-map fixture, and the deterministic layer reads it
 * offline — which keeps planning reproducible and keeps credentials out of the
 * CLI entirely.
 */
export function figmaTokenAvailable(): boolean {
  return Boolean(process.env.FIGMA_TOKEN);
}
