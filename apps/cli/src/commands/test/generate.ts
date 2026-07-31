import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { NotFoundError, ValidationError } from "@xforge/shared";
import {
  generateProbeFile,
  generateTestSupportFile,
  generateXcuiTestFile,
  generatedFilePath,
  generatedTestsDir,
  loadTestConfig,
  parseTestPlan,
  planFilePath,
  type TestCase,
  type TestPlan,
} from "@xforge/test-core";
import { emitResult, type CliContext } from "../../context.js";

export interface TestGenerateOptions {
  /** Also emit the accessibility-tree probe class (Phase 4). */
  probe?: boolean;
  /** Overwrite existing generated sources. */
  force?: boolean;
}

export interface TestGenerateResult {
  planId: string;
  outputDir: string;
  writtenFiles: string[];
  cases: number;
  blockedCases: number;
  assertions: number;
  unverifiedExpectations: number;
  strict: boolean;
}

/**
 * `xforge test generate <plan-id>` (blueprint §14, master prompt §3).
 *
 * Renders an approved-shape plan into compilable XCUITest Swift under
 * `.xforge/test/generated-tests/<plan-id>/`. XForge never edits the app's Xcode
 * project: it writes the sources and tells the user how to add them to a UI test
 * target, so nothing about the production build changes without consent (§19).
 *
 * Cases marked `automation.blocked` are skipped rather than emitted — a blocked
 * case has an unresolved testability issue and generating it would produce a
 * test that can only fail by timeout.
 */
export async function runTestGenerate(
  ctx: CliContext,
  planId: string,
  options: TestGenerateOptions = {},
): Promise<TestGenerateResult> {
  const { projectRoot, logger } = ctx;
  if (!planId) {
    throw new ValidationError(
      "A plan id is required: xforge test generate <plan-id>",
    );
  }

  const planPath = planFilePath(projectRoot, planId, "plan");
  if (!existsSync(planPath)) {
    throw new NotFoundError(`Plan ${planId} not found`, {
      details: { planPath },
    });
  }
  const plan: TestPlan = parseTestPlan(
    JSON.parse(await readFile(planPath, "utf8")),
  );
  const config = await loadTestConfig(projectRoot);

  const automatable = plan.test_cases.filter((c) => !c.automation.blocked);
  const blocked = plan.test_cases.length - automatable.length;
  if (automatable.length === 0) {
    throw new ValidationError(
      `Every case in ${planId} is blocked by a testability issue; nothing to generate. ` +
        `See ${planFilePath(projectRoot, planId, "testabilityReport")}.`,
    );
  }

  const outDir = generatedTestsDir(projectRoot, planId);
  const uiTestsPath = generatedFilePath(projectRoot, planId, "uiTests");
  if (existsSync(uiTestsPath) && !options.force) {
    throw new ValidationError(
      `Generated sources already exist for ${planId}. Re-run with --force to overwrite.`,
      { details: { path: uiTestsPath } },
    );
  }

  const strict = config.execution.strict_expectations;
  const writtenFiles: string[] = [];
  const write = async (
    file: Parameters<typeof generatedFilePath>[2],
    content: string,
  ): Promise<void> => {
    const abs = generatedFilePath(projectRoot, planId, file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    writtenFiles.push(abs);
  };

  await write(
    "uiTests",
    generateXcuiTestFile(automatable, {
      className: "XForgeUITests",
      module: config.project.scheme,
      unverifiedExpectations: strict ? "fail" : "skip",
      permissionAlerts: permissionAlertsFor(plan),
    }),
  );
  await write("testSupport", generateTestSupportFile());
  if (options.probe) {
    await write("probe", generateProbeFile(automatable));
  }
  await write(
    "readme",
    renderIntegrationReadme(plan, config.project.ui_test_target, options.probe),
  );

  const assertions = automatable.reduce((n, c) => n + c.assertions.length, 0);
  const unverified = countUnverified(automatable);

  const result: TestGenerateResult = {
    planId,
    outputDir: outDir,
    writtenFiles,
    cases: automatable.length,
    blockedCases: blocked,
    assertions,
    unverifiedExpectations: unverified,
    strict,
  };

  emitResult(ctx, result as unknown as Record<string, unknown>, () => {
    logger.success(`Generated XCUITest sources for ${planId}`);
    process.stderr.write(
      `\n  Cases generated:  ${result.cases}` +
        `${blocked > 0 ? ` (${blocked} blocked, skipped)` : ""}\n` +
        `  Assertions:       ${result.assertions}\n` +
        `  Unverified:       ${result.unverifiedExpectations}` +
        ` (rendered as ${strict ? "XCTFail" : "XCTSkip"})\n` +
        `\n  Output: ${relative(projectRoot, outDir)}/\n` +
        `\n  Next: follow ${relative(projectRoot, generatedFilePath(projectRoot, planId, "readme"))}\n` +
        `  to add these files to your UI test target, then:\n` +
        `    xforge test approve ${planId} && xforge test run ${planId} --execute\n`,
    );
  });
  return result;
}

/** Expectations with no matching assertion — reported, never silently dropped. */
function countUnverified(cases: TestCase[]): number {
  let n = 0;
  for (const c of cases) {
    const asserted = new Set(
      c.assertions
        .map((a) => a.source_text)
        .filter((t): t is string => Boolean(t)),
    );
    n += c.expected_results.filter((e) => !asserted.has(e)).length;
  }
  return n;
}

/**
 * Permissions the simulator cannot pre-grant need an in-test alert handler.
 * The plan already recorded them as testability issues at plan time.
 */
function permissionAlertsFor(plan: TestPlan): string[] {
  return plan.testability_issues
    .filter((i) => i.kind === "permission-not-simctl-grantable")
    .map((i) => {
      const match = /"([^"]+)"/.exec(i.description);
      return match?.[1] ?? "";
    })
    .filter((s) => s.length > 0);
}

function renderIntegrationReadme(
  plan: TestPlan,
  uiTestTarget: string,
  probe?: boolean,
): string {
  const target =
    uiTestTarget && uiTestTarget !== "auto" ? uiTestTarget : "<YourUITests>";
  return [
    `# Generated XCUITest sources — ${plan.id}`,
    "",
    "XForge writes these files but never edits your Xcode project. Add them to",
    "your UI test target yourself, so no production build setting changes",
    "without your consent.",
    "",
    "## Files",
    "",
    `- \`XForgeUITests.swift\` — ${plan.test_cases.length} case(s) from this plan.`,
    "  Add to the **UI test target**.",
    "- `XForgeTestSupport.swift` — DEBUG-only hooks, enabled by the",
    "  `--xforge-test` launch argument. Add to the **app target**.",
    ...(probe
      ? [
          "- `XForgeProbeTests.swift` — accessibility-tree probe. Add to the UI",
          "  test target; run it alone with `-only-testing:` before the matrix.",
        ]
      : []),
    "",
    "## Adding them",
    "",
    "```bash",
    '# Xcode: File → Add Files to "<YourProject>"…',
    "#   XForgeUITests.swift   → target: " + target,
    "#   XForgeTestSupport.swift → target: <YourAppTarget>",
    "```",
    "",
    "Then call `XForgeTestSupport.configure()` once at app start:",
    "",
    "```swift",
    "@main",
    "struct YourApp: App {",
    "    init() {",
    "        #if DEBUG",
    "        XForgeTestSupport.configure()",
    "        #endif",
    "    }",
    "}",
    "```",
    "",
    "## Then",
    "",
    "```bash",
    `xforge test approve ${plan.id}`,
    `xforge test run ${plan.id} --execute`,
    "```",
    "",
    "## Regenerating",
    "",
    "These files are generated. Do not edit them by hand — re-run",
    `\`xforge test generate ${plan.id} --force\` after re-planning.`,
    "",
  ].join("\n");
}
