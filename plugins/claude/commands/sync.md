---
description: Regenerate documentation only for files that changed since the last generation.
---

# /xforge:sync

Incrementally update documentation.

## Steps

1. Detect drift and regenerate the model:

   ```bash
   xforge docs sync --json
   ```

2. From the JSON result, read `changedBefore` / `addedBefore` / `removedBefore`.
3. Only re-analyze and re-write documents affected by those files. Do not
   re-summarize the whole repository.
4. Preserve manual blocks. Report which documents were updated.
