---
description: Remove XForge-managed run artifacts and cache.
argument-hint: "[runs | cache]"
---

# /xforge:test-clean

Delete run artifacts. This is destructive — confirm before running against
`runs`, which removes QA run history (summaries, screenshots, xcresults) that
cannot be recreated without re-running the plan.

## Steps

1. Confirm intent with the user: `runs` (QA run history under
   `.xforge/test/runs/`), `cache`, or both (the default).
2. Run:

   ```bash
   xforge test clean ${ARGUMENTS:-} --json
   ```

3. Report what was removed. Approved visual baselines live in
   `.xforge/test/baselines/`, outside both targets of this command — cleaning
   never deletes them.
