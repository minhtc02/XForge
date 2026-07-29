# XForge Development Notes

See the root [README](../README.md) for setup and command reference.

## Architecture (blueprint §14)

```
Interfaces (Claude plugin / CLI / CI)
  → Workflow orchestrator (init / discover / model / docs / validate)
  → Input adapters (source / prompt / docs / Spec Kit / BMAD)
  → Canonical Project Model
  → Analysis (feature detector / PRD mapper / gap finder)
  → Output modules (Markdown / Mermaid / JSON)
```

## Deterministic vs LLM layer (blueprint §15)

- **Deterministic (this repo, `packages/core` + `apps/cli`)**: scan, ignore
  rules, secret filtering, project-type detection, hashing, config/model
  validation, drift detection, manual-block preservation.
- **LLM (Claude plugin)**: feature grouping, business-behavior summaries, PRD↔
  code mapping, prose, Mermaid from verified relationships.

Never send the whole repository into a single prompt. The CLI reduces the repo
to structured metadata first.

## Phase status

- Phase 1 (Foundation): **done** — monorepo, TS config, CLI skeleton, `init`,
  `doctor`, `docs`/`sync`/`check`/`inspect` deterministic skeletons, config +
  Project Model Zod schemas, secret redaction (tested), Claude plugin skeleton,
  Vitest setup, README.
- Phase 2 (Repository discovery): scanner, ignore rules, secret filtering,
  detector implemented; deeper Xcode `.pbxproj`/`Package.swift` parsing pending.
- Phase 3+ (iOS source analysis, model enrichment, generation, PRD/Spec/BMAD,
  incremental sync): scaffolded; semantic layers pending.
