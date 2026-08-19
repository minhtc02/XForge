---
description: Approve a test plan (one-time, immutable manifest bound to the plan hash).
argument-hint: "<plan-id>"
---

# /xforge:test-approve

Approve a plan so `test run` will execute it. `xforge test plan` approves by
default, so this is mostly for re-approval after a deliberate change — and for
verification.

## Steps

1. Check current status first:

   ```bash
   xforge test approve $ARGUMENTS --verify --json
   ```

2. Read the verdict. An approval is bound to the plan hash and goes **stale
   by design** when the plan or its model inputs change — that is correct
   behaviour, not a bug. A stale approval means the plan the user approved is
   not the plan that would run; the fix is to review the new plan, not to
   rubber-stamp it.
3. Approve only when the user has seen the plan (cases, devices, permissions):

   ```bash
   xforge test approve $ARGUMENTS --json
   ```

4. Report the approval manifest (plan id, hash, case count). Remind that it
   is one-time and immutable: any later plan change requires a fresh approval.
