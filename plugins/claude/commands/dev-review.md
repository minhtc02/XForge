---
description: Print a dev run's static code review (latest by default).
argument-hint: "[run-id]"
---

# /xforge:dev-review

Show the deterministic static review for a run (scope violations, secret
leakage, forbidden-path edits), then add senior review on top.

## Steps

1. ```bash
   xforge dev review $ARGUMENTS --json
   ```
2. Any `blocker` finding (out-of-scope write, sensitive path, leaked secret)
   must be resolved before acceptance — these are the mechanical safety net.
3. Use the `static-code-reviewer` and `architecture-analyst` agents to add
   semantic/architecture review the CLI cannot do. Report findings by severity.
