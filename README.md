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

### Install globally (optional but recommended for usage)

```bash
pnpm --filter @xforge/cli build
npm i -g ./apps/cli   # or: cd apps/cli && npm link
xforge --help
```

## Commands

| Command                   | Description                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `xforge init`             | Detect project type; write `.xforge/config.yaml`, state dirs, `docs/project/` (input) and `.xforge/docs/` (output). |
| `xforge doctor`           | Environment + config health checks.                                                                                 |
| `xforge docs`             | Build & persist the Canonical Project Model and the documentation tree. Confirms which source to build from.        |
| `xforge docs sync`        | Regenerate for changed files (incremental).                                                                         |
| `xforge docs check`       | Detect documentation drift (exit 1 if drift).                                                                       |
| `xforge upgrade`          | Bring a project initialized by an older XForge up to date; only ever adds.                                          |
| `xforge inspect <target>` | Print a slice of the Project Model.                                                                                 |

`xforge test <sub>` and `xforge dev <sub>` are documented under
[XForge Test](#xforge-test-autonomous-ios-qa) and
[XForge Dev](#xforge-dev-spec-first-development).

All commands support `--json` for machine-readable output and `--cwd <dir>` to
target another directory. Global flags: `--verbose`, `--quiet`.

Exit codes: `0` success · `1` operational failure (drift / validation) · `2`
configuration or runtime error.

## Adding XForge to an existing iOS project

The sections below cover each piece; this is the whole path, in order. Every
step fails loudly if the previous one is missing, so there is no way to skip
ahead by accident.

```bash
cd /path/to/your-ios-app

# 0. Put your PRD/specs in docs/project/ (or point sources.project_docs at
#    wherever you already keep them). An existing docs/project/ is used as-is.

xforge init          # detect Xcode project; write config + both docs trees
xforge docs          # compile the Canonical Project Model — required before QA
xforge test doctor   # environment check; must be green before planning
xforge test plan --level smoke
xforge test run <plan-id>             # dry run: records the commands, no Xcode
xforge test run <plan-id> --execute   # for real
```

Two things to check in `init`'s output before moving on. If **scheme** or **UI
test target** is still `auto`, `--execute` will fail later — the usual cause is
a scheme that is not shared (in Xcode: Product → Scheme → Manage Schemes → tick
"Shared"). And `xforge docs` is not optional before QA: the test plan is derived
from the features and requirements in the Project Model.

Prefer to drive this from Claude Code? See
[Claude Code plugin](#claude-code-plugin) — same sequence, plus
`/xforge:test-design`, which can reach Figma where the CLI cannot.

## Two documentation trees

`xforge init` creates both, and the distinction is the point:

| Directory       | Owner   | Role                                                                               |
| --------------- | ------- | ---------------------------------------------------------------------------------- |
| `docs/project/` | **you** | Your PRD, specs and design notes. XForge only reads this — never writes it.        |
| `.xforge/docs/` | XForge  | Generated documentation. Regenerated on every run; edit only inside manual blocks. |

An existing `docs/project/` is adopted as-is, so a project that already keeps
its specs there needs no migration.

`xforge docs` leads with **your documents** by default: a requirement stated in
`docs/project/` is intent, and the implementation is measured against it. Code
is still scanned for evidence behind every claim. Because that choice changes
the output substantially, `docs` confirms it before generating:

```
Which source should this documentation be built from?

  ›  1. Project documents  — docs/project/**/*.md lead; code supplies evidence
     2. Source code  — the repository leads; project documents are secondary
```

Skip the question with a flag, which is what CI and agents should do:

```bash
xforge docs --from-docs    # documents lead (the default)
xforge docs --from-code    # the repository leads; use when docs have drifted
xforge docs --yes          # accept the configured default without asking
```

The prompt only appears at a real terminal — under `--json`, a pipe, or in CI
the configured `generation.docs_source` applies silently. Set that in
`.xforge/config.yaml` to change the default permanently.

## Claude Code plugin

XForge is usable entirely from Claude Code — that is the intended way to drive
it, because the semantic half of the work (prose, requirement judgement, Figma)
is the LLM's, and the plugin wires the two halves together.

```
/xforge:init          /xforge:docs         /xforge:sync
/xforge:doctor        /xforge:inspect
/xforge:test-doctor   /xforge:test-plan    /xforge:test-review
/xforge:test-a11y     /xforge:test-design  /xforge:test-run
/xforge:test-status   /xforge:test-report
/xforge:dev-doctor    /xforge:dev-plan     /xforge:dev-run       (+12 more dev commands)
```

The plugin lives in `plugins/claude/`: 39 commands, 22 agents and 5 skills. Its
commands invoke the `xforge` CLI for all deterministic work and use sub-agents
(`codebase-analyst`, `product-analyst`, `doc-writer`, `doc-reviewer`, plus 8 QA
and 9 dev agents) for semantic analysis.

### Quick Setup & Installation

Run these two commands to build the CLI and install the Claude plugin:

```bash
# 1. Build the project locally (run once in the XForge directory)
corepack prepare pnpm@9.15.0 --activate && pnpm i && pnpm build

# 2. Add the marketplace to Claude (replace YourOrg/XForce with your repo URL)
claude plugin marketplace add https://github.com/YourOrg/XForce --sparse plugins/claude .claude-plugin
```

Then inside Claude, run: `/plugin install xforge`

_(For local dev without GitHub, start Claude with: `claude --plugin-dir /path/to/xforge/plugins/claude`)_

### Driving a project from Claude Code

Run Claude Code **from your iOS project's directory**, having put your PRD and
specs in `docs/project/` first:

```
/xforge:init          # detect the project, create both docs trees
/xforge:docs          # compile the Canonical Project Model — required before QA
/xforge:test-doctor   # environment check
/xforge:test-plan alarm
/xforge:test-review XFPLAN-…    # when the plan reports unreferenced screens
/xforge:test-design XFPLAN-…    # optional: fill Figma references via MCP
/xforge:test-run XFPLAN-…
```

Under Claude Code, `/xforge:docs` passes `--yes`, so it does not show the source
prompt — it applies the configured `generation.docs_source`. Ask for the other
source explicitly ("build the docs from source code") and the agent adds
`--from-code`.

**`/xforge:test-design` only works from the plugin.** The CLI is a plain Node
process and cannot reach the Figma MCP server, but Claude can: the agent fetches
each node and writes the snapshot file, and the CLI reads it later. Credentials
stay out of the CLI and the comparison stays reproducible from a file — see
[Design conformance](#xforge-test-autonomous-ios-qa) below.

## XForge Test (Autonomous iOS QA)

The second module reads the Canonical Project Model and plans + runs iOS QA.
The full command surface is implemented; simulator execution runs in **dry-run
mode by default** (records the exact build/test command plan and writes run
artifacts) and invokes Xcode only with `--execute` on a Mac with a UI-testable
app.

```bash
xforge test doctor                          # environment + config health
xforge test setup                           # UI test target, scheme, test-support hook
xforge test plan --feature alarm --level smoke
xforge test review XFPLAN-20260729-001      # settle dead-code questions, fix the plan
xforge test a11y XFPLAN-20260729-001        # propose the missing accessibility identifiers
xforge test run XFPLAN-20260729-001         # dry run (add --execute for real)
xforge test status   # --latest by default
xforge test report
xforge test bugs
xforge test clean [runs|cache]
```

`plan` is a **pipeline, not a single step**: it runs the environment preflight,
scaffolds `navigation.yaml` if the project has none, builds the plan, generates
the XCUITest sources, copies them into the Xcode targets and approves the plan.
Turn off any step with `--no-doctor`, `--no-navigation`, `--no-generate`,
`--no-xcode`, `--no-approve`. Start with `--level smoke` on a project that has
never been tested.

The plan itself is deterministic and evidence-linked (QA Knowledge Model, risk
scores, testability issues, feature-based Simulator shards, permission
manifest); it never runs tests. Approval binds to a canonical plan hash, so a
stale or mutated plan is refused — an approval going stale after a re-plan is
correct behaviour, not a bug. `run` re-checks it and never prompts afterwards
(§19.3), orchestrates build-once → per-feature shards → continue-on-failure,
then triages results into **deduplicated, requirement-linked bug reports**
(infrastructure failures are never reported as product bugs, §4.4) and writes
`.xforge/test/runs/<run-id>/` (`summary.md/json`, `test-results.json`,
`bugs.json`, `coverage.md`).

### Making a project testable at all

XCUITest drives the app from a **separate process** through the accessibility
APIs, and iOS grants that only to a bundle whose product type is
`com.apple.product-type.bundle.ui-testing`. There is no way to run these tests
from the app target — that is an OS boundary, not an Xcode convention — so a
project without a UI test target cannot be QA'd, and `test doctor` reports a
blocker.

`xforge test setup` creates one, plus the bundle's `Info.plist` and a shared
scheme (`xcodebuild -scheme` cannot see a scheme that lives in `xcuserdata`):

```bash
xforge test setup --dry-run   # what would change
xforge test setup             # do it
```

This edits `project.pbxproj`, the one file where a bad write does not fail
loudly — it makes Xcode refuse to open the project. So the edit is backed up
first, verified structurally before it is written and again afterwards, and
restored from the backup on any surprise. It is also idempotent: a project that
already has a UI test target is left alone. Check `git diff -- '*.pbxproj'`
before committing.

It also puts `XForgeTestSupport.swift` in the app target and a
`XForgeTestSupport.configure()` call in the `@main` App — the only edit XForge
makes to product source. The file alone does nothing; a call site is what makes
the deterministic clock, network mock and seed data reachable, so declining to
write it would not mean "less intrusion", it would mean the feature does not
work. It is four lines, inside `#if DEBUG` (the callee is DEBUG-only, so an
unguarded call would not compile in Release), and inert without the
`--xforge-test` launch argument. Where the shape is not one it recognises — a
UIKit `@main`, a custom initializer, two `@main` types — it reports why and
changes nothing; the hook bodies are empty stubs, so tests run without it.

### Accessibility identifiers the plan needs

XCUITest finds elements by `accessibilityIdentifier`. A locator the plan looks
for that no view declares makes every case using it fail by timeout — and triage
reads a timeout as a product bug, so the report blames the app for a defect in
the test.

```bash
xforge test a11y XFPLAN-20260729-001           # one proposed edit per locator
xforge test a11y XFPLAN-20260729-001 --apply   # writes only the approved entries
```

Every entry starts at `approved: false`, and that gate is the feature. A missing
identifier fails loudly and gets fixed. An identifier on the _wrong_ element does
not: put it on the `VStack` instead of the `Button` inside it and the test finds
an element, taps it, passes, and exercises nothing — invisibly, for as long as the
test exists. So containers are never proposed, a tie yields no suggestion at all
(two plausible elements is information; a coin flip dressed as a default throws it
away), and each suggestion says why it was made. `/xforge:test-a11y` does the part
that needs judgement: reading the view to decide which element a locator belongs
to.

Applying re-reads the anchor line and refuses if the file has changed since,
matches the indentation the element's own modifier chain uses, and re-parses the
result to confirm the identifier can be read back — anything else leaves the file
untouched. The modifier is not `#if DEBUG`-wrapped on purpose: an identifier
changes no behaviour, and stripping it from Release would mean tests that pass
locally time out on the build a TestFlight run exercises. Afterwards, re-run
`xforge docs` and re-plan so the model sees them.

### What silently costs coverage

Three outputs matter more than the case count, because each one removes tests
without failing anything:

- **Accessibility identifiers are a prerequisite.** Generated tests locate
  elements by a11y id and never tap by coordinate. `plan` reconciles every
  locator against source offline and reports `reconcile.missing` — an identifier
  that is nowhere in source blocks its case. Add identifiers to the app first.
- **Unreachable features generate zero cases.** A feature no confident
  navigation path reaches is reported, never guessed at. The scaffolded
  `navigation.yaml` starts every edge at `derived` (0.6 confidence), so review it
  and raise confirmed edges to `explicit`. Check with `xforge test navigation`.
- **`testability-report.md` lists what will interrupt a run.** `simctl` genuinely
  cannot pre-grant camera or notification permissions, so those alerts appear
  mid-run unless handled with `addUIInterruptionMonitor` or a test-support hook.

### Dead code, and the review loop

The planner reasons from declarations, so an abandoned screen and a live one
look identical to it. Left alone it will generate a confident plan against a
screen no code path presents — every case passes, and the screen that actually
ships goes untested.

XForge now cross-references every screen type against the rest of the source. If
a plan navigates to an anchor declared in a file whose screens nothing else
refers to, `plan` **withholds approval** and says so:

```
NOT approved — nothing in the app refers to: CategoryDetailScreen.
```

That question cannot be settled statically — the check is lexical and cannot see
reflection, storyboard instantiation or string-keyed registration. It needs
someone who can grep the repository and read the call sites, which is what
`xforge test review` is for:

```bash
xforge test review <plan-id>            # template + the open questions
# investigate, fill in the verdicts
xforge test review <plan-id> --apply    # merged into the plan deterministically
xforge test review <plan-id> --apply --approve   # …and regenerate + approve
```

In Claude Code, `/xforge:test-review <plan-id>` does the investigation itself:
it greps for each type, finds the screen the app really presents, and writes the
verdicts back. Each verdict is `keep`, `drop`, `retarget` or `revise`, and
anything other than `keep` **requires a rationale and at least one evidence
reference** — the schema rejects a change nobody can justify. The CLI performs
the merge, so an agent never writes `plan.json`; suites, shards and stats stay
consistent, every verdict is recorded in the plan for later readers, and the
re-hash invalidates any prior approval.

A review that would drop every case is refused. That is a planning failure, not
a review: fix the inputs and re-plan rather than approve an empty plan that
passes.

`--approve` closes the loop: it regenerates the XCUITest sources (mandatory
after a retarget — the old Swift still drives at the old anchor) and approves,
so the whole cycle from "the planner got it wrong" to "ready to run" is one
command. It approves **only if the review answered every question that withheld
approval in the first place.** A flagged case left at a bare `keep` is silence,
not an answer, and is refused with the cases named:

```
NOT approved — the review did not settle every open question:
  - CategoryDetailScreen: 1 case(s) (TC-DISCOVERY-001) were left at `keep`
    with no rationale or evidence, so the dead-code question was never answered.
```

That gate is the point of the feature, not an obstacle to it. Auto-approving a
review that investigated nothing converts "we do not know whether this tests
dead code" into "approved", which is strictly worse than the original problem
because the doubt becomes invisible. A `keep` **with** rationale and evidence
("reached by a `NavigationLink` the lexical scan cannot see") is a real answer
and passes — that case is common, since the check misses reflection and
storyboards by design.

When `plan` reports `xcodeIntegration.method: none`, the sources were not wired
in — add `XForgeUITests.swift` to the UI test target and `XForgeTestSupport.swift`
to the app target, then call `XForgeTestSupport.configure()` at app start. The
generated `README.md` beside the sources has the exact steps. Running
`--execute` before this builds an app containing no XForge tests.

`packages/test-core` holds the QA model, planning (risk/testability/hash/shard),
XCUITest + XForgeTestSupport generation, xcresult parsing, failure
classification, bug dedup, visual/accessibility/performance analyzers, and the
orchestrator (behind a `CommandRunner` abstraction — dry-run and spawn-backed).
Test config: `.xforge/test/config.yaml` (§26); a file-backed Figma adapter
(`design-map.yaml` + fixture) keeps planning offline.

Claude commands: `/xforge:test-doctor`, `/xforge:test-plan`,
`/xforge:test-review`, `/xforge:test-a11y`, `/xforge:test-design`, `/xforge:test-run`,
`/xforge:test-status`, `/xforge:test-report`, plus 8 QA agents (`qa-lead`, `environment-agent`,
`test-case-author`, `feature-test-agent`,
`visual/performance/accessibility-analysis-agent`, `bug-triage-agent`).

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
