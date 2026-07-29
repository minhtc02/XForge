/**
 * Figma adapter interface (blueprint §11, master prompt §7).
 *
 * Phase 1 defines the interface and a file-backed fixture implementation so
 * planning + tests never depend on a live Figma MCP connection. The interface
 * is intentionally shaped to map onto future Figma MCP calls (authenticate,
 * fetch frame, fetch metadata, cache snapshot) without changing callers.
 *
 * Design snapshots are frozen during `test plan` (§11.4); the run phase must use
 * cached snapshots and must NOT trigger OAuth or arbitrary MCP calls (§19.3).
 */

export interface FigmaNodeMetadata {
  node_id: string;
  name: string;
  width?: number;
  height?: number;
  device?: string;
  /** Design variables / tokens if available (color, typography, spacing). */
  variables?: Record<string, string | number>;
}

export interface DesignSnapshot {
  node_id: string;
  /** Relative path to the captured screenshot within the snapshot dir. */
  screenshot_path: string;
  metadata: FigmaNodeMetadata;
  figma_file_version: string;
  captured_at: string;
}

export interface FigmaFetchRequest {
  node_id: string;
  device?: string;
}

/** The adapter contract. Implementations may be live (MCP) or file-backed. */
export interface FigmaAdapter {
  /** Verify credentials/availability during preflight (plan phase only). */
  authenticate(): Promise<boolean>;
  /** Fetch node metadata (dimensions, variables). */
  fetchNodeMetadata(req: FigmaFetchRequest): Promise<FigmaNodeMetadata | null>;
  /** Freeze a design snapshot (screenshot + metadata + version). */
  captureSnapshot(req: FigmaFetchRequest): Promise<DesignSnapshot | null>;
  /** A stable version identifier for the source Figma file. */
  fileVersion(): Promise<string>;
}
