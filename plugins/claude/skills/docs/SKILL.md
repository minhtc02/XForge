---
name: xforge-docs
description: Generate evidence-backed documentation by combining the xforge CLI's deterministic model with LLM semantic analysis.
---

# XForge Docs Skill

Use when a user wants to generate or refresh project documentation.

XForge reads `docs/project/` (the user's own PRD and specs — the default source
of truth) and writes `docs/xforge/`. Keep the two straight: generated prose is
never evidence of intent.

1. Run `xforge docs --json --yes` to build the deterministic Canonical Project
   Model. Add `--from-code` when the user wants the documentation to describe
   what the code actually does rather than what was specified; `--from-docs` is
   the default. Check `source` and `projectDocCount` in the result — a
   `project-docs` run with no documents found described the code regardless.
2. Read `.xforge/state/model-digest.json` first, then
   `.xforge/state/project-model.json` only for what the digest points you at.
3. Delegate semantic work to codebase-analyst, product-analyst, doc-writer and
   doc-reviewer agents.
4. Keep as-intended, as-built and project-rules distinct.
5. Every implementation claim needs a source reference; use UNKNOWN /
   INFERRED / NEEDS_CONFIRMATION when evidence is missing.
6. Preserve manual blocks and never emit secrets.
