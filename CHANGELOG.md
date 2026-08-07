# Changelog

All notable changes to XForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added — `xforge test setup`

A project with no UI test target cannot be QA'd at all. XCUITest drives the app
from a separate process through the accessibility APIs, and iOS grants that only
to a bundle whose product type is `com.apple.product-type.bundle.ui-testing` —
an OS boundary, not an Xcode convention, so there is no way to run these tests
from the app target. `test doctor` reported the blocker and every plan stopped
there, leaving the user to click through Xcode.

`xforge test setup` creates the target, the bundle's `Info.plist` and a shared
scheme (`xcodebuild -scheme` cannot see a scheme in `xcuserdata`), then records
what it resolved in the QA config.

It edits `project.pbxproj`, which is the one file where a bad write does not
fail loudly — it makes Xcode refuse to open the project. So: the original is
backed up, the result is verified structurally _before_ it is written and again
after, and anything unexpected restores the backup and reports why. Creating a
target is a much bigger edit than adding a file (build-configuration list, two
build phases, a product reference, `TEST_TARGET_NAME`, an entry in the project's
target list), so every anchor is located explicitly and a missing one refuses
the whole edit rather than writing something half-wired.

`--dry-run` reports what would change. Re-running is a no-op.

`/xforge:test-review` now handles this before it starts reviewing: a missing UI
test target is not a question about the source, it is missing infrastructure,
and no amount of investigating call sites answers it.

### Added — the planner can now be told it is wrong

XForge's test planner reasons from declarations: it sees a screen type and
assumes a user can reach it. An abandoned screen and a live one are identical
from that vantage point, so the planner would generate a confident, internally
consistent plan against code no path presents — every case green, the screen
that actually ships untested. Template cases made it worse: a "create an item,
relaunch, check it persisted" case would be emitted for a screen with nothing to
create.

No amount of better static analysis fixes this. It needs someone who can grep
the repository, read the call sites and judge intent — and since XForge runs
inside Claude Code, that someone is available. What was missing was a way for
their conclusions to reach the plan instead of a side document nobody executes.

- **Screen reachability in the Project Model.** The Swift parser now collects
  type _references_, not just declarations, and `screen_reachability` records
  which screens nothing else mentions. String literals are excluded, so a type
  name inside a log line never makes dead code look reachable; test files are
  excluded too, because a screen only its own test refers to is still
  unreachable in the app.
- **`plan` withholds approval when a case targets an unreferenced screen.** The
  one-command pipeline still runs end to end, but auto-approval stops — a green
  run against dead code is evidence of nothing, and this is exactly the pause
  worth keeping.
- **`xforge test review <plan-id>` / `--apply`, and `/xforge:test-review`.** The
  LLM write-back path. The CLI writes a template plus the specific questions the
  deterministic layer knows it cannot answer; a reviewer (or the Claude command,
  which does the investigation itself) fills in `keep` / `drop` / `retarget` /
  `revise` verdicts; `--apply` merges them into the plan.

  What makes it safe to hand to an agent: any verdict other than `keep` requires
  a rationale and at least one evidence reference, enforced by the schema — an
  agent that cannot say why cannot change the plan. The CLI performs the merge,
  so nothing writes `plan.json` directly and suites, shards and stats stay
  consistent. Every verdict is recorded in the plan itself, so a later reader
  can see which cases were machine-generated and which were overruled, on what
  grounds. Applying a review re-hashes the plan, so a prior approval goes stale
  through the existing mechanism rather than a new one.

  Two refusals: a review written against a different plan hash (its case ids no
  longer mean the same thing), and one that would leave the plan with no cases
  at all — that is a planning failure, and the honest response is to fix the
  inputs and re-plan, not to approve an empty plan that passes.

- Reviewer-added cases inherit risk score, priority and requirement links from
  their feature rather than asserting their own, so the write-back path cannot
  become a route to inventing requirements.
- **`--approve` closes the loop.** `xforge test review <plan-id> --apply
--approve` regenerates the XCUITest sources and approves, so an agent that
  investigated the plan can take it all the way to runnable in one command
  instead of four.

  It approves only if the review answered every question that withheld approval.
  A flagged case left at a bare `keep` is silence, not an answer, and is refused
  with the cases named — auto-approving a review that investigated nothing would
  turn "we do not know whether this tests dead code" into "approved", which is
  worse than the original problem because the doubt stops being visible. A
  `keep` carrying a rationale and evidence passes, and should: the reachability
  check is lexical and misses reflection and storyboards by design, so
  "I checked, it is live" is the expected answer a good share of the time.

  Regeneration is not optional here. After a retarget the emitted Swift still
  drives at the old anchor, and approving sources that disagree with the plan
  they are bound to would defeat the hash binding entirely.

- `TestabilityIssue` gained `subjects`, so a caller can act on an issue without
  parsing its prose.

### Fixed

- A scaffolded navigation graph with no nodes or edges crashed `xforge test
plan` with a Zod error about `edges` — an empty YAML sequence parses as null,
  not `[]`, so the command rejected the file it had just written itself. The
  renderer now emits `nodes: []` / `edges: []`, and the schema treats a blank
  section as empty, which also covers a graph someone edited by hand.

## [Unreleased — documentation trees]

### Changed — documentation input and output are now separate trees

`xforge init` creates two directories instead of one:

- `docs/project/` — **yours**. PRD, specs, design notes. XForge only reads it.
  An existing directory is adopted untouched, so a project already keeping its
  specs there needs no migration.
- `docs/xforge/` — **XForge's**. The generated tree, previously `docs/project/`.

They have to be distinct. When XForge writes into the directory it also reads as
truth, the next run parses its own generated prose into requirements and reports
perfect coverage of them — a model that agrees with itself and has learned
nothing. `xforge doctor` now fails on an overlapping pair and `xforge upgrade`
reports it with the fix, because moving generated files is safe but deciding
where a project keeps its documentation is not the tool's call.

**Upgrading:** run `xforge upgrade`. It flags an `output.root` still pointing at
`docs/project`; change it to `docs/xforge` and re-run `xforge docs`. Your own
documents stay where they are. Nothing is deleted — the old generated files
remain under `docs/project/` until you remove them.

### Added

- **`xforge docs` leads with the project's own documents.** A requirement stated
  in `docs/project/` is intent, and the implementation is measured against it;
  source code still supplies the evidence behind every claim. Previously the
  repository was the only real source and documents were consulted just to decide
  what counted as "documented".
- **`--from-code` / `--from-docs`, and a confirmation prompt.** The two sources
  produce genuinely different documentation, and the configured default is only a
  guess about a given run, so `docs` asks before generating. The prompt appears
  only at a real terminal: under `--json`, a pipe, or in CI the configured
  `generation.docs_source` applies silently, and `--yes` accepts it explicitly.
  Passing both flags is an error rather than a silent precedence rule.
  A `code` run records the choice as an assumption, so a reader of the output can
  tell that it describes what the app does rather than what was specified.
- **`generation.docs_source`** (`project-docs` | `code`) and
  **`sources.project_docs`** in `.xforge/config.yaml`.
- A `project-docs` run that finds no documents warns and says what the output
  actually is, rather than quietly producing a code-derived tree under a label
  that claims otherwise.

### Fixed

- A prompt no longer aborts the run when stdin closes. Ctrl+D used to crash
  `docs` with `Unexpected error: Aborted with Ctrl+D`, and a closed pipe left it
  hanging forever — readline signals the two cases differently. Both now resolve
  to the default, which the caller already had. This also covers `test plan`'s
  feature-selection prompt.
- `xforge dev plan` reads spec facts from `sources.project_docs` instead of
  sweeping `docs/**`, which would now pull XForge's own output into the spec.

## [0.2.0]

### Upgrading an existing project

Run `xforge upgrade` in any project initialized by an earlier version, then
`xforge docs`. The upgrade only ever _adds_: it creates
`.xforge/test/config.yaml` if missing, fills configuration fields still at their
`auto` sentinel with values resolved from the Xcode project, and reports
everything else as an action. It never overwrites a value the project already
set — unlike `init --force`, which regenerates the config and would discard a
hand-edited `features:` map or output language.

Regenerating documentation is safe at any time: manual blocks are preserved and
the model heals itself. Approvals bound to a plan hash go stale by design and
are reported.

### Added

- **Responsive testing** — visual and accessibility cases now run on every
  configured device whose roles match, and optionally across Dynamic Type sizes
  and appearances. Sharding previously picked one best-scoring device, so the
  second device was never used and a layout breaking on the small screen was
  never seen. Functional cases stay on one device. Configure under
  `responsive`; coverage now requires a case to pass on _every_ device.
- **Design conformance** — `xforge test design <plan-id>` freezes the Figma
  references a plan is checked against, then a run compares the frame sizes and
  design tokens against what the accessibility probe measured. Findings name
  the element and the numbers ("save-button height is 32pt; the design says
  44pt") rather than reporting a pixel percentage, and the 44pt HIG tap target
  is enforced independently of the design.

  Severity policy: an element the design has that the app never rendered fails
  the case; size and token deltas are warnings until `visual.conformance_fails_at`
  is lowered to `major`.

  Figma data arrives by MCP first — `/xforge:test-design` has the agent fetch
  and write the snapshot file, keeping credentials out of the CLI and planning
  reproducible from a file. `--rest` uses the Figma REST API with `FIGMA_TOKEN`
  for CI. Every failure path (no token, 404, network error, unfilled node)
  degrades to "no reference" rather than failing a run.

- **Visual regression** — screenshots exported from the result bundles are
  compared against approved baselines with `pngjs` + `pixelmatch`, writing a
  diff image for anything that changed. Baselines are per shard, because the
  same case runs on several devices and a 393pt screen never matches a 375pt
  baseline. A screenshot with no baseline is reported, never auto-approved —
  blessing the current look would bless the bugs already in it; accept
  explicitly with `xforge test run <plan-id> --execute --update-baselines`.
- **`_meta/project-model.json` is the complete model** — the published
  documentation tree stands on its own, so a reader with only `docs/` never has
  to reassemble the core file and three appendices. `.xforge/state/` keeps the
  split form, which is what keeps an agent's read cheap. Set
  `generation.publish_full_model: false` to publish the core instead.
- **iOS entity extraction** — the Canonical Project Model now carries
  `data_models`, `persistence_entities`, `permissions`, `analytics_events`,
  `api_endpoints`, `dependencies`, `test_cases`, `architecture`,
  `accessibility_identifiers`, `capabilities`, `background_modes` and
  `url_schemes`, each evidence-linked to the file and line it came from.
- **`Info.plist` / `*.entitlements` parsing** (`@xforge/core` `ios/plist.ts`) —
  declared privacy permissions, capabilities, background modes and URL schemes
  are now real inputs (blueprint §6.2). Permissions record whether
  `xcrun simctl privacy grant` can pre-authorize them.
- **Documentation tree completed** — `data/{data-models,persistence,migrations}.md`,
  `integrations/{api,notifications,analytics,third-party-services}.md` and
  `quality/{security,accessibility,performance}.md` are generated, and feature
  documents now follow the full blueprint §8 section structure.
- **Fourth traceability report** — "implemented but undocumented" is now
  produced, instead of being declared and always empty.
- **Remaining state files** — `dependency-graph.json`, `feature-map.json`,
  `requirement-map.json` and `generation-state.json` are written under
  `.xforge/state/` (blueprint §19).
- **Incremental `docs sync`** — uses the dependency graph to rewrite only the
  documents a change invalidates, reporting how many were skipped.
- **`symbols` and `assumptions`** are populated; assumptions record what the
  deterministic pipeline had to infer, with confidence.
- **Publishable CLI** — `@xforge/cli` bundles to a single dependency-free file,
  so `npm install -g @xforge/cli` works.
- **XForge Test — assertion hardening** — generated XCUITest code now emits real
  `XCTAssert` calls from a structured `assertions` model. Expectations that
  cannot be mapped to an assertion are surfaced (`XCTSkip`, or `XCTFail` under
  `execution.strict_expectations`) instead of being silently dropped into a
  comment.
- **XForge Test — static locator reconcile** — generated locators are checked
  against the accessibility identifiers actually present in Swift source before
  a plan is produced. Missing locators raise a blocking testability issue;
  dynamically-built identifiers are reported as unresolvable rather than
  missing.

- **`xforge test generate <plan-id>`** — renders a plan into compilable XCUITest
  Swift under `.xforge/test/generated-tests/<plan-id>/`, with an integration
  README. Until now the generator had no caller at all, so no generated test
  ever reached a project. Blocked cases are skipped rather than emitted.
- **`xforge test navigation [--init]`** — inspects, and scaffolds, the
  navigation graph. Reports which features are reachable at the configured
  confidence gate before any planning or building happens.
- **State buckets + `simctl` orchestration** — OS-level state (fresh install,
  privacy grants, appearance, Dynamic Type, deep links, push payloads) is
  declared per case, shards are grouped by `(feature, state)`, and the commands
  run in a new `apply-state` worker phase. `-only-testing:` support makes the
  narrower invocations possible. `simctl privacy` refuses services Apple does
  not expose (camera, notifications) instead of emitting a command that fails
  mid-run; those get a generated `addUIInterruptionMonitor` instead.
- **Navigation graph + BFS** — three provenance tiers (`explicit` 0.9 /
  `derived` 0.6 / `probed` 1.0) with a confidence gate; the shortest path
  becomes each case's navigation prefix. A feature no confident path reaches
  generates no cases and is reported, never given a guessed path. The graph is
  hashed into `PlanInputs` so an approval cannot outlive it.
- **Accessibility probe + artifact extraction** — `XForgeProbeTests.swift`
  dumps the live element tree as a JSON attachment; `results/artifacts.ts`
  wraps `xcresulttool` to pull attachments out of a result bundle. The probe
  runs after the single build and before the shard matrix, gated by
  `execution.probe_before_run` (`off` / `auto` / `always`, default `auto` —
  it only runs when static reconciliation left locators unresolvable).
- **Visual comparison loop closed** — `analysis/visual-compare.ts` produces the
  `VisualMetrics` that `classifyVisual` has always expected but nothing
  computed. Uses `pngjs` + `pixelmatch`, both pure JavaScript, so the CLI stays
  a single bundled file; `sharp` was deliberately not used (native binding,
  unbundleable, and XCUITest screenshots are already PNG).
- **`verdict_source` on `TestExecution`** — records whether a status came from
  the test process, the visual agent or the probe. Escalation is one-way:
  `PASS → FAIL_VISUAL` is allowed with evidence, a downgrade never is.

### Fixed

- `xforge docs` no longer prompts interactively when a PRD is missing. The
  prompt corrupted `--json` output, ignored `--non-interactive`, and could exit
  `0` having written no files.
- The Swift parser no longer treats `//` inside a string literal as the start of
  a comment, which silently truncated lines containing URLs.
- Nested plist dictionaries (e.g. `CFBundleURLTypes`) no longer swallow the keys
  they contain.

## [0.1.0]

- Initial XForge toolkit: `init`, `doctor`, `docs`, `docs sync`, `docs check`,
  `inspect`, plus the `test` and `dev` module command groups.
