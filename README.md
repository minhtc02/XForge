# XForge

**Project Knowledge Compiler & AI Development Toolkit.**

XForge reads an existing iOS/Swift project — source code, tests, config, PRD,
Spec Kit and BMAD artifacts — and compiles a **Canonical Project Model**: a
structured, evidence-backed, reusable model of the repository. From that model
it generates documentation that distinguishes _as-intended_ (PRD) from
_as-built_ (source/tests) from _project rules_ (constitution), with a source
reference behind every important claim.

> Status: **v0.1 — Phase 1 (Foundation)**. The deterministic core (scan,
> detect, config, Project Model, secret redaction, incremental drift) is
> implemented and tested. Rich per-feature prose is produced by the LLM layer
> (the Claude plugin) on top of this foundation.

## Repository layout

```
xforge/
├── apps/cli/            # xforge CLI (Commander) — all deterministic commands
├── packages/
│   ├── shared/          # error types, structured logger, Result
│   └── core/            # Project Model, config, redaction, discovery, state
├── plugins/claude/      # Claude Code plugin (commands/skills/agents/bin)
├── schemas/             # JSON Schemas (config, project model, report)
├── templates/           # doc templates
├── test-fixtures/       # sample iOS project used by the smoke test
└── docs/
```

Deterministic logic lives in `packages/core` and `apps/cli`. The Claude plugin
**calls the CLI** and only adds semantic analysis — it never duplicates core
logic.

## Requirements

- Node.js >= 20 (developed against Node 26)
- pnpm 9 (via `corepack`)

## Local development

```bash
# 1. Enable pnpm (Corepack ships with Node)
corepack prepare pnpm@9.15.0 --activate
# If corepack cannot symlink into /usr/local/bin, add a shim:
#   printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > ~/.local/bin/pnpm
#   chmod +x ~/.local/bin/pnpm && export PATH="$HOME/.local/bin:$PATH"

# 2. Install
pnpm install

# 3. Build all packages + CLI
pnpm build

# 4. Quality gates
pnpm typecheck
pnpm lint
pnpm test

# 5. Run the CLI without installing it globally
node apps/cli/dist/index.js --help
# or during development, straight from TypeScript:
pnpm --filter @xforge/cli dev -- --help
```

### Try it on the bundled fixture

```bash
pnpm build
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui init
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui doctor
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui docs
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui inspect project --json
```

### Install globally (optional)

```bash
pnpm --filter @xforge/cli build
npm i -g ./apps/cli   # or: cd apps/cli && npm link
xforge --help
```

## Commands

| Command                   | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `xforge init`             | Detect project type; write `.xforge/config.yaml`, state dirs and output dir. |
| `xforge doctor`           | Environment + config health checks.                                          |
| `xforge docs`             | Build & persist the Canonical Project Model and index doc.                   |
| `xforge docs sync`        | Regenerate for changed files (incremental).                                  |
| `xforge docs check`       | Detect documentation drift (exit 1 if drift).                                |
| `xforge inspect <target>` | Print a slice of the Project Model.                                          |

All commands support `--json` for machine-readable output and `--cwd <dir>` to
target another directory. Global flags: `--verbose`, `--quiet`.

Exit codes: `0` success · `1` operational failure (drift / validation) · `2`
configuration or runtime error.

## Claude Code plugin

```
/xforge:init
/xforge:docs
/xforge:sync
/xforge:doctor
/xforge:inspect
```

The plugin lives in `plugins/claude/`. Its commands invoke the `xforge` CLI for
all deterministic work and use sub-agents (`codebase-analyst`,
`product-analyst`, `doc-writer`, `doc-reviewer`) for semantic analysis.

## XForge Test (Autonomous iOS QA)

The second module reads the Canonical Project Model and plans + runs iOS QA.
The full command surface is implemented; simulator execution runs in **dry-run
mode by default** (records the exact build/test command plan and writes run
artifacts) and invokes Xcode only with `--execute` on a Mac with a UI-testable
app.

```bash
xforge test doctor                          # environment + config health
xforge test plan --feature alarm --level full
xforge test approve XFPLAN-20260729-001     # one-time, immutable, hash-bound
xforge test run XFPLAN-20260729-001         # dry run (add --execute for real)
xforge test status   # --latest by default
xforge test report
xforge test bugs
xforge test clean [runs|cache]
```

`plan` builds a deterministic, evidence-linked test plan (QA Knowledge Model,
risk scores, testability issues, feature-based Simulator shards, permission
manifest) — it never runs tests. `approve` binds approval to a canonical plan
hash so a stale/mutated plan is refused (`run` re-checks it and never prompts
after a valid approval, blueprint §19.3). `run` orchestrates build-once →
per-feature shards → continue-on-failure, then triages results into
**deduplicated, requirement-linked bug reports** (infrastructure/environment
failures are never reported as product bugs, §4.4) and writes
`qa-runs/<run-id>/` (`summary.md/json`, `test-results.json`, `bugs.json`,
`coverage.md`).

`packages/test-core` holds the QA model, planning (risk/testability/hash/shard),
XCUITest + XForgeTestSupport generation, xcresult parsing, failure
classification, bug dedup, visual/accessibility/performance analyzers, and the
orchestrator (behind a `CommandRunner` abstraction — dry-run and spawn-backed).
Test config: `.xforge/test/config.yaml` (§26); a file-backed Figma adapter
(`design-map.yaml` + fixture) keeps planning offline.

Claude commands: `/xforge:test-doctor`, `/xforge:test-plan`,
`/xforge:test-run`, `/xforge:test-status`, `/xforge:test-report`, plus 8 QA
agents (`qa-lead`, `environment-agent`, `test-case-author`,
`feature-test-agent`, `visual/performance/accessibility-analysis-agent`,
`bug-triage-agent`).

## XForge Dev (Spec-first development)

The third module implements features spec-first in isolated git worktrees. The
full command surface is implemented (planning through execution, integration,
optional gates, spec-journal sync and auto mode); a real run creates worktrees
and a delivery package but writes **no product code by itself** — the scoped
Claude agents do that inside the worktrees. Its defining rule: it **implements
code only** — build, test, UI verification and performance verification default
to `NOT_REQUESTED`, docs sync to `NOT_REQUIRED`, and none run unless explicitly
requested.

```bash
xforge dev doctor                                   # env + worktree support
xforge dev plan --feature alarm \
  --request "change maximum alarms to 20"           # docs + override → Effective Spec
xforge dev run XFDEVPLAN-20260729-001 --dry-run     # preview; no worktrees created
xforge dev run XFDEVPLAN-20260729-001 --execute     # create worktrees + delivery package
xforge dev status / report / review                 # inspect the latest run
xforge dev accept <run-id>                          # accept code (independent of docs)
xforge dev sync-docs / dismiss-spec <plan-id>       # Staged Spec journal → docs, or drop
xforge dev build/test/ui-check/performance <plan>   # opt-in gates (dry-run unless --execute)
xforge dev auto --feature alarm                     # plan+run, no mid-run questions (policy-bounded)
xforge dev clean [runs|worktrees]                   # remove XForge-managed artifacts only
```

`plan` resolves the **Effective Spec** = canonical docs + user overrides +
approved plan. Docs are the default source of truth; a user request overrides
docs _for this run only_ and every divergence is recorded in the **Staged Spec**
journal (a change log, never a code gate — docs are not touched). The plan also
produces impact analysis, dependency-aware implementation groups, an isolated
**worktree plan** (`xforge/dev/<change-id>/<group>` under `.xforge/worktrees/`,
plus an integration worktree) and a permission manifest whose optional
verification actions are all `false`. `run` defaults to a dry-run preview that
validates the base branch and every worktree path (path-traversal /
main-protection / branch-name safety); `--execute` runs the deterministic
orchestrator (create worktrees → schedule groups → static review → integrate →
delivery package) behind a `CommandRunner` — never touching the main checkout,
never merging to main or force-pushing. `auto` proceeds without mid-run
questions only when the plan stays inside a pre-approved envelope, otherwise it
refuses and falls back to plan-first.

`packages/dev-core` holds the Dev model, Effective Spec resolver + user-override
detection, Staged Spec journal (with source-doc-hash drift detection + doc
sync/dismiss), worktree planner + safety validation + manager, impact analyzer,
plan builder + hashing, dependency-aware scheduler, integration merge planner,
deterministic static review (scope / secret / forbidden-path), delivery package
renderer, opt-in quality-gate specs, auto-mode policy, and file-backed Figma +
reference-image adapters (offline). Config: `.xforge/dev/config.yaml` (§22). A
valid success state is `development: CODE_COMPLETED` with
build/test/ui/performance `NOT_REQUESTED`.

Claude commands: `/xforge:dev-doctor`, `-plan`, `-run`, `-auto`, `-status`,
`-report`, `-review`, `-accept`, `-reject`, `-build`, `-test`, `-ui-check`,
`-performance`, `-inspect-spec`, `-sync-docs`, `-dismiss-spec`, `-clean`, plus
10 dev agents (`dev-lead`, `spec-analyst`, `architecture-analyst`,
`impact-analyst`, `senior-ios-engineer`, `senior-ui-engineer`,
`persistence-engineer`, `integration-engineer`, `static-code-reviewer`,
`spec-change-recorder`).

## Security & privacy

XForge never reads, prompts, logs, or embeds the contents of sensitive files
(`.env`, `*.pem`, `*.p12`, `*.mobileprovision`, `GoogleService-Info.plist`,
`Secrets.swift`, credentials, private keys). A redaction layer scrubs secret
patterns (API keys, bearer tokens, JWTs, private-key blocks) from any text that
does flow into prompts, logs, evidence or docs. See
`packages/core/src/redaction/`.

## License

MIT
