---
description: Generate an XForge Test plan (test cases, risk, testability, shards) for review before approval.
argument-hint: "[feature id, e.g. alarm] [--level smoke|critical|regression|full]"
---

# /xforge:test-plan

Create a QA test plan. The **deterministic plan is built by the CLI** from the
Canonical Project Model; you add semantic QA analysis on top and never invent
requirements (blueprint §6, master prompt §6).

## Steps

1. Build the deterministic plan:

   ```bash
   xforge test plan --json ${ARGUMENTS:+--feature "$ARGUMENTS"}
   ```

2. Read the generated artifacts under `.xforge/test/plans/<plan-id>/`:
   `plan.json`, `test-cases.json`, `testability-report.md`, `permissions.md`.
3. Optionally enrich cases via sub-agents (`test-case-author`, per-feature
   `feature-test-agent`) — refine steps/expected-results, but keep every case's
   requirement links, code references and risk score from the CLI.
4. Keep as-intended (PRD) separate from as-built (source/tests). When evidence
   is missing use `UNKNOWN` / `INFERRED` / `NEEDS_CONFIRMATION`.
5. Summarize scope, counts, risk distribution, testability blockers and the
   exact permissions requested.
6. Tell the user to review, then approve with `/xforge:test-plan` → approve, or
   `xforge test approve <plan-id>`. Do NOT auto-approve.
