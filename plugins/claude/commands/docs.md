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

2. Read `.xforge/state/model-digest.json` — a few KB naming every feature, the
   unmet requirements, the gap counts and a `see` map of where each detail
   lives. **Start here, not with the full model.** On a large repository the
   full model is tens of thousands of tokens; the digest tells you which of
   them you actually need.
3. Open further artifacts only for what you are about to write:
   - one feature's detail → `docs/project/features/<id>.md`
   - a feature's file list → `.xforge/state/feature-map.json`
   - everything structural → `.xforge/state/project-model.json`
   - per-file inventories (symbols, accessibility identifiers, source files)
     → `.xforge/state/model/*.json`

   Never read the whole tree "to get context" — that is what the model exists
   to prevent (§15.3).

4. For semantic enrichment, delegate to the sub-agents:
   - `codebase-analyst` — group source files into features, describe
     architecture from metadata only.
   - `product-analyst` — read PRD / Spec Kit / BMAD, normalize requirements,
     assign requirement IDs.
   - `doc-writer` — write feature docs from the model. **Never state a fact
     without a source reference.**
   - `doc-reviewer` — check for unsupported claims, gaps and duplication.
5. Respect the three kinds of truth: keep _as-intended_ (PRD) separate from
   _as-built_ (source/tests) and _project rules_ (constitution).
6. When evidence is missing, use `UNKNOWN`, `INFERRED`, `NEEDS_CONFIRMATION` or
   `PARTIALLY_IMPLEMENTED` — do not guess.
7. Preserve any content inside `<!-- xforge:manual:start -->` fences.
8. Report the files written and any detected gaps.
