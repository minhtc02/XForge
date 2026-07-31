import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { ValidationError } from "@xforge/shared";
import {
  deriveGraphFromModel,
  loadTestConfig,
  mergeGraphs,
  navigationGraphPath,
  parseNavigationGraph,
  renderNavigationYaml,
  shortestPath,
  unreachableFeatures,
  type NavigationGraph,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";
import { loadTestModelContext } from "./shared.js";

export interface TestNavigationOptions {
  /** Scaffold navigation.yaml from the Project Model. */
  init?: boolean;
  force?: boolean;
  /** Suppress output — used when `test plan` runs this as a sub-step. */
  silent?: boolean;
}

export interface TestNavigationResult {
  graphPath: string;
  exists: boolean;
  created: boolean;
  nodes: number;
  edges: number;
  root: string;
  reachable: string[];
  unreachable: string[];
  minEdgeConfidence: number;
}

/**
 * `xforge test navigation` (optimization plan §A).
 *
 * Inspects — and with `--init` scaffolds — the navigation graph that BFS uses to
 * build each case's navigation prefix. Being able to check reachability without
 * planning or building matters: an unreachable screen silently drops its cases,
 * and that should be visible while editing the graph, not after a run.
 */
export async function runTestNavigation(
  ctx: CliContext,
  options: TestNavigationOptions = {},
): Promise<TestNavigationResult> {
  const { projectRoot, logger } = ctx;
  const { model, testConfig } = await loadTestModelContext(ctx);
  const graphPath = navigationGraphPath(
    projectRoot,
    testConfig.navigation.graph,
  );

  const derived = deriveGraphFromModel(model);
  let created = false;

  if (options.init) {
    if (existsSync(graphPath) && !options.force) {
      throw new ValidationError(
        `${relative(projectRoot, graphPath)} already exists. Re-run with --force to overwrite.`,
      );
    }
    await mkdir(dirname(graphPath), { recursive: true });
    await writeFile(graphPath, renderNavigationYaml(derived), "utf8");
    created = true;
  }

  const authored = await loadAuthoredGraph(graphPath);
  const graph = authored ? mergeGraphs(derived, authored) : derived;

  const featureIds = model.features.map((f) => f.id);
  const pathOptions = {
    minEdgeConfidence: testConfig.navigation.min_edge_confidence,
    maxPathLength: testConfig.navigation.max_path_length,
  };
  const unreachable = unreachableFeatures(graph, featureIds, pathOptions);
  const reachable = featureIds.filter((id) => !unreachable.includes(id));

  const result: TestNavigationResult = {
    graphPath,
    exists: existsSync(graphPath),
    created,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    root: graph.root,
    reachable,
    unreachable,
    minEdgeConfidence: pathOptions.minEdgeConfidence,
  };

  if (options.silent) return result;

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    if (created) {
      logger.success(
        `Scaffolded ${relative(projectRoot, graphPath)} from the Project Model`,
      );
      process.stderr.write(
        "\n  Every entry starts at provenance `derived` (confidence 0.6).\n" +
          "  Review each one and raise it to `explicit` once confirmed.\n",
      );
    } else {
      logger.success(
        result.exists
          ? "Navigation graph loaded"
          : "No authored graph — using the model-derived graph",
      );
    }
    process.stderr.write(
      `\n  Graph:  ${relative(projectRoot, graphPath)}${result.exists ? "" : " (not present)"}\n` +
        `  Root:   ${result.root}\n` +
        `  Nodes:  ${result.nodes}\n` +
        `  Edges:  ${result.edges}\n` +
        `  Gate:   confidence >= ${result.minEdgeConfidence}\n` +
        `\n  Reachable features (${reachable.length}): ${reachable.join(", ") || "—"}\n`,
    );
    if (unreachable.length > 0) {
      process.stderr.write(
        `  UNREACHABLE (${unreachable.length}): ${unreachable.join(", ")}\n` +
          "    → no test cases will be generated for these.\n",
      );
    }
    // Show one worked path so the graph's effect is concrete.
    const sample = reachable[0];
    if (sample) {
      const node = graph.nodes.find((n) => n.feature === sample);
      const path = node
        ? shortestPath(graph, graph.root, node.id, pathOptions)
        : undefined;
      if (path) {
        process.stderr.write(
          `\n  Example path to "${sample}" (confidence ${path.confidence}):\n` +
            `    ${[graph.root, ...path.edges.map((e) => e.to)].join(" → ")}\n`,
        );
      }
    }
  });
  return result;
}

/** Read and validate the authored graph, if the project has one. */
async function loadAuthoredGraph(
  path: string,
): Promise<NavigationGraph | undefined> {
  if (!existsSync(path)) return undefined;
  const raw = parseYaml(await readFile(path, "utf8"));
  if (!raw || typeof raw !== "object") return undefined;
  try {
    return parseNavigationGraph(raw);
  } catch (cause) {
    throw new ValidationError(`Invalid navigation graph at ${path}`, { cause });
  }
}

/** Shared loader used by `test plan` so both read the graph identically. */
export async function resolveNavigationGraph(
  projectRoot: string,
  configGraphPath: string,
  model: Parameters<typeof deriveGraphFromModel>[0],
): Promise<{ graph: NavigationGraph; authored: boolean; raw?: string }> {
  const path = navigationGraphPath(projectRoot, configGraphPath);
  const derived = deriveGraphFromModel(model);
  if (!existsSync(path)) return { graph: derived, authored: false };
  const raw = await readFile(path, "utf8");
  const authored = parseNavigationGraph(parseYaml(raw));
  return { graph: mergeGraphs(derived, authored), authored: true, raw };
}

/** Re-exported so `test plan` does not need its own YAML import. */
export { loadTestConfig };
