import { z } from "zod";

/**
 * `.xforge/test/design-map.yaml` schema (blueprint §11.2). Maps feature screens
 * and their states to Figma nodes. Used by the Figma adapter to freeze design
 * snapshots during the plan phase (§11.4).
 */

export const DesignState = z.object({
  node_id: z.string().min(1),
});

export const DesignScreen = z.object({
  figma_url: z.string().optional(),
  device: z.string().optional(),
  states: z.record(z.string(), DesignState).default({}),
});
export type DesignScreen = z.infer<typeof DesignScreen>;

export const DesignFeature = z.object({
  screens: z.record(z.string(), DesignScreen).default({}),
});

export const DesignMap = z.object({
  version: z.literal(1),
  features: z.record(z.string(), DesignFeature).default({}),
});
export type DesignMap = z.infer<typeof DesignMap>;

/** Flatten a design map into concrete node references for a given feature. */
export function designNodesForFeature(
  map: DesignMap,
  feature: string,
): Array<{ screen: string; state: string; node_id: string; device?: string }> {
  const out: Array<{
    screen: string;
    state: string;
    node_id: string;
    device?: string;
  }> = [];
  const f = map.features[feature];
  if (!f) return out;
  for (const [screen, screenDef] of Object.entries(f.screens)) {
    for (const [state, stateDef] of Object.entries(screenDef.states)) {
      out.push({
        screen,
        state,
        node_id: stateDef.node_id,
        device: screenDef.device,
      });
    }
  }
  return out;
}
