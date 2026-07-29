---
description: Resolve the Effective Spec and generate a spec-first dev plan (no code changes).
argument-hint: "[feature id] [and any override request, e.g. change maximum alarms to 20]"
---

# /xforge:dev-plan

Create a development plan. The **deterministic plan is built by the CLI** from
the Canonical Project Model + docs; you add senior-engineer analysis on top and
never invent requirements (blueprint §4.2, master prompt).

## Steps

1. Build the plan (docs are the default source of truth; the request may
   override docs for this run only):

   ```bash
   xforge dev plan --json --feature <id> ${ARGUMENTS:+--request "$ARGUMENTS"}
   ```

2. Read the artifacts under `.xforge/dev/plans/<plan-id>/`: `plan.json`,
   `effective-spec.md`, `requirement-traceability.md`, `permission-manifest.json`,
   `staged-spec.json`.
3. Explain the Effective Spec = docs + user overrides. Every override is
   recorded as a Staged Spec difference; docs are NOT changed.
4. State clearly that build / test / UI verification / performance are
   **NOT_REQUESTED** and docs sync is **NOT_REQUIRED** by default.
5. Preview a run with `xforge dev run <plan-id> --dry-run`. Do not implement yet.
