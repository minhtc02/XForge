---
description: Print a dev run's delivery summary (latest by default).
argument-hint: "[run-id]"
---

# /xforge:dev-report

Print the delivery-package summary for a dev run.

## Steps

1. ```bash
   xforge dev report $ARGUMENTS
   ```
2. The summary distinguishes development (CODE_COMPLETED) from the opt-in gates
   and from spec-difference synchronization. Relay it faithfully — do not claim
   tests ran or docs synced unless the summary says so.
