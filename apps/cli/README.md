# @xforge/cli

XForge — Project Knowledge Compiler & AI Development Toolkit for iOS/Swift
repositories.

XForge reads an existing iOS/Swift project (source, tests, config, `Info.plist`,
PRD, Spec Kit and BMAD artifacts) and compiles a **Canonical Project Model** —
an evidence-backed JSON model — then generates documentation, traceability and
gap reports from it.

## Install

```bash
npm install -g @xforge/cli
```

The package ships as a single self-contained bundle; it has no runtime
dependencies beyond Node.js 20+.

## Use

```bash
cd /path/to/your/ios-project
xforge init      # detect the project, write .xforge/config.yaml
xforge docs      # compile the model and generate docs/project/
```

Other commands:

| Command                   | What it does                                                                          |
| :------------------------ | :------------------------------------------------------------------------------------ |
| `xforge doctor`           | Environment and configuration health checks                                           |
| `xforge docs sync`        | Rebuild only the documents your changes invalidated                                   |
| `xforge docs check`       | Fail (exit 1) when documentation has drifted                                          |
| `xforge inspect <target>` | Inspect the model (`project`, `features`, `requirements`, `evidence`, `technologies`) |
| `xforge test <sub>`       | Autonomous iOS QA orchestrator (`plan`, `approve`, `run`, …)                          |
| `xforge dev <sub>`        | Spec-first development orchestrator (`plan`, `run`, `auto`, …)                        |

Every command supports `--json` for machine-readable output on stdout, and exits
`0` on success, `1` on an operational failure (e.g. drift found) and `2` on a
configuration or runtime error.

## Principles

- Every implementation claim carries a source reference.
- "As intended" (PRD), "as built" (source/tests) and "project rules"
  (constitution) stay separate and are never merged into one truth.
- Missing evidence produces `UNKNOWN` / `INFERRED` / `NEEDS_CONFIRMATION`, never
  a guess.
- Secrets are excluded and redacted; they never reach logs, evidence or docs.
- Content inside `<!-- xforge:manual:start -->` fences is never overwritten.

## License

MIT
