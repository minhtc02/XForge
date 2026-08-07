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
# Put your PRD and specs in docs/project/ first (an existing one is used as-is).
xforge init      # detect the project, write .xforge/config.yaml + both docs trees
xforge docs      # compile the model and generate docs/xforge/
```

XForge keeps documentation input and output in **separate trees**:
`docs/project/` is yours and is only ever read, `docs/xforge/` is generated and
rewritten on every run. They must not overlap — reading its own output back in
would let XForge treat generated prose as a requirement and report perfect
coverage of it. `xforge doctor` fails on an overlapping pair.

`xforge docs` leads with your documents by default and confirms the choice
before generating; `--from-code` flips it, `--from-docs` is explicit and
`--yes` accepts the configured default. The prompt never appears under `--json`,
through a pipe, or in CI.

Other commands:

| Command                   | What it does                                                                          |
| :------------------------ | :------------------------------------------------------------------------------------ |
| `xforge doctor`           | Environment and configuration health checks                                           |
| `xforge docs sync`        | Rebuild only the documents your changes invalidated                                   |
| `xforge docs check`       | Fail (exit 1) when documentation has drifted                                          |
| `xforge upgrade`          | Update a project initialized by an older XForge; only ever adds                       |
| `xforge inspect <target>` | Inspect the model (`project`, `features`, `requirements`, `evidence`, `technologies`) |
| `xforge test <sub>`       | Autonomous iOS QA orchestrator (`doctor`, `plan`, `run`, `report`, …)                 |
| `xforge dev <sub>`        | Spec-first development orchestrator (`plan`, `run`, `auto`, …)                        |

`xforge test plan` is a pipeline: preflight → scaffold navigation → plan →
generate XCUITest → wire into the Xcode targets → approve. `xforge test run` is
a **dry run** unless given `--execute`.

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
