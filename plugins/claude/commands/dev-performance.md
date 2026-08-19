---
description: Optional performance verification gate — hands off to XForge Test (opt-in).
argument-hint: "<plan-id>"
---

# /xforge:dev-performance

Performance verification is an **opt-in** gate that hands off to XForge Test
(blueprint §20, §22). Never runs during `dev run`.

## Steps

1. ```bash
   xforge dev performance $ARGUMENTS --json
   ```
2. This hands off to `xforge test plan --dev-run <plan-id> --level full`. Run it
   only on explicit request and on a suitable Mac.
3. When results come back, delegate interpretation to the
   `performance-analysis-agent`: it reads the run's metrics artifacts,
   separates measurement noise from regressions, and attributes slowdowns to
   the changed files of this plan with evidence.
