---
description: Reject a dev run's code.
argument-hint: "<run-id>"
---

# /xforge:dev-reject

Mark a run's code as rejected. Docs are never touched; worktrees are kept for
inspection unless the user runs `xforge dev clean worktrees`.

## Steps

1. ```bash
   xforge dev reject $ARGUMENTS --json
   ```
2. Explain what to fix, then re-plan or re-run as needed.
