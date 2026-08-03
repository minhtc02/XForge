# Changelog

All notable changes to XForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

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
