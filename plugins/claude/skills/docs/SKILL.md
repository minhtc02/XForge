---
name: xforge-docs
description: Generate evidence-backed documentation by combining the xforge CLI's deterministic model with LLM semantic analysis.
---

# XForge Docs Skill

Use when a user wants to generate or refresh project documentation.

XForge reads `docs/project/` (the user's own PRD and specs — the default source
of truth) and writes `.xforge/docs/`. Keep the two straight: generated prose is
never evidence of intent.

1. Run `xforge docs --json --yes` to build the deterministic Canonical Project
   Model from the project's documents. `--from-code` builds from source
   instead, but only on the user's explicit request — a code-first tree
   answers "what was built", not "what was meant". An explicit choice is
   persisted in config. If the run refuses with "No project documents found",
   ask the user before retrying with `--from-code`; never fall back silently.
2. Read `.xforge/state/model-digest.json` first, then
   `.xforge/state/project-model.json` only for what the digest points you at.
3. Delegate semantic work to codebase-analyst, product-analyst, doc-writer and
   doc-reviewer agents.
4. The four per-feature sections the deterministic layer cannot write (user
   flows, business rules, error handling, edge cases) have their own loop:
   `xforge docs semantic` templates them, you fill them with evidence-backed
   analysis, `xforge docs semantic --apply` validates and merges.
5. Keep as-intended, as-built and project-rules distinct.
6. Every implementation claim needs a source reference; use UNKNOWN /
   INFERRED / NEEDS_CONFIRMATION when evidence is missing.
7. Preserve manual blocks and never emit secrets.
