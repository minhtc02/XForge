---
description: Fill the LLM-written feature sections (user flows, business rules, error handling, edge cases) with evidence-backed analysis.
argument-hint: "[--apply]"
---

# /xforge:docs-semantic

Write the semantic half of the feature docs. The deterministic parser sees
structure but not intent, so four sections of every feature doc render as
"Not detected (requires semantic analysis)" until this loop fills them. The
split follows `test review` / `test a11y`: you analyze and fill a template,
the CLI validates evidence and performs the merge.

## Steps

1. Write the template:

   ```bash
   xforge docs semantic --json
   ```

   Requires a project model — run `/xforge:docs` first when it is missing.
   The template at `.xforge/state/semantic-enrichment.template.json` names
   every feature and its four sections, with a `_files` hint listing the
   source files each feature may cite.

2. Analyze. For each feature in scope, read the model detail
   (`.xforge/state/feature-map.json`, then the feature's source files) and
   fill the sections. On a large repository delegate per feature to the
   sub-agents:

   - `codebase-analyst` — trace the flows and error paths from the source.
   - `doc-writer` — phrase the sections. **Never state a fact without a
     source reference.**

3. Fill honestly. `status: documented` requires non-empty `text` AND
   `sources` citing real files from `_files` (exact paths, optional line
   numbers). Use `not_applicable` with a `note` when a section genuinely does
   not apply; leave `unknown` for anything you did not investigate. A
   documented claim the CLI cannot verify is rejected whole — a guess costs
   the whole apply, so under-claim rather than over-claim.

4. Apply:

   ```bash
   xforge docs semantic --apply --json
   ```

   The CLI validates every source ref against the project model, merges the
   enrichment into `.xforge/state/semantic-enrichment.json`, and regenerates
   the affected feature documents.

5. Verify the merge landed: open one regenerated feature doc and confirm the
   sections carry your text followed by their source refs. Applied
   enrichment survives every later `xforge docs` / `docs sync` run.

## Rules

- **Evidence before prose.** Every documented claim needs a source ref to a
  file the model contains; the CLI rejects entries that cite anything else.
- The enrichment is per feature — a patch replaces the whole feature entry,
  so rebuild the template (`--force`) to amend rather than editing the
  enrichment file by hand.
- Keep the three kinds of truth distinct: these sections describe what the
  code _does_ (as-built). Intent that only the PRD states belongs in the
  requirements, not here.
