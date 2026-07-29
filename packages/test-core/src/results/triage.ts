import { createHash } from "node:crypto";
import type { BugReport } from "../models/bug.js";
import type { TestExecution } from "../models/result.js";
import type { TestCase } from "../models/test-case.js";
import { PRODUCT_FAILURE_STATUSES, type TestStatus } from "../models/enums.js";
import type { Priority, Severity } from "../models/enums.js";

/**
 * Failure triage + bug deduplication (blueprint §24, §25, §4.4). Only product
 * failures become bugs; infrastructure/environment failures never do. Failures
 * sharing a fingerprint collapse into one bug with all impacted cases attached.
 */

const STATUS_TO_BUG_TYPE: Partial<Record<TestStatus, BugReport["type"]>> = {
  FAIL_FUNCTIONAL: "Functional",
  FAIL_VISUAL: "Visual",
  FAIL_ACCESSIBILITY: "Accessibility",
  FAIL_PERFORMANCE: "Performance",
};

/** Fingerprint = feature + screen + failed step + status + normalized error. */
export function fingerprint(feature: string, execution: TestExecution): string {
  const parts = [
    feature,
    execution.step_id ?? "",
    execution.status,
    execution.normalized_error ?? "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 16);
}

function severityForPriority(priority: Priority): Severity {
  switch (priority) {
    case "P0":
      return "critical";
    case "P1":
      return "major";
    case "P2":
      return "minor";
    default:
      return "info";
  }
}

export interface TriageInput {
  executions: TestExecution[];
  cases: TestCase[];
}

/**
 * Group product failures into deduplicated bug reports. Infrastructure and
 * environment failures are excluded (they are not product bugs, §4.4).
 */
export function triageBugs(input: TriageInput): BugReport[] {
  const caseById = new Map(input.cases.map((c) => [c.id, c]));
  const groups = new Map<
    string,
    { execs: TestExecution[]; cases: TestCase[] }
  >();

  for (const exec of input.executions) {
    if (!PRODUCT_FAILURE_STATUSES.has(exec.status)) continue;
    const testCase = caseById.get(exec.case_id);
    const feature = testCase?.feature ?? "unknown";
    const fp = fingerprint(feature, exec);
    const group = groups.get(fp) ?? { execs: [], cases: [] };
    group.execs.push(exec);
    if (testCase) group.cases.push(testCase);
    groups.set(fp, group);
  }

  const bugs: BugReport[] = [];
  let seq = 0;
  for (const [fp, group] of groups) {
    seq += 1;
    const primary = group.cases[0];
    const feature = primary?.feature ?? "unknown";
    const status = group.execs[0]!.status;
    const type = STATUS_TO_BUG_TYPE[status] ?? "Functional";
    const priority: Priority = primary?.priority ?? "P2";
    const requirements = [
      ...new Set(group.cases.flatMap((c) => c.requirements)),
    ];
    const suspectedCode = [
      ...new Set(
        group.cases.flatMap((c) => c.code_references.map((r) => r.file)),
      ),
    ];
    bugs.push({
      schema_version: 1,
      id: `XFBUG-${feature.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${String(seq).padStart(3, "0")}`,
      title: primary
        ? `${primary.title} — ${humanStatus(status)}`
        : humanStatus(status),
      type,
      severity: severityForPriority(priority),
      priority,
      reproducibility: `${group.execs.length}/${group.execs.length}`,
      feature,
      status: "Triaged",
      fingerprint: fp,
      environment: {},
      preconditions: primary?.preconditions ?? [],
      steps: primary ? primary.steps.map(stepText) : [],
      expected_result: primary?.expected_results.join("; "),
      actual_result: group.execs[0]!.message,
      evidence: group.execs.flatMap((e) => e.evidence),
      related_requirements: requirements,
      impacted_cases: [...new Set(group.execs.map((e) => e.case_id))],
      suspected_code: suspectedCode,
      confidence: 0.6,
    });
  }
  return bugs;
}

function humanStatus(status: TestStatus): string {
  return status
    .replace(/^FAIL_/, "")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
    .concat(" failure");
}

function stepText(step: { action: string; target?: string }): string {
  return step.target ? `${step.action} ${step.target}` : step.action;
}
