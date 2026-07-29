---
description: Dismiss a run's Staged Spec differences. Code stays accepted; docs stay unchanged.
argument-hint: "<run-id>"
---

# /xforge:dev-dismiss-spec

Drop the recorded spec differences for a run without touching code or docs
(blueprint §15).

## Steps

1. Run:

   ```bash
   xforge dev dismiss-spec $ARGUMENTS --json
   ```

2. The journal is marked `DISMISSED`. Accepted code remains accepted; canonical
   docs remain unchanged.

> Phase 1 note: dismiss lands in Phase 7.
