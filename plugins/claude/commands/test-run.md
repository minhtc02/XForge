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

   `xforge test plan` approves by default, so a plan usually arrives here
   already approved. An approval is bound to the plan hash and goes **stale by
   design** when the model or plan inputs change — that is correct behaviour,
   not a bug. If it is stale or was never approved, stop and tell the user to
   re-plan (or re-approve); do not approve on their behalf and proceed.

2. Run:

   ```bash
   xforge test run $ARGUMENTS --json
   ```

   By default this is a **dry run** — it records the exact build-once +
   test-without-building command plan and writes run artifacts, without invoking
   Xcode. Pass `--execute` only on a Mac with Xcode and a UI-testable app whose
   targets actually contain the generated sources. If `test plan` reported
   `xcodeIntegration.method: none`, `--execute` will build an app that has no
   XForge tests in it — check that first rather than diagnosing the empty result
   afterwards.

3. The orchestrator builds once, then runs one shard per feature, continues on
   individual case failure, and retries infrastructure failures per config. Do
   not modify production behavior. Only XForge-managed simulators may be
   created/erased. Delegate the phases to the specialist agents rather than
   doing everything in one pass:

   - `qa-lead` — owns the run: shard order, retry judgement, and the final
     pass/fail/blocked accounting.
   - `environment-agent` — simulator boot, privacy grants and other
     environment failures. Note `simctl privacy` cannot grant camera or
     notifications; a case needing those is blocked, not failed.
   - `visual-analysis-agent` — screenshot diffs against the per-shard
     baselines. A screenshot with no baseline is reported, never auto-approved;
     visual escalation is one-way (PASS→FAIL allowed, FAIL→PASS never).

4. When complete, summarize pass/fail/blocked counts (from `xforge test status`
   / `report` / `bugs`) and point to the run artifacts under
   `.xforge/test/runs/<run-id>/`. Hand failures to `/xforge:test-bugs` for
   dedup + triage. Report infrastructure/environment failures separately from
   product failures; present suspected root causes as hypotheses.
