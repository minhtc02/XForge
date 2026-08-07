---
description: Initialize XForge in the current repository (detect project type, write config, scaffold state).
argument-hint: "[--force] [--profile ios-swift|generic]"
---

# /xforge:init

You are running the XForge `init` workflow. **Do not reimplement detection or
config logic in the LLM** — the deterministic work belongs to the CLI.

## Steps

1. Confirm the XForge CLI is available: run `xforge --version`. If it is not on
   PATH, tell the user to run `pnpm build && pnpm --filter @xforge/cli link --global`
   (or use `plugins/claude/bin/xforge`).
2. Run the initializer in JSON mode so you get structured output:

   ```bash
   xforge init --json $ARGUMENTS
   ```

3. Parse the JSON result (`detection`, `configPath`, `createdOutputDir`,
   `projectDocsDir`, `projectDocsExisted`).
4. Summarize for the user in their configured language:
   - Detected platform, languages, UI frameworks, dependency manager, tests.
   - Whether Spec Kit / BMAD / PRD candidates were found.
   - **Both documentation directories, and which is which**: `projectDocsDir`
     (`docs/project/` by default) is where the user puts their own PRD and
     specs — it is what `xforge docs` reads as the source of truth — while
     `createdOutputDir` (`docs/xforge/`) is where XForge writes. Say plainly
     that hand edits outside manual blocks in the output tree are lost on the
     next run. When `projectDocsExisted` is true, note that the existing
     directory was adopted untouched.
   - Where the config was written.
5. If `xforge init` reports the project is already initialized, tell the user to
   re-run with `--force` only if they want to overwrite `.xforge/config.yaml`.
   For an older project, `xforge upgrade` is the safer command — it only adds,
   and it flags a config whose output tree still overlaps the input tree.

Do not fabricate detection results. Report exactly what the CLI returned.
