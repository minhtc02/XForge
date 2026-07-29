---
name: xforge-sync
description: Incrementally update documentation for changed files via the xforge CLI.
---

# XForge Sync Skill

Use when a user wants to update docs after code changes.

1. Run `xforge docs sync --json`.
2. Read the changed / added / removed file lists.
3. Only re-analyze documents affected by those files.
4. Preserve manual blocks; report which documents changed.
