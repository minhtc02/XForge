---
description: Print a plan's Staged Spec journal (a change log, not a code gate).
argument-hint: "<plan-id>"
---

# /xforge:dev-inspect-spec

Show the Staged Spec journal for a plan — the recorded differences between
canonical docs and the effective behavior of the run (blueprint §14).

## Steps

1. ```bash
   xforge dev inspect-spec $ARGUMENTS --json
   ```
2. This is a **change journal, not a code gate**. Code can be accepted while
   differences remain unsynced. Offer `xforge dev sync-docs <plan-id>` to apply
   the proposed doc patches, or `xforge dev dismiss-spec <plan-id>` to drop them.
