---
description: Generate evidence-backed project documentation from the project's own docs (default) or from source code.
argument-hint: "[focus areas, e.g. Alarm, Notifications]"
---

# /xforge:docs

Compile the project's documentation. The **deterministic model is built by the
CLI**; you (the LLM) only add semantic analysis and prose, and only where you
have evidence.

## Two trees, and which is which

- `docs/project/` — the **project's** documentation. XForge only ever reads it.
  This is the default source of truth: a PRD statement here becomes a
  requirement the implementation is measured against.
- `.xforge/docs/` — where XForge **writes**. Everything XForge generates lives
  under `.xforge/`; everything outside a manual block here is regenerated.
  Never treat this tree as intent; doing so would make a run agree
  with itself.

## Steps

1. Build/refresh the Canonical Project Model deterministically. `--yes` accepts
   the configured source instead of prompting, which is what you want from an
   agent — decide the source explicitly rather than depending on a default:

   ```bash
   xforge docs --json --yes ${ARGUMENTS:+--focus "$ARGUMENTS"}
   ```

   Pass `--from-code` instead when the user asked to document what the code
   actually does — a codebase whose docs have drifted, or one with no docs yet.
   Pass `--from-docs` to be explicit about the default. The two are mutually
   exclusive. Check `source` and `projectDocCount` in the JSON result: a
   `project-docs` run that found zero documents produced a description of the
   code, whatever it was asked for, and you should say so.

2. Read `.xforge/state/model-digest.json` — a few KB naming every feature, the
   unmet requirements, the gap counts and a `see` map of where each detail
   lives. **Start here, not with the full model.** On a large repository the
   full model is tens of thousands of tokens; the digest tells you which of
   them you actually need.
3. Open further artifacts only for what you are about to write:
   - one feature's detail → `.xforge/docs/features/<id>.md`
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
8. The four semantic sections of each feature doc (user flows, business
   rules, error handling, edge cases) still read "Not detected" after a
   deterministic run — they need analysis, which is a separate loop: run
   `/xforge:docs-semantic` to template, fill and apply them with evidence.
9. Report the files written, which source the run led with, and any detected
   gaps.
