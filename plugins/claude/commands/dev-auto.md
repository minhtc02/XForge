---
description: Plan and run a feature with no mid-run questions — only if the auto policy is satisfied.
argument-hint: "[feature id] [and any override request]"
---

# /xforge:dev-auto

Bounded-autonomy mode (blueprint §5.3, §17). Auto plans then runs without
stopping to ask — but only when the plan stays inside the pre-approved envelope:
implement-only, worktree-isolated, nothing denied, no re-approval needed.

## Steps

1. Run auto (dry-run preview by default):

   ```bash
   xforge dev auto --feature <id> ${ARGUMENTS:+--request "$ARGUMENTS"} --json
   ```

2. If the CLI reports `auto: false`, it **refused** and fell back to plan-first
   because the plan is outside the envelope. Read the `violations` and explain
   them; the plan is still written for explicit review.
3. If the policy is satisfied, the CLI proceeds to a dry-run run. Add
   `--execute` only when the user explicitly wants worktrees created.
4. Optional verification (build/test/UI/performance) is NEVER triggered by auto.
