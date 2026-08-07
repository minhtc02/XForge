import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { NotFoundError, ValidationError, type Logger } from "@xforge/shared";
import {
  applyPlanReview,
  evaluateReviewPolicy,
  hashPlan,
  parsePlanReview,
  parseTestPlan,
  planFilePath,
  serializeJson,
  type PlanReview,
  type TestPlan,
} from "@xforge/test-core";
import { readProjectModel, type ScreenReachability } from "@xforge/core";
import { runTestApprove } from "./approve.js";
import { runTestGenerate } from "./generate.js";
import { emitResult, type CliContext } from "../../context.js";

/**
 * `xforge test review <plan-id>` and `--apply`.
 *
 * The deterministic planner reasons from declarations, so it cannot tell a live
 * screen from an abandoned one, or know that a "create item and relaunch"
 * template makes no sense on a screen with nothing to create. Answering that
 * needs someone who can read call sites and judge intent — and since XForge
 * runs inside Claude Code, that someone is present. What was missing was a way
 * for their conclusions to reach the plan instead of a side document nobody
 * executes.
 *
 * Two halves:
 *
 *   `test review <plan-id>`          writes a review template listing every
 *                                    case, each open question, and the
 *                                    reachability facts the model has.
 *   `test review <plan-id> --apply`  validates the filled review and merges it
 *                                    into the plan deterministically.
 *
 * The agent fills the template; the CLI performs the merge. That split is what
 * keeps the write-back safe: evidence is required by the schema, the derived
 * structures stay consistent, and applying a review re-hashes the plan so any
 * prior approval goes stale through the existing mechanism.
 */

export interface TestReviewOptions {
  /** Apply the filled review instead of writing a template. */
  apply?: boolean;
  /** Overwrite an existing review template. */
  force?: boolean;
  /**
   * With `--apply`: regenerate the XCUITest sources and approve the plan, when
   * the review actually answered the questions that withheld approval.
   */
  approve?: boolean;
}

export interface TestReviewResult {
  planId: string;
  reviewPath: string;
  /** `template` when a scaffold was written, `apply` when a review was merged. */
  mode: "template" | "apply";
  planHash: string;
  /** Open questions the template asked about, or the review answered. */
  questions: string[];
  applied?: {
    dropped: string[];
    retargeted: string[];
    revised: string[];
    added: string[];
    unknownCaseIds: string[];
    previousPlanHash: string;
    approvalInvalidated: boolean;
    /** Set when `--approve` ran: whether the plan ended up approved, and why not. */
    approved?: boolean;
    unresolved?: string[];
    regenerated?: number;
  };
}

/** Screens with no inbound reference, scoped to the plan's features. */
function orphansForPlan(
  reachability: ScreenReachability[],
  plan: TestPlan,
): ScreenReachability[] {
  const features = new Set(plan.test_cases.map((c) => c.feature));
  return reachability.filter(
    (r) => r.orphaned && (!r.feature || features.has(r.feature)),
  );
}

/**
 * The questions a reviewer has to answer. Derived from what the deterministic
 * layer knows it cannot decide — never a generic checklist, because a question
 * with no specific fact behind it gets answered with a guess.
 */
function openQuestions(
  plan: TestPlan,
  orphans: ScreenReachability[],
): string[] {
  const questions: string[] = [];

  for (const orphan of orphans) {
    questions.push(
      `Is ${orphan.type} (${orphan.file}) reachable in the shipped app? ` +
        "Nothing outside its own file refers to it. Search for the type name: " +
        "if the only match is its declaration, every case aimed at it tests " +
        "dead code and should be dropped.",
    );
  }

  // Template steps that the planner emits generically and cannot validate.
  for (const testCase of plan.test_cases) {
    const actions = testCase.steps.map((s) => s.action);
    if (actions.includes("create-item")) {
      questions.push(
        `${testCase.id} performs "create-item" on ${testCase.feature}. ` +
          "Does that screen actually have a create action? If not, the case is " +
          "a template artifact and should be dropped, not repaired.",
      );
    }
  }

  for (const issue of plan.testability_issues) {
    if (issue.kind === "screen-not-referenced") {
      continue; // already covered per-orphan above
    }
    if (issue.severity === "critical" || issue.severity === "blocker") {
      questions.push(`${issue.id}: ${issue.description}`);
    }
  }

  return questions;
}

/** A template pre-filled with `keep` for every case, so a reviewer edits deltas. */
function buildTemplate(plan: TestPlan, planHash: string): PlanReview {
  return {
    schema_version: 1,
    plan_id: plan.id,
    reviewed_plan_hash: planHash,
    summary: "",
    cases: plan.test_cases.map((c) => ({
      case_id: c.id,
      verdict: "keep" as const,
      evidence: [],
      confidence: 0.8,
    })),
    added_cases: [],
    // Deliberately empty rather than pre-seeded with the orphans: a finding
    // requires a rationale and evidence, so a stub entry would be an invalid
    // document that fails to apply until every blank is filled. The orphans are
    // in `questions` instead, where they are a task rather than a form.
    navigation_findings: [],
    required_identifiers: [],
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

export async function runTestReview(
  ctx: CliContext,
  planId: string,
  options: TestReviewOptions = {},
): Promise<TestReviewResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge test review <plan-id>",
    );
  }

  const plan = await loadPlan(projectRoot, planId);
  const planHash = hashPlan(plan);
  const reviewPath = planFilePath(projectRoot, planId, "review");

  // Reachability lives in the core model, so no appendix merge is needed.
  const model = await readProjectModel(projectRoot).catch(() => undefined);
  const orphans = model
    ? orphansForPlan(model.screen_reachability ?? [], plan)
    : [];

  if (!options.apply) {
    if (existsSync(reviewPath) && !options.force) {
      throw new ValidationError(
        `A review already exists at ${relative(projectRoot, reviewPath)}. ` +
          "Fill it in and run `--apply`, or pass --force to start over.",
      );
    }
    const questions = openQuestions(plan, orphans);
    await writeFile(
      reviewPath,
      serializeJson(buildTemplate(plan, planHash)),
      "utf8",
    );
    const result: TestReviewResult = {
      planId,
      reviewPath,
      mode: "template",
      planHash,
      questions,
    };
    emitResult(ctx, result as unknown as Record<string, unknown>, () =>
      renderTemplate(logger, result, projectRoot, plan.test_cases.length),
    );
    return result;
  }

  // --- apply ---
  if (!existsSync(reviewPath)) {
    throw new NotFoundError(
      `No review to apply. Run \`xforge test review ${planId}\` first, fill in ` +
        `${relative(projectRoot, reviewPath)}, then re-run with --apply.`,
      { details: { reviewPath } },
    );
  }
  const review = parsePlanReview(
    JSON.parse(await readFile(reviewPath, "utf8")),
  );
  const {
    plan: nextPlan,
    applied,
    unknownCaseIds,
  } = applyPlanReview({
    plan,
    review,
  });

  await writeFile(
    planFilePath(projectRoot, planId, "plan"),
    serializeJson(nextPlan),
    "utf8",
  );
  await writeFile(
    planFilePath(projectRoot, planId, "testCases"),
    serializeJson(nextPlan.test_cases),
    "utf8",
  );

  // The plan changed, so any approval bound to the old hash is void. Delete it
  // rather than leave a manifest that `run` would reject with a confusing
  // "stale" message — the cause here is known and worth stating plainly.
  const approvalPath = planFilePath(projectRoot, planId, "approval");
  const approvalInvalidated = existsSync(approvalPath);
  if (approvalInvalidated) await unlink(approvalPath);

  // The review has been absorbed into the plan; keeping it would invite a
  // second application against a hash it no longer matches.
  await unlink(reviewPath);

  // `--approve`: close the loop, but only if the review earned it. The policy
  // check is against the *pre-review* plan, because that is where the questions
  // were raised; applying the review is what may have answered them.
  let approved: boolean | undefined;
  let unresolved: string[] | undefined;
  let regenerated: number | undefined;
  if (options.approve) {
    const policy = evaluateReviewPolicy(plan, review);
    unresolved = policy.unresolved;
    approved = policy.allowed;
    if (policy.allowed) {
      // The Swift still points at the old anchors; regenerating is not
      // optional after a retarget, and approving without it would bind an
      // approval to a plan whose generated tests do not match it.
      const generated = await runTestGenerate(ctx, planId, {
        force: true,
        silent: true,
      });
      regenerated = generated.cases;
      await runTestApprove(ctx, planId, { silent: true });
    }
  }

  const result: TestReviewResult = {
    planId,
    reviewPath,
    mode: "apply",
    planHash: hashPlan(nextPlan),
    questions: [],
    applied: {
      dropped: applied.dropped,
      retargeted: applied.retargeted,
      revised: applied.revised,
      added: applied.added,
      unknownCaseIds,
      previousPlanHash: applied.previous_plan_hash,
      approvalInvalidated,
      ...(approved !== undefined ? { approved } : {}),
      ...(unresolved !== undefined ? { unresolved } : {}),
      ...(regenerated !== undefined ? { regenerated } : {}),
    },
  };
  emitResult(ctx, result as unknown as Record<string, unknown>, () =>
    renderApplied(logger, result, nextPlan),
  );
  return result;
}

function renderTemplate(
  logger: Logger,
  result: TestReviewResult,
  projectRoot: string,
  caseCount: number,
): void {
  logger.success(`Review template written for ${result.planId}`);
  process.stderr.write(
    `\n  Cases to review: ${caseCount}\n` +
      `  Template:        ${relative(projectRoot, result.reviewPath)}\n`,
  );
  if (result.questions.length > 0) {
    process.stderr.write(
      `\n  ${result.questions.length} open question(s) the planner cannot answer:\n`,
    );
    for (const q of result.questions) {
      process.stderr.write(`    - ${q}\n`);
    }
  } else {
    process.stderr.write(
      "\n  No open questions detected — the plan's targets all look referenced.\n",
    );
  }
  process.stderr.write(
    "\n  Every verdict other than `keep` needs a rationale and at least one\n" +
      "  evidence reference; the schema rejects a change you cannot justify.\n" +
      "\n  Next:\n" +
      `    /xforge:test-review ${result.planId}   # in Claude Code: investigate and fill this in\n` +
      `    xforge test review ${result.planId} --apply\n`,
  );
}

function renderApplied(
  logger: Logger,
  result: TestReviewResult,
  plan: TestPlan,
): void {
  const a = result.applied!;
  logger.success(`Review applied to ${result.planId}`);
  process.stderr.write(
    `\n  Dropped:     ${a.dropped.length}${a.dropped.length ? ` (${a.dropped.join(", ")})` : ""}\n` +
      `  Retargeted:  ${a.retargeted.length}${a.retargeted.length ? ` (${a.retargeted.join(", ")})` : ""}\n` +
      `  Revised:     ${a.revised.length}${a.revised.length ? ` (${a.revised.join(", ")})` : ""}\n` +
      `  Added:       ${a.added.length}${a.added.length ? ` (${a.added.join(", ")})` : ""}\n` +
      `  Cases now:   ${plan.test_cases.length}\n` +
      `  Plan hash:   ${result.planHash.slice(0, 24)}…\n`,
  );
  if (a.unknownCaseIds.length > 0) {
    process.stderr.write(
      `\n  ! Ignored ${a.unknownCaseIds.length} verdict(s) for case ids not in this plan:\n` +
        `    ${a.unknownCaseIds.join(", ")}\n`,
    );
  }
  if (a.approvalInvalidated) {
    process.stderr.write(
      "\n  The previous approval was removed: it was bound to the pre-review plan.\n",
    );
  }

  if (a.approved === true) {
    process.stderr.write(
      `\n  Regenerated ${a.regenerated} case(s) and approved.\n` +
        "  Every question that withheld approval was answered with evidence.\n" +
        "\n  Next:\n" +
        `    xforge test run ${result.planId}              # dry run, no build\n` +
        `    xforge test run ${result.planId} --execute   # run for real\n`,
    );
    return;
  }

  if (a.approved === false) {
    process.stderr.write(
      "\n  NOT approved — the review did not settle every open question:\n",
    );
    for (const item of a.unresolved ?? []) {
      process.stderr.write(`    - ${item}\n`);
    }
    process.stderr.write(
      "\n  A `keep` with no rationale is silence, not an answer: it would turn\n" +
        '  "we do not know if this tests dead code" into "approved". Investigate\n' +
        "  those cases and re-review, or approve deliberately once you are sure:\n" +
        `    xforge test review ${result.planId}\n` +
        `    xforge test approve ${result.planId}\n`,
    );
    return;
  }

  process.stderr.write(
    "\n  Next:\n" +
      `    xforge test generate ${result.planId} --force   # regenerate the Swift\n` +
      `    xforge test approve ${result.planId}\n`,
  );
}
