---
description: Plan, generate and wire up XForge Test QA in one pipeline, then report what needs review before running.
argument-hint: "[feature id, e.g. alarm] [--level smoke|critical|regression|full]"
---

# /xforge:test-plan

Create a QA test plan. The **deterministic plan is built by the CLI** from the
Canonical Project Model; you add semantic QA analysis on top and never invent
requirements (blueprint §6, master prompt §6).

`xforge test plan` is a pipeline, not a single step. One invocation runs the
environment preflight, scaffolds `navigation.yaml` if the project has none,
builds the plan, generates XCUITest sources, copies them into the Xcode targets,
and **approves the plan**. Each step has a `--no-*` flag to turn it off.

## Steps

1. Build the plan. Add `--level` when the user asked for a depth; `smoke` is the
   right first run on a project that has never been tested:

   ```bash
   xforge test plan --json ${ARGUMENTS:+--feature "$ARGUMENTS"}
   ```

   Use `--no-approve` when the user wants to inspect the cases before anything
   is approvable, and `--no-xcode` when they do not want their `project.pbxproj`
   touched. If the CLI reports a preflight failure, stop and fix that first —
   it means the model or config is missing, not that the plan is bad.

2. Read the generated artifacts under `.xforge/test/plans/<plan-id>/`:
   `plan.json`, `test-cases.json`, `testability-report.md`, `permissions.md`.
3. Optionally enrich cases via sub-agents (`test-case-author`, per-feature
   `feature-test-agent`) — refine steps/expected-results, but keep every case's
   requirement links, code references and risk score from the CLI.
4. Keep as-intended (PRD) separate from as-built (source/tests). When evidence
   is missing use `UNKNOWN` / `INFERRED` / `NEEDS_CONFIRMATION`.
5. Summarize scope, counts, risk distribution and the exact permissions
   requested. Three things matter more than the case count and should be called
   out explicitly, because each one silently costs coverage:
   - **`reconcile.missing`** — locators whose accessibility identifier is
     nowhere in source. Those cases are blocked; the app needs the identifier
     before the test can work.
   - **`unreachableFeatures`** — features no confident navigation path reaches.
     They produce **zero cases** rather than a guessed path. The scaffolded
     graph starts every edge at `derived` (0.6 confidence), so a fresh project
     usually needs the graph reviewed and confirmed edges raised to `explicit`.
   - **`testability_issues`** — permissions the simulator cannot pre-grant
     (camera and notifications genuinely cannot be granted by `simctl`), which
     will pop a system alert mid-run unless handled.
6. Report whether the run approved the plan (`approved`, `planHash`) and what
   remains before `xforge test run <plan-id> --execute` can work:
   - **`unreferencedScreens` is non-empty → the plan was deliberately left
     unapproved.** A case navigates to a screen nothing else in the app refers
     to, so it may be testing dead code. Do not approve it manually to move on;
     run `/xforge:test-review <plan-id>`, which investigates the source and
     writes the verdicts back into the plan.
   - When `xcodeIntegration.method` is `none`, the sources were **not** wired
     in — the user must add `XForgeUITests.swift` to the UI test target and
     `XForgeTestSupport.swift` to the app target, then call
     `XForgeTestSupport.configure()` at app start. The generated `README.md`
     next to the sources has the exact instructions.
   - Suggest a dry run (`xforge test run <plan-id>`, no `--execute`) first — it
     records the exact build/test commands without invoking Xcode.

Never approve a plan the CLI left unapproved by re-running `xforge test approve`
on the user's behalf without being asked. Approval is consent, and the pipeline
already handled it when the user did not opt out.
