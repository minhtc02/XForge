---
description: Run an approved XForge Test plan autonomously (no mid-run questions).
argument-hint: "<plan-id>"
---

# /xforge:test-run

Execute an approved plan. This is an **autonomous, non-interactive** command
(blueprint §4.1, §19.3, master prompt §10): after a valid approval, do NOT ask
the user anything, open prompts, wait on stdin, start OAuth, or run commands
that need confirmation. Everything requiring a decision must already be in the
approved plan.

## Steps

1. Verify the plan is validly approved (hash + scope) before doing anything:

   ```bash
   xforge test approve $ARGUMENTS --verify --json
   ```

   If it is not approved or is stale, stop and tell the user to re-plan/approve.
   Do not proceed.

2. Run:

   ```bash
   xforge test run $ARGUMENTS --json
   ```

   By default this is a **dry run** — it records the exact build-once +
   test-without-building command plan and writes run artifacts, without invoking
   Xcode. Pass `--execute` only on a Mac with Xcode and a UI-testable app.

3. The orchestrator builds once, then runs one shard per feature, continues on
   individual case failure, and retries infrastructure failures per config. Do
   not modify production behavior. Only XForge-managed simulators may be
   created/erased.
4. When complete, summarize pass/fail/blocked counts (from `xforge test status`
   / `report` / `bugs`) and point to the run artifacts under `qa-runs/<run-id>/`.
   Report infrastructure/environment failures separately from product failures;
   present suspected root causes as hypotheses.
