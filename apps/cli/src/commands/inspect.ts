import { existsSync } from "node:fs";
import { loadConfig, readProjectModel, statePath } from "@xforge/core";
import { NotFoundError, type Logger } from "@xforge/shared";
import { emitResult, type CliContext } from "../context.js";

export type InspectTarget =
  "project" | "features" | "requirements" | "evidence" | "technologies";

/**
 * `xforge inspect <target>` (blueprint §24.3).
 * Reads the persisted Project Model and prints the requested slice.
 */
export async function runInspect(
  ctx: CliContext,
  target: InspectTarget,
): Promise<Record<string, unknown>> {
  const { projectRoot, logger } = ctx;
  await loadConfig(projectRoot); // ensures initialized

  const modelPath = statePath(projectRoot, "projectModel");
  if (!existsSync(modelPath)) {
    throw new NotFoundError(
      "No Project Model found. Run `xforge docs` first.",
      { details: { modelPath } },
    );
  }
  // `inspect` exists to show what was found, so it wants everything.
  const model = await readProjectModel(projectRoot, { full: true });

  let payload: Record<string, unknown>;
  switch (target) {
    case "project":
      payload = { project: model.project, metadata: model.metadata };
      break;
    case "features":
      payload = { features: model.features };
      break;
    case "requirements":
      payload = { requirements: model.requirements };
      break;
    case "technologies":
      payload = { technologies: model.technologies };
      break;
    case "evidence":
      payload = {
        evidence: [
          ...model.features.flatMap((f) => f.evidence),
          ...model.requirements.flatMap((r) => r.evidence),
          ...model.technologies.flatMap((t) => t.evidence),
        ],
      };
      break;
  }

  emitResult(ctx, payload, () => renderInspect(logger, target, payload));
  return payload;
}

function renderInspect(
  _logger: Logger,
  target: InspectTarget,
  payload: Record<string, unknown>,
): void {
  process.stderr.write(`\nInspect: ${target}\n\n`);
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}
