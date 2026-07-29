---
description: Remove XForge-managed dev runs or worktrees (never the main checkout).
argument-hint: "[runs|worktrees]"
---

# /xforge:dev-clean

Clean up XForge-managed artifacts only. This never touches the main checkout or
any file outside `.xforge/`.

## Steps

1. ```bash
   xforge dev clean $ARGUMENTS --json
   ```

   `runs` removes delivery packages under `.xforge/dev/runs/`; `worktrees`
   removes the isolated worktrees under `.xforge/worktrees/`. Confirm with the
   user before removing worktrees that still hold unmerged work.
