---
description: Show the status of an XForge Test run.
argument-hint: "<run-id>"
---

# /xforge:test-status

Report progress of a run.

## Steps

1. Run:

   ```bash
   xforge test status $ARGUMENTS --json
   ```

2. Present per-shard progress and overall pass/fail/blocked counts.
3. Do not restart or modify the run; this is read-only.

> Phase 1 note: lands in Phase 2 with the simulator runner.
