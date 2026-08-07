import type { Feature, ProjectModel } from "@xforge/core";
import {
  CONFIDENCE_BY_PROVENANCE,
  NavigationGraph,
  type NavEdge,
  type NavNode,
} from "../models/navigation.js";
import type { TestStep } from "../models/test-case.js";

/**
 * Navigation graph construction and shortest-path search (optimization §A).
 *
 * BFS itself is a dozen lines; the load-bearing parts are provenance and the
 * confidence gate. A path is only produced from edges the project actually
 * vouches for — otherwise the case is reported as unreachable and blocked,
 * because a confidently wrong navigation prefix is worse than none.
 */

export const ROOT_NODE = "root";

/** Parse and validate an authored graph. */
export function parseNavigationGraph(input: unknown): NavigationGraph {
  return NavigationGraph.parse(input);
}

/**
 * Derive a graph from the Canonical Project Model: every feature entry point
 * becomes a node reachable from the root. Confidence 0.6 — this asserts that a
 * screen exists, not that a single tap from the root reaches it.
 *
 * The anchor is taken from an accessibility identifier that genuinely exists in
 * the feature's source, falling back to the entry-point type name only when the
 * feature declares none. Using the type name by preference would produce a
 * locator no test can ever find, blocking every case on the first run.
 */
export function deriveGraphFromModel(
  model: ProjectModel,
  features?: Feature[],
): NavigationGraph {
  const scope = features ?? model.features;

  // First literal accessibility identifier per feature, in source order.
  const anchorByFeature = new Map<string, string>();
  for (const id of model.accessibility_identifiers) {
    if (id.dynamic || !id.value || !id.feature) continue;
    if (!anchorByFeature.has(id.feature)) {
      anchorByFeature.set(id.feature, id.value);
    }
  }

  const nodes: NavNode[] = [
    {
      id: ROOT_NODE,
      anchor: ROOT_NODE,
      provenance: "derived",
      confidence: CONFIDENCE_BY_PROVENANCE.derived,
    },
  ];
  const edges: NavEdge[] = [];

  for (const feature of scope) {
    const screen = `${feature.id}-screen`;
    const entry = feature.entry_points[0];
    const anchor = anchorByFeature.get(feature.id) ?? entry?.name ?? screen;
    nodes.push({
      id: screen,
      anchor,
      feature: feature.id,
      provenance: "derived",
      confidence: CONFIDENCE_BY_PROVENANCE.derived,
    });
    edges.push({
      from: ROOT_NODE,
      to: screen,
      action: "open",
      target: anchor,
      provenance: "derived",
      confidence: CONFIDENCE_BY_PROVENANCE.derived,
    });
  }

  return { schema_version: 1, root: ROOT_NODE, nodes, edges };
}

/**
 * Merge graphs, later ones winning. Explicit authoring therefore overrides
 * derived guesses, and a probe result overrides both.
 */
export function mergeGraphs(...graphs: NavigationGraph[]): NavigationGraph {
  const nodes = new Map<string, NavNode>();
  const edges = new Map<string, NavEdge>();
  let root = ROOT_NODE;

  for (const graph of graphs) {
    if (graph.root) root = graph.root;
    for (const node of graph.nodes) nodes.set(node.id, node);
    for (const edge of graph.edges) {
      edges.set(`${edge.from}->${edge.to}:${edge.action}`, edge);
    }
  }
  return {
    schema_version: 1,
    root,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    ),
  };
}

export interface PathOptions {
  /** Edges below this confidence are ignored entirely. */
  minEdgeConfidence?: number;
  maxPathLength?: number;
}

export interface PathResult {
  /** Edges from `from` to `to`, in order. */
  edges: NavEdge[];
  /** Lowest edge confidence along the path — the path is only as good as this. */
  confidence: number;
}

/**
 * Breadth-first shortest path. Returns `undefined` when no path exists using
 * edges at or above the confidence threshold — callers must treat that as
 * "cannot navigate", never as "navigate anyway".
 */
export function shortestPath(
  graph: NavigationGraph,
  from: string,
  to: string,
  options: PathOptions = {},
): PathResult | undefined {
  const minConfidence = options.minEdgeConfidence ?? 0.6;
  const maxLength = options.maxPathLength ?? 6;
  if (from === to) return { edges: [], confidence: 1 };

  const adjacency = new Map<string, NavEdge[]>();
  for (const edge of graph.edges) {
    if (edge.confidence < minConfidence) continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
  }

  const visited = new Set<string>([from]);
  const queue: Array<{ node: string; path: NavEdge[] }> = [
    { node: from, path: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length >= maxLength) continue;
    for (const edge of adjacency.get(current.node) ?? []) {
      if (visited.has(edge.to)) continue;
      const path = [...current.path, edge];
      if (edge.to === to) {
        return {
          edges: path,
          confidence: Math.min(...path.map((e) => e.confidence)),
        };
      }
      visited.add(edge.to);
      queue.push({ node: edge.to, path });
    }
  }
  return undefined;
}

/** Render a path as the navigation-prefix steps a generated test will run. */
export function stepsForPath(
  path: PathResult,
  startIndex = 1,
): { steps: TestStep[]; nextIndex: number } {
  const steps: TestStep[] = [];
  let index = startIndex;
  for (const edge of path.edges) {
    steps.push({
      id: `step-${index}`,
      action: edge.action === "open-url" ? "open-url" : edge.action,
      ...(edge.target ? { target: edge.target } : {}),
    });
    index += 1;
  }
  return { steps, nextIndex: index };
}

/** The node representing a feature's main screen, if the graph has one. */
export function nodeForFeature(
  graph: NavigationGraph,
  featureId: string,
): NavNode | undefined {
  return (
    graph.nodes.find((n) => n.feature === featureId) ??
    graph.nodes.find((n) => n.id === `${featureId}-screen`)
  );
}

/** Features the graph cannot reach from its root at the given confidence. */
export function unreachableFeatures(
  graph: NavigationGraph,
  featureIds: string[],
  options: PathOptions = {},
): string[] {
  return featureIds.filter((id) => {
    const node = nodeForFeature(graph, id);
    if (!node) return true;
    return shortestPath(graph, graph.root, node.id, options) === undefined;
  });
}

/** Serialize a graph to the YAML shape `--init` scaffolds. */
export function renderNavigationYaml(graph: NavigationGraph): string {
  const lines: string[] = [
    "# XForge Test navigation graph.",
    "#",
    "# Nodes are screens (identified by an accessibilityIdentifier that is always",
    "# visible on them); edges are the actions that move between them. XForge runs",
    "# BFS over this to build the shortest navigation prefix for each test case.",
    "#",
    "# This file was scaffolded from the Canonical Project Model, so every entry",
    "# starts at provenance `derived` (confidence 0.6). Review each one and change",
    "# it to `explicit` (0.9) once you have confirmed it — only then is XForge",
    "# treating it as something you vouched for rather than something it guessed.",
    "schema_version: 1",
    `root: ${graph.root}`,
  ];
  // `nodes:` with nothing under it parses back as null, so an empty list has to
  // be written explicitly.
  lines.push(graph.nodes.length === 0 ? "nodes: []" : "nodes:");
  for (const node of graph.nodes) {
    lines.push(`  - id: ${node.id}`);
    lines.push(`    anchor: ${JSON.stringify(node.anchor)}`);
    if (node.feature) lines.push(`    feature: ${node.feature}`);
    lines.push(`    provenance: ${node.provenance}`);
    lines.push(`    confidence: ${node.confidence}`);
  }
  lines.push(graph.edges.length === 0 ? "edges: []" : "edges:");
  for (const edge of graph.edges) {
    lines.push(`  - from: ${edge.from}`);
    lines.push(`    to: ${edge.to}`);
    lines.push(`    action: ${edge.action}`);
    if (edge.target) lines.push(`    target: ${JSON.stringify(edge.target)}`);
    lines.push(`    provenance: ${edge.provenance}`);
    lines.push(`    confidence: ${edge.confidence}`);
  }
  return lines.join("\n") + "\n";
}
