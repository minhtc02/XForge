---
description: Check the XForge Test QA environment (Xcode, simulators, project model, config).
---

# /xforge:test-doctor

Run the QA environment diagnostics. The CLI does all the checks; you only
present the results.

## Steps

1. Run:

   ```bash
   xforge test doctor --json
   ```

2. Parse the `checks` array and present each as ok / warn / fail.
3. For any `fail`, give the concrete fix (run `xforge init`, run `xforge docs`,
   install Xcode command line tools).
4. Treat `warn` (no UI test target, Figma disabled, optional tooling) as
   informational — planning can still proceed.
