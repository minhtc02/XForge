---
name: xforge-init
description: Initialize XForge in a repository by invoking the xforge CLI and summarizing detection results.
---

# XForge Init Skill

Use when a user wants to set up XForge in a repository.

1. Ensure `xforge` CLI is available (`xforge --version`).
2. Run `xforge init --json` and parse the structured output.
3. Summarize detected platform, languages, UI, tests, Spec Kit / BMAD / PRD.
4. Never duplicate the CLI's detection logic in the model.
