/**
 * Design input adapters (blueprint §12, master prompt §Figma architecture).
 *
 * XForge Dev writes UI code from a design source of truth: Figma (via MCP) or
 * user-provided reference images. Phase 1 defines both adapter interfaces and
 * a frozen design-snapshot model, with file-backed fixtures so planning is
 * offline. Snapshots are frozen + hashed during the plan phase (§12); the run
 * phase must not call Figma live.
 */

export interface DesignContext {
  node_id?: string;
  name: string;
  width?: number;
  height?: number;
  device?: string;
  /** Design variables/tokens: colors, typography, spacing. */
  variables?: Record<string, string | number>;
  component_hierarchy?: string[];
  ui_states?: string[];
}

export interface DesignSnapshot {
  /** Stable id: figma node id or image identifier. */
  id: string;
  kind: "figma" | "reference-image";
  /** Relative path to the frozen screenshot/image within the snapshot dir. */
  image_path: string;
  context: DesignContext;
  /** Source version (figma file version or image content hash). */
  source_version: string;
  captured_at: string;
}

export interface DesignFetchRequest {
  id: string;
  device?: string;
}

/** Common contract for any design source (Figma or images). */
export interface DesignAdapter {
  /** Preflight availability check (plan phase only). */
  authenticate(): Promise<boolean>;
  fetchContext(req: DesignFetchRequest): Promise<DesignContext | null>;
  captureSnapshot(req: DesignFetchRequest): Promise<DesignSnapshot | null>;
  sourceVersion(): Promise<string>;
}

/** Marker interface — a Figma-backed adapter (MCP in later phases). */
export type FigmaAdapter = DesignAdapter;

/** Marker interface — a user-provided reference image adapter. */
export type ReferenceImageAdapter = DesignAdapter;
