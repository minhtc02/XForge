---
description: Optional build gate for a dev plan (opt-in; never runs during dev run).
argument-hint: "<plan-id>"
---

# /xforge:dev-build

Build is an **opt-in** gate (blueprint §20, §4.1). It never runs during a normal
`dev run`. Only invoke this when the user explicitly asks to build.

## Steps

1. Preview the exact command (default dry run, records nothing executed):

   ```bash
   xforge dev build $ARGUMENTS --json
   ```

2. Add `--execute` only on explicit request and only on a Mac with Xcode. Report
   the build status honestly; a failure is a build gate result, not a code
   rejection.
