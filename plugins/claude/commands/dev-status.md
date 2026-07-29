---
description: Show a dev run's status (latest by default).
argument-hint: "[run-id]"
---

# /xforge:dev-status

Report the status of a dev run.

## Steps

1. ```bash
   xforge dev status $ARGUMENTS --json
   ```
2. Summarize: development status, files changed, integration branch, and the
   optional gate statuses (build/test/ui/performance — normally NOT_REQUESTED)
   plus docs sync. A CODE_COMPLETED run with NOT_REQUESTED gates is a valid
   success state; do not present it as incomplete.
