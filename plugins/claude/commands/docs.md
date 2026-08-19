---
description: Generate evidence-backed project documentation from the project's own docs (default; code only on explicit request).
argument-hint: "[focus areas, e.g. Alarm, Notifications]"
---

# /xforge:docs

Compile the project's documentation. The **deterministic model is built by the
CLI** from the project's own documents by default; your job is to transform
those raw documents — PRD, specs, design notes — into XForge's evidence-backed
documentation architecture: normalized requirements, feature structure,
traceability. You add semantic analysis and prose, only where you have
evidence.

**The source is the project's documents. Documenting the code is a different
product** — it answers "what was built", not "what was meant" — and the CLI
only does it behind the explicit `--from-code` flag. Never pass that flag on
your own initiative; if the user wants it, they will say so.

## Two trees, and which is which

- `docs/project/` — the **project's** documentation. XForge only ever reads it.
  This is the source of truth: a PRD statement here becomes a
  requirement the implementation is measured against.
- `.xforge/docs/` — where XForge **writes**. Everything XForge generates lives
  under `.xforge/`; everything outside a manual block here is regenerated.
  Never treat this tree as intent; doing so would make a run agree
  with itself.

## Steps

1. Build/refresh the Canonical Project Model deterministically:

   ```bash
   xforge docs --json --yes ${ARGUMENTS:+--focus "$ARGUMENTS"}
   ```

   Pass `--from-code` **only when the user explicitly asked** to document
   what the code actually does (a drifted codebase, or a deliberate
   code-first choice). Pass `--from-docs` to be explicit about the default.
   The two are mutually exclusive, and an explicit choice is recorded in
   `.xforge/config.yaml` so later runs and `docs sync` follow it.

   If the run **fails with "No project documents found"**, the project has
   nothing under `docs/project/`. Do NOT silently re-run with `--from-code` —
   tell the user the run stopped, and offer the two options the error names:
   add their PRD/specs under `docs/project/` first, or confirm that they want
   the documentation built from the code. Re-run only after they choose.

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
