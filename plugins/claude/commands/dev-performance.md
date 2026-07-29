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
