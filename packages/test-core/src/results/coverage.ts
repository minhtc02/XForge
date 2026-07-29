import type {
  CoverageEntry,
  CoverageReport,
  TestExecution,
} from "../models/result.js";
import type { TestPlan } from "../models/plan.js";

/**
 * Coverage computation (blueprint §23 coverage/). Maps executions back to the
 * plan's requirements, features and design references to report what was
 * covered and what passed. Deterministic over plan + executions.
 */

export function computeCoverage(
  plan: TestPlan,
  executions: TestExecution[],
): CoverageReport {
  const byCase = new Map<string, TestExecution>();
  for (const e of executions) byCase.set(e.case_id, e);

  const casePassed = (caseId: string): boolean =>
    byCase.get(caseId)?.status === "PASS";

  // Requirement coverage: a requirement is covered if any case references it.
  const reqMap = new Map<string, CoverageEntry>();
  for (const c of plan.test_cases) {
    for (const req of c.requirements) {
      const entry =
        reqMap.get(req) ??
        ({
          id: req,
          kind: "requirement",
          covered: true,
          passed: true,
          case_ids: [],
        } as CoverageEntry);
      entry.case_ids.push(c.id);
      entry.passed = (entry.passed ?? true) && casePassed(c.id);
      reqMap.set(req, entry);
    }
  }

  // Feature coverage.
  const featMap = new Map<string, CoverageEntry>();
  for (const c of plan.test_cases) {
    const entry =
      featMap.get(c.feature) ??
      ({
        id: c.feature,
        kind: "feature",
        covered: true,
        passed: true,
        case_ids: [],
      } as CoverageEntry);
    entry.case_ids.push(c.id);
    entry.passed = (entry.passed ?? true) && casePassed(c.id);
    featMap.set(c.feature, entry);
  }

  // Design coverage: cases that carry design references.
  const designMap = new Map<string, CoverageEntry>();
  for (const c of plan.test_cases) {
    for (const d of c.design_references) {
      const entry =
        designMap.get(d.figma_node_id) ??
        ({
          id: d.figma_node_id,
          kind: "design",
          covered: true,
          passed: true,
          case_ids: [],
        } as CoverageEntry);
      entry.case_ids.push(c.id);
      entry.passed = (entry.passed ?? true) && casePassed(c.id);
      designMap.set(d.figma_node_id, entry);
    }
  }

  return {
    requirement: [...reqMap.values()],
    feature: [...featMap.values()],
    design: [...designMap.values()],
    confidence: 1,
  };
}
