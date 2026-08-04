import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  HttpFigmaAdapter,
  captureSnapshots,
  designNodesForFeature,
  figmaTokenAvailable,
  loadDesignMap,
  loadTestConfig,
  parseTestPlan,
  planFilePath,
  readSnapshots,
  snapshotFilePath,
  snapshotTemplate,
  unresolvedNodes,
  writeSnapshots,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

export interface TestDesignOptions {
  /** Write a template for the agent to fill in from the Figma MCP. */
  init?: boolean;
  /** Fetch over the Figma REST API instead (needs FIGMA_TOKEN). */
  rest?: boolean;
  force?: boolean;
}

export interface TestDesignResult {
  planId: string;
  snapshotPath: string;
  source: string;
  nodes: number;
  resolved: number;
  unresolved: string[];
  fileKey?: string;
  fileVersion?: string;
  wrote: boolean;
}

/**
 * `xforge test design <plan-id>` — freeze the design references a plan will be
 * checked against (blueprint §11.4).
 *
 * Two ways to fill the snapshot file, in order of preference:
 *
 *  1. **MCP (default).** `--init` writes a template listing every node the plan
 *     needs; the Claude plugin calls the Figma MCP and fills it in. The CLI is a
 *     plain Node process and cannot reach an MCP server, so this is how real
 *     Figma data gets in — and it keeps credentials out of the CLI entirely,
 *     while leaving planning reproducible from a file.
 *  2. **REST (`--rest`).** For CI, where no agent is present. Needs
 *     `FIGMA_TOKEN`.
 *
 * Either way the result is frozen: the run reads this file and never the
 * network, so a design edited mid-run cannot change a test result.
 */
export async function runTestDesign(
  ctx: CliContext,
  planId: string,
  options: TestDesignOptions = {},
): Promise<TestDesignResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge test design <plan-id>",
    );
  }

  const planPath = planFilePath(projectRoot, planId, "plan");
  if (!existsSync(planPath)) {
    throw new NotFoundError(`Plan ${planId} not found`, {
      details: { planPath },
    });
  }
  const plan = parseTestPlan(JSON.parse(await readFile(planPath, "utf8")));
  const config = await loadTestConfig(projectRoot);
  const snapshotPath = snapshotFilePath(projectRoot, planId);

  // Nodes this plan needs: every design reference on its cases, plus every
  // node the design map has for the features in scope.
  const designMap = await loadDesignMap(projectRoot, config.figma.design_map);
  const features = [...new Set(plan.test_cases.map((c) => c.feature))];
  const mapped = designMap
    ? features.flatMap((f) => designNodesForFeature(designMap, f))
    : [];
  const nodeIds = [
    ...new Set([
      ...plan.test_cases.flatMap((c) =>
        c.design_references.map((d) => d.figma_node_id),
      ),
      ...mapped.map((m) => m.node_id),
    ]),
  ];

  if (nodeIds.length === 0) {
    throw new ValidationError(
      `No Figma nodes are mapped for ${planId}. Add them to ${config.figma.design_map} ` +
        "(feature → screen → state → node_id), then re-run.",
    );
  }

  const fileKey = designMap ? figmaFileKey(designMap) : undefined;
  const existing = await readSnapshots(snapshotPath);
  let wrote = false;

  if (options.rest) {
    if (!figmaTokenAvailable()) {
      throw new ValidationError(
        "FIGMA_TOKEN is not set. Export it, or omit --rest to use the MCP path.",
      );
    }
    if (!fileKey) {
      throw new ValidationError(
        `No Figma file key found. Add a \`figma_url\` to a screen in ${config.figma.design_map}.`,
      );
    }
    const captured = await captureSnapshots({
      adapter: new HttpFigmaAdapter({ fileKey }),
      nodeIds,
      fileKey,
      source: "rest",
    });
    await writeSnapshots(snapshotPath, captured);
    wrote = true;
  } else if (options.init || !existing) {
    if (existing && !options.force) {
      throw new ValidationError(
        `${relative(projectRoot, snapshotPath)} already exists. Re-run with --force to reset it.`,
      );
    }
    await writeSnapshots(
      snapshotPath,
      snapshotTemplate(nodeIds, fileKey ?? ""),
    );
    wrote = true;
  }

  const current = await readSnapshots(snapshotPath);
  const unresolved = current ? unresolvedNodes(current) : nodeIds;

  const result: TestDesignResult = {
    planId,
    snapshotPath,
    source: current?.source ?? "mcp",
    nodes: nodeIds.length,
    resolved: nodeIds.length - unresolved.length,
    unresolved,
    ...(fileKey ? { fileKey } : {}),
    ...(current?.file_version ? { fileVersion: current.file_version } : {}),
    wrote,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(
      wrote
        ? `Design snapshots ${options.rest ? "fetched" : "prepared"} for ${planId}`
        : `Design snapshots for ${planId}`,
    );
    process.stderr.write(
      `\n  File:      ${relative(projectRoot, snapshotPath)}\n` +
        `  Source:    ${result.source}\n` +
        `  Nodes:     ${result.resolved}/${result.nodes} resolved\n`,
    );
    if (result.unresolved.length > 0) {
      process.stderr.write(
        `\n  Waiting on ${result.unresolved.length} node(s):\n` +
          result.unresolved.map((n) => `    ${n}\n`).join(""),
      );
      process.stderr.write(
        "\n  Next:\n" +
          "    /xforge:test-design   # let Claude fill these in via the Figma MCP\n" +
          "    xforge test design " +
          planId +
          " --rest   # or fetch over HTTP with FIGMA_TOKEN\n",
      );
    } else {
      process.stderr.write(
        `\n  Next:\n    xforge test run ${planId} --execute\n`,
      );
    }
  });
  return result;
}

/** Extract the file key from any `figma_url` recorded in the design map. */
function figmaFileKey(map: {
  features: Record<string, { screens: Record<string, { figma_url?: string }> }>;
}): string | undefined {
  for (const feature of Object.values(map.features)) {
    for (const screen of Object.values(feature.screens)) {
      const match = /figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/.exec(
        screen.figma_url ?? "",
      );
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}
