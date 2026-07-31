import { describe, expect, it } from "vitest";
import {
  ROOT_NODE,
  deriveGraphFromModel,
  mergeGraphs,
  nodeForFeature,
  parseNavigationGraph,
  renderNavigationYaml,
  shortestPath,
  stepsForPath,
  unreachableFeatures,
} from "./navigation.js";
import type { NavigationGraph } from "../models/navigation.js";
import { parseProjectModel } from "@xforge/core";

function graph(): NavigationGraph {
  return parseNavigationGraph({
    schema_version: 1,
    root: "root",
    nodes: [
      { id: "root", anchor: "root", provenance: "explicit", confidence: 0.9 },
      {
        id: "home",
        anchor: "home-tab",
        provenance: "explicit",
        confidence: 0.9,
      },
      {
        id: "alarm-screen",
        anchor: "alarm-list",
        feature: "alarm",
        provenance: "explicit",
        confidence: 0.9,
      },
      {
        id: "settings",
        anchor: "settings-root",
        feature: "settings",
        provenance: "derived",
        confidence: 0.5,
      },
    ],
    edges: [
      {
        from: "root",
        to: "home",
        action: "open",
        target: "home-tab",
        provenance: "explicit",
        confidence: 0.9,
      },
      {
        from: "home",
        to: "alarm-screen",
        action: "tap",
        target: "alarm-tab",
        provenance: "explicit",
        confidence: 0.9,
      },
      {
        from: "home",
        to: "settings",
        action: "tap",
        target: "settings-tab",
        // Below the default 0.6 gate — must never be used.
        provenance: "derived",
        confidence: 0.4,
      },
    ],
  });
}

describe("shortestPath", () => {
  it("finds the shortest path and reports its weakest edge", () => {
    const path = shortestPath(graph(), "root", "alarm-screen");
    expect(path?.edges.map((e) => e.to)).toEqual(["home", "alarm-screen"]);
    expect(path?.confidence).toBe(0.9);
  });

  it("refuses edges below the confidence gate", () => {
    expect(shortestPath(graph(), "root", "settings")).toBeUndefined();
  });

  it("uses a low-confidence edge when the gate is lowered", () => {
    const path = shortestPath(graph(), "root", "settings", {
      minEdgeConfidence: 0.3,
    });
    expect(path?.confidence).toBe(0.4);
  });

  it("returns an empty path for the same node", () => {
    expect(shortestPath(graph(), "root", "root")?.edges).toEqual([]);
  });

  it("respects the max path length", () => {
    expect(
      shortestPath(graph(), "root", "alarm-screen", { maxPathLength: 1 }),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown target rather than guessing", () => {
    expect(shortestPath(graph(), "root", "nope")).toBeUndefined();
  });
});

describe("stepsForPath", () => {
  it("renders edges as sequentially numbered steps", () => {
    const path = shortestPath(graph(), "root", "alarm-screen")!;
    const { steps, nextIndex } = stepsForPath(path, 2);
    expect(steps).toEqual([
      { id: "step-2", action: "open", target: "home-tab" },
      { id: "step-3", action: "tap", target: "alarm-tab" },
    ]);
    expect(nextIndex).toBe(4);
  });
});

describe("deriveGraphFromModel", () => {
  const model = parseProjectModel({
    project: { id: "app", name: "App", type: "ios-application" },
    features: [
      {
        id: "alarm",
        name: "Alarm",
        status: "IMPLEMENTED",
        confidence: 0.9,
        entry_points: [{ name: "AlarmView" }],
      },
    ],
    metadata: { generator_version: "0.1.0" },
  });

  it("creates a derived node per feature at confidence 0.6", () => {
    const derived = deriveGraphFromModel(model);
    const node = nodeForFeature(derived, "alarm");
    // No accessibility identifier in this model, so the entry point's type
    // name is the only thing left to anchor on.
    expect(node?.anchor).toBe("AlarmView");
    expect(node?.provenance).toBe("derived");
    expect(node?.confidence).toBe(0.6);
    expect(derived.root).toBe(ROOT_NODE);
  });

  it("anchors on a real accessibility identifier when the source has one", () => {
    const withIds = parseProjectModel({
      project: { id: "app", name: "App", type: "ios-application" },
      features: [
        {
          id: "alarm",
          name: "Alarm",
          status: "IMPLEMENTED",
          confidence: 0.9,
          entry_points: [{ name: "AlarmView" }],
        },
      ],
      accessibility_identifiers: [
        // A dynamic one first: it must not be chosen, since no test could
        // resolve it to a literal locator.
        {
          expression: '"alarm-row-\\(id)"',
          file: "AlarmView.swift",
          dynamic: true,
          feature: "alarm",
        },
        {
          value: "alarm-list",
          expression: '"alarm-list"',
          file: "AlarmView.swift",
          dynamic: false,
          feature: "alarm",
        },
      ],
      metadata: { generator_version: "0.1.0" },
    });
    expect(nodeForFeature(deriveGraphFromModel(withIds), "alarm")?.anchor).toBe(
      "alarm-list",
    );
  });

  it("derived edges sit exactly at the default gate, never below", () => {
    const derived = deriveGraphFromModel(model);
    expect(shortestPath(derived, derived.root, "alarm-screen")).toBeDefined();
    expect(
      shortestPath(derived, derived.root, "alarm-screen", {
        minEdgeConfidence: 0.7,
      }),
    ).toBeUndefined();
  });
});

describe("mergeGraphs", () => {
  it("lets a later (authored) graph override an earlier (derived) one", () => {
    const derived = parseNavigationGraph({
      root: "root",
      nodes: [
        {
          id: "alarm-screen",
          anchor: "guessed",
          feature: "alarm",
          provenance: "derived",
          confidence: 0.6,
        },
      ],
      edges: [
        {
          from: "root",
          to: "alarm-screen",
          action: "open",
          target: "guessed",
          provenance: "derived",
          confidence: 0.6,
        },
      ],
    });
    const authored = parseNavigationGraph({
      root: "root",
      nodes: [
        {
          id: "alarm-screen",
          anchor: "alarm-list",
          feature: "alarm",
          provenance: "explicit",
          confidence: 0.9,
        },
      ],
      edges: [
        {
          from: "root",
          to: "alarm-screen",
          action: "open",
          target: "alarm-list",
          provenance: "explicit",
          confidence: 0.9,
        },
      ],
    });
    const merged = mergeGraphs(derived, authored);
    expect(merged.nodes).toHaveLength(1);
    expect(nodeForFeature(merged, "alarm")?.anchor).toBe("alarm-list");
    expect(merged.edges[0]?.confidence).toBe(0.9);
  });
});

describe("unreachableFeatures", () => {
  it("lists features no confident path reaches", () => {
    expect(
      unreachableFeatures(graph(), ["alarm", "settings", "ghost"]),
    ).toEqual(["settings", "ghost"]);
  });
});

describe("renderNavigationYaml", () => {
  it("round-trips through the parser", () => {
    const yaml = renderNavigationYaml(graph());
    expect(yaml).toContain("root: root");
    expect(yaml).toContain("provenance: explicit");
    expect(yaml).toContain("# XForge Test navigation graph.");
  });
});
