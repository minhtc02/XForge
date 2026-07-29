---
description: Check the XForge Dev environment (git worktree support, project model, docs, config).
---

# /xforge:dev-doctor

Run the development environment diagnostics. The CLI does all checks; present
the results.

## Steps

1. Run:

   ```bash
   xforge dev doctor --json
   ```

2. Present each check as ok / warn / fail.
3. For any `fail`, give the fix (run `xforge init`, run `xforge docs`, ensure a
   git repository with worktree support).
4. A dirty main checkout is only a warning — XForge Dev never writes to main.
