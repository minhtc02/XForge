---
name: xforge-dev
description: Plan and (later) run spec-first feature development in isolated git worktrees via the xforge dev CLI. Implement-only by default; build/test/UI/performance are opt-in and default NOT_REQUESTED.
---

# XForge Dev Skill

Use when a user wants to implement a feature spec-first.

1. Check readiness: `xforge dev doctor --json`.
2. Plan: `xforge dev plan --feature <id> [--request "<override>"] --json`. Docs
   are the default source of truth; the request may override docs this run only,
   and every divergence is recorded as a Staged Spec (docs are not changed).
3. Preview: `xforge dev run <plan-id> --dry-run --json` — shows worktrees,
   branches, allowed files, and the optional actions that are NOT requested.
4. A real run (Phase 2+) implements code in isolated worktrees under
   `.xforge/worktrees/`, merges to an integration branch, runs static review,
   and records the Staged Spec — but never builds/tests/UI-checks/perf-checks or
   syncs docs unless explicitly asked.

Rules: reuse the Canonical Project Model; never invent requirements; main
checkout is read-only (never merge to main / force-push); code acceptance is
independent from docs sync; never log secrets. A valid success state is
`development: CODE_COMPLETED` with build/test/ui/performance `NOT_REQUESTED`.
