---
description: Check for documentation drift — exit 1 when the docs no longer match the code.
---

# /xforge:check

Detect drift between the repository and the last generated documentation.
This is the CI gate: run it anywhere a stale docs tree should fail the build.

## Steps

1. Run:

   ```bash
   xforge docs check --json
   ```

2. Exit code `0` — no drift; nothing to do. Exit code `1` — drift: read
   `changed`, `added`, `removed` from the JSON and tell the user which files
   invalidated the documentation.
3. Offer the fix: `/xforge:sync` rewrites only the documents those files
   affect, preserving manual blocks.
