---
description: Generate XCUITest sources for an approved-or-not plan (writes Swift, never builds).
argument-hint: "<plan-id>"
---

# /xforge:test-generate

Turn a plan into XCUITest sources. `xforge test plan` already runs this step
by default — use the standalone command to regenerate after a plan edit or
when planning ran with `--no-generate`.

## Steps

1. Generate:

   ```bash
   xforge test generate $ARGUMENTS --json
   ```

   Sources land in `.xforge/test/generated-tests/` and are wired into the UI
   test target. Nothing is built here — building happens at `test run`.

2. Pass `--probe` to also emit the accessibility-tree probe class (the run
   attaches the live element tree as an XCTest attachment — there is no
   `simctl ui dump`).
3. Pass `--force` only to overwrite existing generated sources; confirm with
   the user first, since hand edits to generated files are lost.
4. After regeneration, the plan hash is unchanged only if the plan is —
   report whether `/xforge:test-approve` needs re-running.
