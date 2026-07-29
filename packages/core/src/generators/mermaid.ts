import type { Feature } from "../project-model/schema.js";

/**
 * Mermaid diagram generation from verified relationships only (blueprint §15.2).
 * We never invent edges; diagrams are built from structural facts already in
 * the model (features and their entry points / roles).
 */

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

/** A feature-overview graph: app node → each feature → its entry points. */
export function featureOverviewDiagram(
  projectName: string,
  features: Feature[],
): string {
  if (features.length === 0) {
    return "```mermaid\ngraph TD\n  app[No features detected]\n```";
  }
  const lines: string[] = ["```mermaid", "graph TD"];
  const appNode = sanitizeId(projectName) || "app";
  lines.push(`  ${appNode}["${projectName}"]`);
  for (const f of features) {
    const fNode = `f_${sanitizeId(f.id)}`;
    lines.push(`  ${appNode} --> ${fNode}["${f.name}"]`);
    for (const ep of f.entry_points.slice(0, 4)) {
      const epNode = `e_${sanitizeId(f.id)}_${sanitizeId(ep.name)}`;
      lines.push(`  ${fNode} --> ${epNode}("${ep.name}")`);
    }
  }
  lines.push("```");
  return lines.join("\n");
}
