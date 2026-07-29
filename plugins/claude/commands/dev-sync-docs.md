---
description: Sync a run's Staged Spec differences into the canonical docs (explicit, optional).
argument-hint: "<run-id>"
---

# /xforge:dev-sync-docs

Apply the Staged Spec journal to canonical docs. This is the ONLY way docs get
updated — never automatically (blueprint §14, §15).

## Steps

1. Run:

   ```bash
   xforge dev sync-docs $ARGUMENTS --json
   ```

2. The CLI loads the Staged Spec, detects docs drift, applies a safe merge,
   updates the Project Model, and marks the journal `SYNCED`.
3. If drift/conflict is detected, report it as `CONFLICTED` and do not force.

> Phase 1 note: sync lands in Phase 7. The Staged Spec journal is recorded now.
