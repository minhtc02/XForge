---
name: xforge-docs
description: Generate evidence-backed documentation by combining the xforge CLI's deterministic model with LLM semantic analysis.
---

# XForge Docs Skill

Use when a user wants to generate or refresh project documentation.

1. Run `xforge docs --json` to build the deterministic Canonical Project Model.
2. Read `.xforge/state/project-model.json`.
3. Delegate semantic work to codebase-analyst, product-analyst, doc-writer and
   doc-reviewer agents.
4. Keep as-intended, as-built and project-rules distinct.
5. Every implementation claim needs a source reference; use UNKNOWN /
   INFERRED / NEEDS_CONFIRMATION when evidence is missing.
6. Preserve manual blocks and never emit secrets.
