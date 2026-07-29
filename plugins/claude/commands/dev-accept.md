---
description: Accept the code from a dev run, independently of docs sync.
argument-hint: "<run-id>"
---

# /xforge:dev-accept

Accept a run's code. Code acceptance is independent from docs sync (blueprint
§4.4, §15): accepting does NOT update canonical docs and preserves the Staged
Spec.

## Steps

1. Run:

   ```bash
   xforge dev accept $ARGUMENTS --json
   ```

2. Confirm the integration branch is recorded as accepted. The Staged Spec
   remains unsynced unless the user later runs `/xforge:dev-sync-docs` — an
   unsynced spec never blocks acceptance (§4.4).
