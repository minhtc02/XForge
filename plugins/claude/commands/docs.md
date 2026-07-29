---
description: Generate evidence-backed project documentation from source, tests, PRD, Spec Kit and BMAD.
argument-hint: "[focus areas, e.g. Alarm, Notifications]"
---

# /xforge:docs

Compile the project's documentation. The **deterministic model is built by the
CLI**; you (the LLM) only add semantic analysis and prose, and only where you
have evidence.

## Steps

1. Build/refresh the Canonical Project Model deterministically:

   ```bash
   xforge docs --json ${ARGUMENTS:+--focus "$ARGUMENTS"}
   ```

2. Read the structured result and the persisted model at
   `.xforge/state/project-model.json`.
3. For semantic enrichment, delegate to the sub-agents:
   - `codebase-analyst` — group source files into features, describe
     architecture from metadata only.
   - `product-analyst` — read PRD / Spec Kit / BMAD, normalize requirements,
     assign requirement IDs.
   - `doc-writer` — write feature docs from the model. **Never state a fact
     without a source reference.**
   - `doc-reviewer` — check for unsupported claims, gaps and duplication.
4. Respect the three kinds of truth: keep _as-intended_ (PRD) separate from
   _as-built_ (source/tests) and _project rules_ (constitution).
5. When evidence is missing, use `UNKNOWN`, `INFERRED`, `NEEDS_CONFIRMATION` or
   `PARTIALLY_IMPLEMENTED` — do not guess.
6. Preserve any content inside `<!-- xforge:manual:start -->` fences.
7. Report the files written and any detected gaps.
