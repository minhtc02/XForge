import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  checkDesignConformance,
  conformanceVerdict,
  designNodesForFeature,
  inventoryFromProbe,
  readSnapshots,
  renderConformanceMarkdown,
  snapshotFilePath,
  type ConformanceVerdict,
  type DesignMap,
  type ProbeScreen,
  type StoredSnapshot,
  type TestConfig,
  type TestPlan,
  type VisualEscalation,
} from "@xforge/test-core";

/**
 * Run design conformance for a completed run.
 *
 * Everything decision-making here is already pure and tested; this module only
 * joins the three sources — the plan's design references, the frozen Figma
 * snapshots, and the probe's measured element tree — and applies the project's
 * severity policy.
 *
 * It degrades quietly on purpose. No snapshots, no probe dump, or a node the
 * design map never mapped are all environment conditions, not product defects,
 * so they produce no findings rather than a failure (§4.4).
 */

export interface ConformanceRunInput {
  projectRoot: string;
  plan: TestPlan;
  config: TestConfig;
  /** Screens the probe measured, when a probe ran. */
  probeScreens?: ProbeScreen[];
  designMap?: DesignMap | null;
}

export interface ConformanceRunResult {
  /** Escalations to apply to the run's executions. */
  escalations: VisualEscalation[];
  /** Per-case verdicts, for the report. */
  byCase: Array<{ caseId: string; verdict: ConformanceVerdict }>;
  markdown: string;
  /** Why nothing ran, when that is the case. */
  skippedReason?: string;
}

export async function runConformance(
  input: ConformanceRunInput,
): Promise<ConformanceRunResult> {
  const empty = (reason: string): ConformanceRunResult => ({
    escalations: [],
    byCase: [],
    markdown: "",
    skippedReason: reason,
  });

  if (!input.config.visual.conformance_enabled) {
    return empty("visual.conformance_enabled is false");
  }
  if (!input.probeScreens || input.probeScreens.length === 0) {
    return empty(
      "no accessibility probe ran — set execution.probe_before_run to `auto` or `always`",
    );
  }

  const snapshotPath = snapshotFilePath(input.projectRoot, input.plan.id);
  const snapshots = await readSnapshots(snapshotPath);
  if (!snapshots || Object.keys(snapshots.snapshots).length === 0) {
    return empty(
      `no frozen design references — run \`xforge test design ${input.plan.id}\``,
    );
  }

  // Which Figma node backs which screen. A case's own design references win;
  // the design map fills in the rest.
  const nodeForScreen = buildScreenIndex(input.plan, input.designMap);
  const screensByTarget = new Map(input.probeScreens.map((s) => [s.target, s]));

  const thresholds = {
    layoutTolerancePoints: input.config.visual.layout_tolerance_points,
    layoutFailurePoints: input.config.visual.layout_failure_points,
    minTapPoints: input.config.visual.min_tap_points,
  };

  const escalations: VisualEscalation[] = [];
  const byCase: ConformanceRunResult["byCase"] = [];

  for (const testCase of input.plan.test_cases) {
    if (!testCase.types.includes("visual")) continue;

    // The screen this case captures is the target of its screen-is assertion.
    const target =
      testCase.assertions.find((a) => a.kind === "screen-is")?.target ??
      testCase.steps.find((s) => s.action === "capture-screenshot")?.target;
    if (!target) continue;

    const probeScreen = screensByTarget.get(target);
    if (!probeScreen || !probeScreen.reached) continue;

    const nodeId =
      testCase.design_references[0]?.figma_node_id ??
      nodeForScreen.get(`${testCase.feature}:${target}`) ??
      nodeForScreen.get(testCase.feature);
    if (!nodeId) continue;

    const snapshot: StoredSnapshot | undefined = snapshots.snapshots[nodeId];
    if (
      !snapshot ||
      (snapshot.width === undefined && snapshot.height === undefined)
    ) {
      continue;
    }

    const findings = checkDesignConformance({
      design: {
        node_id: snapshot.node_id,
        name: snapshot.name,
        ...(snapshot.width !== undefined ? { width: snapshot.width } : {}),
        ...(snapshot.height !== undefined ? { height: snapshot.height } : {}),
        ...(snapshot.device ? { device: snapshot.device } : {}),
        variables: snapshot.variables,
      },
      actual: probeScreen.elements,
      screen: target,
      thresholds,
      expectedElements: snapshot.elements,
    });

    const verdict = conformanceVerdict({
      caseId: testCase.id,
      findings,
      failsAt: input.config.visual.conformance_fails_at,
      evidence: [
        {
          kind: "figma",
          path: snapshotPath,
          description: `Figma node ${nodeId} (${snapshots.source})`,
        },
      ],
    });

    byCase.push({ caseId: testCase.id, verdict });
    if (verdict.escalation) escalations.push(verdict.escalation);
  }

  return {
    escalations,
    byCase,
    markdown: renderConformanceMarkdown(byCase),
  };
}

/** `feature:screen` → node id, plus a `feature` fallback for single-screen features. */
function buildScreenIndex(
  plan: TestPlan,
  designMap?: DesignMap | null,
): Map<string, string> {
  const index = new Map<string, string>();
  if (!designMap) return index;
  for (const feature of new Set(plan.test_cases.map((c) => c.feature))) {
    const nodes = designNodesForFeature(designMap, feature);
    for (const node of nodes) {
      index.set(`${feature}:${node.screen}`, node.node_id);
    }
    const first = nodes[0];
    if (first && !index.has(feature)) index.set(feature, first.node_id);
  }
  return index;
}

/** Read a probe dump previously exported from a run's xcresult bundle. */
export async function readProbeScreens(
  path: string,
): Promise<ProbeScreen[] | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as ProbeScreen[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Re-exported so callers can build an identifier inventory from the same dump. */
export { inventoryFromProbe };
