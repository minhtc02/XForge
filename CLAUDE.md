# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**XForge** — "Project Knowledge Compiler & AI Development Toolkit" for iOS/Swift
projects. It reads an existing iOS repo (source, tests, Xcode config, PRD, Spec
Kit, BMAD artifacts), compiles a **Canonical Project Model** (evidence-backed
JSON), and then drives three modules off that model:

| Module | Package              | What it does                                                           |
| ------ | -------------------- | ---------------------------------------------------------------------- |
| Docs   | `packages/core`      | Generates the evidence-backed documentation tree (28 files on fixture) |
| Test   | `packages/test-core` | Autonomous iOS QA: plan → generate XCUITest → run → triage → report    |
| Dev    | `packages/dev-core`  | Spec-first development in isolated git worktrees                       |

Note the directory is named `XForce` but the product is **XForge** everywhere in
code, docs and package names. Don't "fix" this.

This repo is the toolkit itself (TypeScript). It is **not** an iOS app — the
Swift code under `test-fixtures/ios-swiftui` is a fixture used by tests.

## Non-negotiable principles

These come from the original blueprint and are enforced by tests. Violating them
is a design regression, not a style preference.

1. **Deterministic logic lives in the CLI/core; the LLM layer only does semantic
   analysis.** Scanning, hashing, schema validation, drift detection, redaction,
   sharding, triage — all pure TypeScript. Prose, feature grouping, PRD↔code
   judgement calls — the Claude plugin's agents.
2. **Never send the whole repository into one prompt.** The CLI reduces the repo
   to structured metadata first; agents read the model, not the tree.
3. **Every implementation claim needs evidence** (a source ref). A generated doc
   sentence with no file:line behind it is a bug.
4. **Keep as-intended / as-built / rules distinct.** `constitution.md` feeds
   _principles_ only — never requirements.
5. **Redact secrets** on every path that reads files or emits output.
6. **Preserve manual blocks** in generated docs; sync is incremental.
7. **The plugin never duplicates core logic** — `plugins/claude/bin/xforge` is a
   thin wrapper that shells out to the CLI.

Module-specific invariants:

- **Dev**: the main checkout is read-only. Worktrees only under
  `.xforge/worktrees/`. Optional actions (build/test/ui_verification/performance)
  default to `NOT_REQUESTED`, docs_sync to `NOT_REQUIRED`; every `denied.*`
  permission (modifyMainCheckout, mergeIntoMain, forcePush, modifySigning,
  accessProduction, publishBuild) defaults true. A `--execute` run creates
  worktrees and a delivery package but writes **no product code** — scoped agents
  do that inside the worktrees.
- **Test**: `run` is approval-gated (re-verifies the plan hash, refuses stale or
  unapproved plans) and **dry-run by default**; `--execute` invokes real
  xcodebuild/simctl. No mid-run prompts. A screenshot with no baseline is
  reported, never auto-approved. `plan` withholds approval when a case targets a
  screen nothing else in the app refers to — settling that needs a source
  investigation, which is what `test review` / `/xforge:test-review` is for.
- **Docs**: `docs sync` must stay genuinely incremental (affected-document graph
  in `packages/core/src/sync/`). `docs` leads with the project's own documents
  (`sources.project_docs`) by default; `--from-code` flips it. The choice is
  confirmed interactively when the terminal allows, and never in CI.

## Layout

```
packages/shared      XForgeError hierarchy + exit codes, logger, Result
packages/core        Zod project-model & config schemas, discovery (scanner/detector),
                     swift parser, analysis (features/technologies/entities),
                     prd (parser/coverage), ios (plist/xcode/pbxproj-edit),
                     generators (markdown/mermaid), sync, state, redaction, manual-blocks
packages/test-core   models/ config/ planning/ generation/ execution/ analysis/
                     results/ reporting/ figma/ approval/ state/
packages/dev-core    models/ spec/ planning/ worktree/ execution/ journal/
                     design/ config/ state/
apps/cli             Commander CLI (src/index.ts wires every command),
                     src/commands/{docs,sync,check,init,doctor,inspect,upgrade}.ts,
                     src/commands/test/*, src/commands/dev/*,
                     src/model-builder.ts (repo → Project Model),
                     scripts/bundle.mjs (esbuild single-file bundle)
plugins/claude       plugin.json, 29 commands/*.md, 22 agents/*.md, 5 skills/, bin/xforge
schemas/             11 published JSON schemas
templates/           doc templates
test-fixtures/       ios-swiftui (SPM fixture with UI test target), figma
docs/                development.md, test-optimizations-integration-plan.md
```

Dependency direction: `shared ← core ← {test-core, dev-core} ← cli`. Nothing
depends upward; `test-core`/`dev-core` never fork core.

## Runtime state layout

| Path                      | Owner     | Contents                                                                                                            |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `.xforge/config.yaml`     | core      | project config                                                                                                      |
| `.xforge/state/`          | core      | project-model.json (core) + `state/model/` appendices, 6 state files                                                |
| `.xforge/cache/`, `logs/` | core      | gitignored                                                                                                          |
| `.xforge/test/`           | test-core | config.yaml, plans/`<plan-id>`/, generated-tests/, design-snapshots/, navigation.yaml                               |
| `qa-runs/<run-id>/`       | test-core | summary.md/json, test-results.json, bugs.json, coverage.md, artifacts/{screens,diffs,probe}, xcresult/ (gitignored) |
| `.xforge/dev/`            | dev-core  | plans/`<plan-id>`/, spec-staging/`<run-id>`/                                                                        |
| `.xforge/worktrees/`      | dev-core  | isolated worktrees, branch `xforge/dev/<change-id>/<group>`                                                         |
| `docs/project/`           | **user**  | the project's own PRD/specs — XForge reads, never writes                                                            |
| `docs/xforge/`            | core      | the generated documentation tree (`output.root`)                                                                    |

**The two docs trees must never overlap.** `docs/project/` is input,
`docs/xforge/` is output. If output landed inside the input tree, the next run
would parse its own generated prose into requirements and report perfect
coverage of them. `doctor` fails on an overlapping pair; `upgrade` reports it.
Anything that needs one of these paths reads it from config
(`sources.project_docs`, `output.root`) via `globRootDir` — don't hardcode.

The Project Model is deliberately **split**: a small core file the LLM layer
opens, plus per-file appendices only the deterministic generators read
(`packages/core/src/project-model/split.ts`). Keep the core small. The published
`_meta/project-model.json` is the _merged_ complete model so a reader with only
the output tree needs nothing else.

## Environment & gates

`pnpm` is not on PATH by default. Every Bash call that uses it must first:

```bash
export PATH="$HOME/.local/bin:$PATH"   # shim: exec corepack pnpm "$@"
```

Shell state does not persist between tool calls, so repeat the export each time.
Pinned: pnpm@9.15.0, Node >= 20.

Full gate sequence — run all five before claiming work is done:

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Current baseline: **551 tests across 60 files, all green.** `pnpm test` takes
~10s; there is no reason to skip it.

Run the CLI without installing: `pnpm --filter @xforge/cli dev -- <args>`
(straight from TypeScript via tsx), or `node apps/cli/bundle/xforge.mjs` after a
build.

## Code conventions

- TypeScript ESM, `NodeNext` resolution — **relative imports need the `.js`
  extension** even in `.ts` source (`verbatimModuleSyntax` is on).
- `strict` plus `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitOverride`. Indexing an array gives
  `T | undefined`; handle it rather than asserting.
- `@typescript-eslint/no-explicit-any` is an **error**. Unused names must be
  prefixed `_`.
- Prettier: 2 spaces, double quotes, semicolons, trailing commas, 80 columns.
- Zod for every schema; the `export const Foo = z.object(...)` +
  `export type Foo = z.infer<typeof Foo>` pair is the house pattern.
- Errors: throw an `XForgeError` subclass from `@xforge/shared`. Exit codes are
  `0` success, `1` operational failure (drift/validation), `2` config or runtime
  error.
- Every command takes a `CliContext` (`apps/cli/src/context.ts`) rather than
  reaching for globals — that is what keeps commands unit-testable.
- Tests are colocated `*.test.ts`, run by Vitest from the repo root.
- Side effects go behind the `CommandRunner` abstraction (both test-core and
  dev-core have one) so tests exercise a DryRun implementation.

## Command surface

Global flags on everything: `--cwd <dir>`, `--json`, `--verbose`, `--quiet`.

**Core**: `init`, `doctor`, `docs` (+ `docs sync`, `docs check`), `inspect`,
`upgrade`.

`docs` takes `--from-docs` / `--from-code` (mutually exclusive) and `--yes`.
Prompting goes through `canPrompt` in `apps/cli/src/prompt.ts`, which refuses
under `--json` or when either stdin or stdout is not a TTY — every caller needs a
non-interactive default ready. `docs sync` passes `yes: true`: it re-runs a
decision the user already made.

`upgrade` only ever _adds_ — it fills `auto` sentinels and creates missing files,
never overwriting a value the project set. `init --force` does regenerate and
would discard hand edits; keep that distinction.

**Test**: `doctor`, `plan`, `navigation`, `design`, `generate`, `review`, `approve`, `run`,
`status`, `report`, `bugs`, `clean`. `test plan` is a pipeline — it preflights,
scaffolds navigation, plans, generates XCUITest sources, wires them into the
Xcode targets and approves, each step disableable with a `--no-*` flag.

**Dev**: `doctor`, `plan`, `run`, `auto`, `status`, `report`, `review`, `accept`,
`reject`, `clean`, the opt-in gates `build`/`test`/`ui-check`/`performance`, and
`inspect-spec`/`sync-docs`/`dismiss-spec`.

## Things that will bite you

- **Figma data arrives by MCP first.** `/xforge:test-design` has the agent fetch
  and write the snapshot file; the CLI reads that file. `--rest` (needs
  `FIGMA_TOKEN`) is the CI path. Every failure path degrades to "no reference"
  rather than failing a run — preserve that.
- **`simctl privacy` cannot grant camera or notifications.** Verified against the
  real tool. `PRIVACY_SERVICES` in `test-core/src/execution/simctl.ts` is the
  real list and `privacyCommand` throws rather than emitting a doomed command.
- **`simctl ui dump` does not exist.** The accessibility tree comes from the
  generated probe class dumping it as an XCTest attachment.
- **Image diffing is pngjs + pixelmatch, deliberately.** `sharp` was rejected:
  native, unbundleable by esbuild, and unnecessary for PNG.
- **Baselines are per shard**, because the same case runs on several devices and
  a 393pt screen never matches a 375pt baseline.
- **Visual escalation is one-way**: PASS→FAIL allowed, FAIL→PASS never.
- **The CLI must stay bundleable.** Workspace deps are private, so
  `npm i -g @xforge/cli` only works via the esbuild single-file bundle. Don't add
  a native dependency to anything the CLI imports.
- **Two Swift-parser bugs were fixed and are regression-tested**: `//` inside a
  string literal is not a comment (it was destroying every URL), and a nested
  plist `<array>` must not swallow the keys inside it.
- Plan approvals are bound to a plan hash and go **stale by design** when the
  plan changes. That is correct behaviour, not a bug to work around.

## Known gaps

- Feature-doc sections _User flows / Business rules / Error handling / Edge
  cases_ render as "Not detected (requires semantic analysis)" — they need the
  LLM layer.
- **No CLI path for writing LLM results back into the _docs_ model** (a `model
patch` command). The Test module now has one — `xforge test review` — and it
  is the pattern to copy: template out, evidence-bearing verdicts in, CLI
  performs the merge, re-hash invalidates approval.
- Discovery is iOS-hardcoded; there is no Android/Web adapter interface.
- Real `--execute` QA against a booted device has never been validated here — the
  fixture is an SPM library with no app. Everything is unit-tested behind the
  CommandRunner and verified by dry-run smoke. Be honest about this in any
  status report.
- Spec Kit `specs/**` parsing is shallow.
- The original blueprint files (`~/Downloads/XForge_*_Blueprint_and_Claude_Prompt.md`)
  are **no longer present on disk**. Section references like "§13" throughout the
  code point at them; treat the code and CHANGELOG as the surviving spec.

## Working style here

- Read `CHANGELOG.md` for what shipped in 0.2.0 — it is written as prose
  explaining _why_, and it is the best single summary of recent work.
- Commit messages: lowercase conventional prefix, imperative, describing the
  user-visible effect (`feat: compare screenshots against approved baselines`),
  not the mechanics.
- When adding a module capability, the full slice is: model/schema → pure logic
  in the package → CLI command → plugin `commands/*.md` → JSON schema in
  `schemas/` → tests → CHANGELOG. A CLI command with no plugin command is only
  half-wired; the generator that had no caller was a real shipped gap.
