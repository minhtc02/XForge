import { z } from "zod";
import { Confidence } from "./enums.js";

/**
 * Navigation graph (optimization plan §A).
 *
 * The source plan describes node/edge/BFS in detail but not where the graph
 * comes from — which is the part that actually carries risk. A stale graph makes
 * BFS confidently produce a wrong path, and inventing edges would violate the
 * "no unevidenced claims" rule.
 *
 * So every node and edge carries provenance and confidence, in the same three
 * tiers XForge already uses for feature detection:
 *
 *   explicit  authored in `.xforge/test/navigation.yaml`      0.9
 *   derived   inferred from the Project Model's entry points  0.6
 *   probed    confirmed against a live accessibility tree      1.0
 *
 * Path finding refuses edges below a configured confidence, and the graph is
 * hashed into the plan inputs so an approval cannot outlive the graph it used.
 */

export const NavProvenance = z.enum(["explicit", "derived", "probed"]);
export type NavProvenance = z.infer<typeof NavProvenance>;

/** A screen or UI state, identified by an anchor that is always visible on it. */
export const NavNode = z.object({
  id: z.string().min(1),
  /** accessibilityIdentifier that proves we are on this screen. */
  anchor: z.string().min(1),
  feature: z.string().optional(),
  provenance: NavProvenance.default("explicit"),
  confidence: Confidence.default(0.9),
});
export type NavNode = z.infer<typeof NavNode>;

/** An action that moves from one node to another. */
export const NavEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  action: z.enum(["tap", "open", "swipe", "back", "open-url"]).default("tap"),
  /** accessibilityIdentifier to act on (or the URL for `open-url`). */
  target: z.string().optional(),
  provenance: NavProvenance.default("explicit"),
  confidence: Confidence.default(0.9),
});
export type NavEdge = z.infer<typeof NavEdge>;

export const NavigationGraph = z.object({
  schema_version: z.literal(1).default(1),
  /** Node id the app starts at after launch. */
  root: z.string().min(1),
  // An empty YAML sequence parses to null, not []. A scaffolded graph for a
  // project with no detected entry points is exactly that, so treat null as
  // empty rather than rejecting a file XForge itself just wrote.
  nodes: z
    .array(NavNode)
    .nullish()
    .transform((v) => v ?? []),
  edges: z
    .array(NavEdge)
    .nullish()
    .transform((v) => v ?? []),
});
export type NavigationGraph = z.infer<typeof NavigationGraph>;

export const CONFIDENCE_BY_PROVENANCE: Record<NavProvenance, number> = {
  explicit: 0.9,
  derived: 0.6,
  probed: 1,
};
