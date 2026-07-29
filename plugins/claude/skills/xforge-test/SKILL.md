---
name: xforge-test
description: Plan, approve and (later) run autonomous iOS QA via the xforge test CLI. Deterministic work is the CLI's; the LLM adds QA analysis and never modifies production behavior.
---

# XForge Test Skill

Use when a user wants to plan or run automated iOS QA.

1. Check readiness: `xforge test doctor --json`.
2. Plan: `xforge test plan --feature <id> --level <level> --json`. Review the
   generated `plan.md`, `test-cases.json`, `testability-report.md` and
   `permissions.md` under `.xforge/test/plans/<plan-id>/`.
3. Approve once (explicit user consent): `xforge test approve <plan-id>`.
4. Run (Phase 2+): `xforge test run <plan-id>` — autonomous, no mid-run
   questions after a valid approval.

Rules: reuse the Canonical Project Model; never invent requirements; keep
as-intended vs as-built distinct; test-support modifications only (no
production behavior changes); only XForge-managed simulators; never log secrets.
