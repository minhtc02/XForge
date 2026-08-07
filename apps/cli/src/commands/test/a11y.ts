import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { NotFoundError, ValidationError, type Logger } from "@xforge/shared";
import type { ProjectModel } from "@xforge/core";
import {
  applyIdentifier,
  buildA11yProposal,
  hashPlan,
  locatorsForCase,
  parseA11yProposal,
  parseTestPlan,
  planFilePath,
  reconcileLocators,
  serializeJson,
  type A11yProposal,
  type IdentifierNeed,
  type IdentifierRequest,
  type TestPlan,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";
import { loadTestModelContext } from "./shared.js";

/**
 * `xforge test a11y <plan-id>` and `--apply`.
 *
 * A locator the plan looks for that no source declares is the most expensive
 * kind of plan defect: every case using it fails by timeout, and triage reads a
 * timeout as a product bug. `test plan` already detects it — the
 * `locator-not-found-in-source` deviation — and then had nothing to offer but
 * prose, because the repair lands in product code on an element XForge had to
 * guess at.
 *
 * So the repair is split, with a human in the middle:
 *
 *   `test a11y <plan-id>`          writes a proposal: each missing locator, the
 *                                  cases that need it, a suggested element with
 *                                  the reason it was suggested, and the other
 *                                  unidentified elements nearby.
 *   `test a11y <plan-id> --apply`  writes only the entries marked `approved`.
 *
 * The gate is not ceremony. A wrong identifier — on the `VStack` rather than the
 * `Button` inside it — produces a test that finds an element, taps it, passes,
 * and exercises nothing; that is invisible for as long as the test exists. A
 * missing identifier fails on the first run and gets fixed. Per-element approval
 * is what keeps the loud failure the worst case, which is why there is no flag
 * that applies everything.
 */

export interface TestA11yOptions {
  /** Apply the approved entries instead of writing a proposal. */
  apply?: boolean;
  /** Overwrite an existing proposal. */
  force?: boolean;
  /** How many alternatives to list per locator. */
  maxCandidates?: number;
}

export interface TestA11yResult {
  planId: string;
  proposalPath: string;
  mode: "proposal" | "apply";
  /** Locators the plan needs and source does not declare. */
  missing: string[];
  /**
   * True when the source declares no accessibility identifier anywhere, so every
   * locator the plan uses is missing rather than merely unreconciled.
   */
  noIdentifiersAtAll?: boolean;
  /** Locators a site was suggested for. */
  suggested: string[];
  /** Locators nothing could be suggested for, and why. */
  unresolved: Array<{ locator: string; note: string }>;
  applied?: {
    /** `locator → file:line`. */
    written: Array<{ locator: string; file: string; line: number }>;
    /** Approved entries that were declined, and why. */
    refused: Array<{ locator: string; reason: string }>;
    /** Entries left unapproved, so nothing was attempted. */
    pending: string[];
    /** Files whose contents changed. */
    files: string[];
  };
}

async function loadPlan(
  projectRoot: string,
  planId: string,
): Promise<TestPlan> {
  const planPath = planFilePath(projectRoot, planId, "plan");
  if (!existsSync(planPath)) {
    throw new NotFoundError(`Plan ${planId} not found`, {
      details: { planPath },
    });
  }
  return parseTestPlan(JSON.parse(await readFile(planPath, "utf8")));
}

/** What the cases actually do with a locator — enough to judge a site by. */
function intentFor(plan: TestPlan, locator: string): string {
  const parts: string[] = [];
  for (const testCase of plan.test_cases) {
    for (const step of testCase.steps) {
      if (step.target === locator) {
        parts.push(`${step.action} (${testCase.id}: ${testCase.title})`);
      }
    }
    for (const assertion of testCase.assertions) {
      if (assertion.target === locator) {
        parts.push(`assert ${assertion.kind} (${testCase.id})`);
      }
    }
  }
  return [...new Set(parts)].slice(0, 4).join("; ");
}

/**
 * The locators to propose edits for: the plan's own missing locators, plus any a
 * review recorded as `required_identifiers`. A reviewer who read the source and
 * said "this needs a `save-button`" has produced exactly this request, and until
 * now it went nowhere.
 */
function collectNeeds(
  plan: TestPlan,
  model: ProjectModel,
): { needs: IdentifierNeed[]; noIdentifiersAtAll: boolean } {
  const reconcile = reconcileLocators({
    cases: plan.test_cases,
    inventory: model.accessibility_identifiers,
  });

  const featureFiles = new Map<string, string[]>();
  for (const feature of model.features) {
    featureFiles.set(
      feature.id,
      feature.source_files.filter((f) => f.endsWith(".swift")),
    );
  }
  const swiftFiles = [...featureFiles.values()].flat();

  /**
   * Reconciliation reports nothing when the inventory is empty, because an empty
   * inventory could mean "the source was never inspected" — and claiming every
   * locator is missing on no evidence would be a lie.
   *
   * Here that ambiguity is resolvable: the model *did* inspect these Swift files
   * and found no identifier in any of them. So the locators are all genuinely
   * absent, and this is the case the command matters most for — a project with no
   * identifiers is the usual starting point, not an edge case. Saying "every
   * locator exists" there would be the same lie in the other direction.
   */
  const noIdentifiersAtAll = reconcile.skipped && swiftFiles.length > 0;

  const byLocator = new Map<string, IdentifierNeed>();
  const add = (
    locator: string,
    caseId: string | undefined,
    files: string[],
  ) => {
    const existing = byLocator.get(locator);
    if (existing) {
      if (caseId && !existing.cases.includes(caseId))
        existing.cases.push(caseId);
      for (const f of files)
        if (!existing.files.includes(f)) existing.files.push(f);
      return;
    }
    byLocator.set(locator, {
      locator,
      cases: caseId ? [caseId] : [],
      intent: intentFor(plan, locator),
      files: [...files],
    });
  };

  if (noIdentifiersAtAll) {
    for (const testCase of plan.test_cases) {
      for (const { locator } of locatorsForCase(testCase)) {
        add(locator, testCase.id, featureFiles.get(testCase.feature) ?? []);
      }
    }
  }

  for (const deviation of reconcile.deviations) {
    if (deviation.kind !== "missing") continue;
    add(
      deviation.locator,
      deviation.case_id,
      featureFiles.get(deviation.feature) ?? [],
    );
  }

  // A reviewer's request names the file, which is better evidence than a
  // feature's whole source list.
  for (const applied of plan.applied_reviews ?? []) {
    for (const required of applied.required_identifiers ?? []) {
      add(required.identifier, undefined, [required.file]);
      const need = byLocator.get(required.identifier)!;
      if (required.note && !need.intent.includes(required.note)) {
        need.intent = need.intent
          ? `${need.intent}; reviewer: ${required.note}`
          : `reviewer: ${required.note}`;
      }
    }
  }

  return {
    needs: [...byLocator.values()].sort((a, b) =>
      a.locator.localeCompare(b.locator),
    ),
    noIdentifiersAtAll,
  };
}

export async function runTestA11y(
  ctx: CliContext,
  planId: string,
  options: TestA11yOptions = {},
): Promise<TestA11yResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge test a11y <plan-id>",
    );
  }

  const plan = await loadPlan(projectRoot, planId);
  const proposalPath = planFilePath(projectRoot, planId, "a11yProposal");

  if (options.apply) {
    return applyProposal(ctx, plan, proposalPath);
  }

  if (existsSync(proposalPath) && !options.force) {
    throw new ValidationError(
      `A proposal already exists at ${relative(projectRoot, proposalPath)}. ` +
        "Approve the entries you want and run `--apply`, or pass --force to " +
        "rebuild it against the current source.",
    );
  }

  // The full model: the identifier inventory lives in the per-file appendices,
  // not the core file, and reconciling against an empty inventory would report
  // "nothing to do" for exactly the project that needs this most.
  const { model } = await loadTestModelContext(ctx);
  const { needs, noIdentifiersAtAll } = collectNeeds(plan, model);

  // Read every file any need points at, once.
  const paths = [...new Set(needs.flatMap((n) => n.files))];
  const sources: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const content = await readFile(join(projectRoot, path), "utf8").catch(
      () => undefined,
    );
    if (content !== undefined) sources.push({ path, content });
  }

  const proposal = buildA11yProposal({
    planId,
    planHash: hashPlan(plan),
    needs,
    sources,
    ...(options.maxCandidates ? { maxCandidates: options.maxCandidates } : {}),
  });
  await writeFile(proposalPath, serializeJson(proposal), "utf8");

  const result: TestA11yResult = {
    planId,
    proposalPath,
    mode: "proposal",
    missing: needs.map((n) => n.locator),
    noIdentifiersAtAll,
    suggested: proposal.requests.filter((r) => r.site).map((r) => r.locator),
    unresolved: proposal.requests
      .filter((r) => !r.site)
      .map((r) => ({ locator: r.locator, note: r.note ?? "" })),
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderProposal(logger, result, projectRoot),
  );
  return result;
}

/** Approved entries only, one file at a time, verified after every write. */
async function applyProposal(
  ctx: CliContext,
  plan: TestPlan,
  proposalPath: string,
): Promise<TestA11yResult> {
  const { projectRoot, logger } = ctx;
  if (!existsSync(proposalPath)) {
    throw new NotFoundError(
      `No proposal to apply. Run \`xforge test a11y ${plan.id}\` first, approve ` +
        `the entries you want in ${relative(projectRoot, proposalPath)}, then ` +
        "re-run with --apply.",
      { details: { proposalPath } },
    );
  }
  const proposal: A11yProposal = parseA11yProposal(
    JSON.parse(await readFile(proposalPath, "utf8")),
  );

  const written: Array<{ locator: string; file: string; line: number }> = [];
  const refused: Array<{ locator: string; reason: string }> = [];
  const pending: string[] = [];
  // Edits accumulate per file, so two identifiers in one file both land — and a
  // later refusal never has to un-write an earlier success.
  const edited = new Map<string, string>();

  const approved = proposal.requests.filter((r) => r.approved);
  for (const request of proposal.requests) {
    if (!request.approved) pending.push(request.locator);
  }

  for (const request of approved) {
    const site = request.site;
    if (!site) {
      refused.push({
        locator: request.locator,
        reason:
          "approved but has no `site`. Copy one of the `candidates` into `site` " +
          "(or write the file/anchor yourself) so there is something to apply.",
      });
      continue;
    }
    const current =
      edited.get(site.file) ??
      (await readFile(join(projectRoot, site.file), "utf8").catch(
        () => undefined,
      ));
    if (current === undefined) {
      refused.push({
        locator: request.locator,
        reason: `${site.file} could not be read.`,
      });
      continue;
    }

    const outcome = applyIdentifier({
      path: site.file,
      content: current,
      anchorLine: site.anchor_line,
      anchorText: site.anchor_text,
      indent: site.indent,
      locator: request.locator,
    });
    if (outcome.status === "refused") {
      refused.push({ locator: request.locator, reason: outcome.reason });
      continue;
    }
    if (outcome.status === "already-present") {
      written.push({
        locator: request.locator,
        file: site.file,
        line: outcome.line,
      });
      continue;
    }
    edited.set(site.file, outcome.content);
    written.push({
      locator: request.locator,
      file: site.file,
      line: outcome.line,
    });
  }

  for (const [file, content] of edited) {
    await writeFile(join(projectRoot, file), content, "utf8");
  }

  // The proposal is kept, unlike a review: the unapproved entries are still open
  // work, and the applied ones are now idempotent (`already-present`), so a
  // second `--apply` after approving more is the intended workflow.
  const remaining: IdentifierRequest[] = proposal.requests.filter(
    (r) => !written.some((w) => w.locator === r.locator),
  );
  await writeFile(
    proposalPath,
    serializeJson({ ...proposal, requests: remaining }),
    "utf8",
  );

  const result: TestA11yResult = {
    planId: plan.id,
    proposalPath,
    mode: "apply",
    missing: proposal.requests.map((r) => r.locator),
    suggested: [],
    unresolved: [],
    applied: {
      written,
      refused,
      pending,
      files: [...edited.keys()].sort(),
    },
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderApplied(logger, result, projectRoot),
  );
  return result;
}

function renderProposal(
  logger: Logger,
  result: TestA11yResult,
  projectRoot: string,
): void {
  if (result.missing.length === 0) {
    logger.success("Every locator this plan uses exists in source");
    process.stderr.write(
      "\n  Nothing to propose. An empty proposal was written anyway so a later\n" +
        "  re-plan can be compared against it.\n",
    );
    return;
  }

  logger.warn(
    result.noIdentifiersAtAll
      ? `No accessibility identifier exists anywhere in source, so all ${result.missing.length} locator(s) this plan uses are missing`
      : `${result.missing.length} locator(s) the plan uses do not exist in source`,
  );
  process.stderr.write(
    `\n  Proposal:  ${relative(projectRoot, result.proposalPath)}\n` +
      `  Suggested: ${result.suggested.length} of ${result.missing.length}\n`,
  );
  if (result.suggested.length > 0) {
    process.stderr.write(`    ${result.suggested.join(", ")}\n`);
  }
  if (result.unresolved.length > 0) {
    process.stderr.write(
      `\n  No suggestion for ${result.unresolved.length} — a guess here is worse than a blank:\n`,
    );
    for (const item of result.unresolved) {
      process.stderr.write(`    - ${item.locator}: ${item.note}\n`);
    }
  }
  process.stderr.write(
    "\n  Nothing is applied until you set `approved: true` on an entry. Check that\n" +
      "  each `site` names the element under test and not its container: an\n" +
      "  identifier on a VStack makes a test that taps something, passes, and\n" +
      "  verifies nothing.\n" +
      "\n  Next:\n" +
      `    xforge test a11y ${result.planId} --apply\n` +
      "    xforge docs                 # re-scan, so the model sees the new identifiers\n" +
      `    xforge test plan --level smoke   # re-plan: the deviation clears\n`,
  );
}

function renderApplied(
  logger: Logger,
  result: TestA11yResult,
  projectRoot: string,
): void {
  const a = result.applied!;
  if (a.written.length > 0) {
    logger.success(`Added ${a.written.length} accessibility identifier(s)`);
  } else {
    logger.warn("Nothing was applied");
  }

  process.stderr.write("\n");
  for (const w of a.written) {
    process.stderr.write(`  ✓ ${w.locator}  →  ${w.file}:${w.line}\n`);
  }
  for (const r of a.refused) {
    process.stderr.write(`  ✗ ${r.locator}  —  ${r.reason}\n`);
  }
  if (a.pending.length > 0) {
    process.stderr.write(
      `\n  ${a.pending.length} entr${a.pending.length === 1 ? "y" : "ies"} left unapproved: ${a.pending.join(", ")}\n`,
    );
  }
  if (a.files.length > 0) {
    process.stderr.write(
      `\n  Product source changed in ${a.files.length} file(s). Read it before committing:\n` +
        `    git diff -- ${a.files.map((f) => `'${f}'`).join(" ")}\n` +
        "\n  The identifiers exist now, but the plan still records the deviation —\n" +
        "  it was reconciled before the edit. Re-scan and re-plan to clear it:\n" +
        "    xforge docs\n" +
        "    xforge test plan --level smoke\n",
    );
  } else {
    process.stderr.write(
      `\n  Approve the entries you want in ${relative(projectRoot, result.proposalPath)} and re-run.\n`,
    );
  }
}
