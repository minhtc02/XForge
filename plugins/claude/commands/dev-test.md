---
description: Optional test gate for a dev plan (opt-in; never runs during dev run).
argument-hint: "<plan-id>"
---

# /xforge:dev-test

Running tests is an **opt-in** gate (blueprint §20, §4.1). XForge Dev adds/updates
test _source_ by default but never executes tests unless explicitly requested.

## Steps

1. ```bash
   xforge dev test $ARGUMENTS --json
   ```
2. Add `--execute` only on explicit request (Mac + Xcode). For full QA, prefer
   handing off to XForge Test via `xforge test plan --dev-run <plan-id>`.
