---
name: xforge-test
description: Plan, approve and (later) run autonomous iOS QA via the xforge test CLI. Deterministic work is the CLI's; the LLM adds QA analysis and never modifies production behavior.
---

# XForge Test Skill

Use when a user wants to plan or run automated iOS QA.

Prerequisites, in order — each fails loudly if the previous is missing:
`xforge init` → `xforge docs` (builds the Canonical Project Model the plan is
derived from) → `xforge test doctor`.

1. Check readiness: `xforge test doctor --json`.
2. Plan: `xforge test plan --feature <id> --level <level> --json`. This is a
   pipeline: preflight → scaffold `navigation.yaml` → plan → generate XCUITest →
   wire into the Xcode targets → approve. Opt out of any step with `--no-doctor`,
   `--no-navigation`, `--no-generate`, `--no-xcode`, `--no-approve`.
   Review `plan.md`, `test-cases.json`, `testability-report.md` and
   `permissions.md` under `.xforge/test/plans/<plan-id>/`.
3. Report what silently costs coverage: `reconcile.missing` (accessibility
   identifiers absent from source — those cases are blocked),
   `unreachableFeatures` (no confident navigation path, so **zero** cases
   generated), and testability issues. A scaffolded navigation graph starts
   every edge at `derived` (0.6) and should be reviewed before it is trusted.
4. If `unreferencedScreens` is non-empty, the plan is deliberately unapproved:
   a case targets a screen nothing else in the app refers to, so it may be
   testing dead code. Run `/xforge:test-review <plan-id>` — grep for each type,
   find the screen the app really presents, and write `keep`/`drop`/`retarget`/
   `revise` verdicts back with `xforge test review <plan-id> --apply`. Every
   verdict other than `keep` needs a rationale and evidence.
5. If `--no-approve` was used, approve once with explicit user consent:
   `xforge test approve <plan-id>`.
6. Run: `xforge test run <plan-id>` is a **dry run** — it records the exact
   build/test command plan without invoking Xcode. `--execute` runs for real and
   needs a Mac with Xcode plus the generated sources actually added to the
   targets. Autonomous: no mid-run questions after a valid approval.

Rules: reuse the Canonical Project Model; never invent requirements; keep
as-intended vs as-built distinct; test-support modifications only (no
production behavior changes); only XForge-managed simulators; never log secrets.
