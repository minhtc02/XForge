---
description: Check XForge environment and configuration health.
---

# /xforge:doctor

Run the environment diagnostics.

## Steps

1. Run:

   ```bash
   xforge doctor --json
   ```

2. Parse the `checks` array and present each check (`ok` / `warn` / `fail`) to
   the user, grouped by status.
3. For any `fail`, suggest the concrete fix (e.g. upgrade Node, run
   `xforge init`, install Xcode command line tools).
4. Treat `warn` (optional tooling like SourceKit-LSP) as informational.
