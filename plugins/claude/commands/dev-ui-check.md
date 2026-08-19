---
description: Optional UI verification gate — hands off to XForge Test (opt-in).
argument-hint: "<plan-id>"
---

# /xforge:dev-ui-check

UI verification is an **opt-in** gate that reuses the XForge Test visual engine
rather than duplicating it (blueprint §20, §22). Never runs during `dev run`.

## Steps

1. ```bash
   xforge dev ui-check $ARGUMENTS --json
   ```
2. This hands off to `xforge test plan --dev-run <plan-id>`. Run the resulting
   XForge Test plan only on explicit request and on a UI-testable Mac.
3. Delegate screenshot verdicts to the `visual-analysis-agent`: diffs are
   compared against per-shard baselines, a screenshot with no baseline is
   reported rather than auto-approved, and escalation is one-way
   (PASS→FAIL allowed, FAIL→PASS never).
