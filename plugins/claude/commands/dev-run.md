---
description: Run an approved dev plan in isolated worktrees (implement-only by default). Dry-run preview or --execute.
argument-hint: "<plan-id>"
---

# /xforge:dev-run

Execute a development plan. Default behavior is **implement code only** —
never build, run tests, launch Simulator, run UI/performance verification, or
sync docs unless explicitly requested (blueprint §4.1, master prompt).

## Steps

1. Preview first (creates nothing, modifies no source):

   ```bash
   xforge dev run $ARGUMENTS --dry-run --json
   ```

   This shows the branches/worktrees, allowed files, default actions, and the
   optional actions that are NOT requested.

2. For a real run, execute:

   ```bash
   xforge dev run $ARGUMENTS --execute --json
   ```

   The CLI creates isolated worktrees under `.xforge/worktrees/`, schedules
   dependency-aware groups, runs a deterministic static review (scope + secret +
   forbidden-path checks), merges feature branches into the integration branch,
   and writes a delivery package under `.xforge/dev/runs/<run-id>/`. The main
   checkout stays read-only; nothing merges to main or force-pushes.

3. Implement the actual Swift/Figma code inside the created worktrees using the
   scoped dev agents (`senior-ios-engineer`, `senior-ui-engineer`,
   `persistence-engineer`, `integration-engineer`), staying strictly inside each
   group's file scope. Then re-run the static review with `xforge dev review`.
4. Report `development: CODE_COMPLETED` with
   `build/test/ui/performance: NOT_REQUESTED` — that is a valid success state.
   Offer opt-in gates (`/xforge:dev-build`, `-test`, `-ui-check`,
   `-performance`) and doc sync (`/xforge:dev-sync-docs`) as separate steps.
