---
description: Investigate a test plan against the real source — drop cases aimed at dead code, retarget wrong screens, add the ones that matter — and write the verdicts back into the plan.
argument-hint: "<plan-id>"
---

# /xforge:test-review

Check whether a generated test plan tests the app that actually ships, then
write your conclusions back into the plan.

XForge's planner reasons from declarations. It sees a screen type and assumes a
user can reach it, so an abandoned screen and a live one look identical to it —
which is how a plan ends up confidently testing dead code while the real home
screen goes untested. It also emits template cases (`create-item` →
`relaunch-app`) for screens that may have nothing to create.

Neither is fixable by better static analysis. It needs someone who can grep the
repository, read the call sites and judge intent. That is you. This command is
the channel for your answers to reach the plan instead of a side document nobody
runs.

## Steps

1. Get the template and the open questions:

   ```bash
   xforge test review $ARGUMENTS --json
   ```

   The `questions` array is derived from things the deterministic layer knows it
   cannot decide: screens nothing refers to, template actions it could not
   validate, critical testability issues. Treat each as a task, not a prompt.

2. **Handle the missing-infrastructure questions first — they are not review
   questions.** Some blockers are answered by building something, not by reading
   source:

   - `missing-ui-test-target` — the project has no UI test bundle. XCUITest
     drives the app from a separate process through the accessibility APIs, and
     iOS grants that only to a target whose product type is
     `com.apple.product-type.bundle.ui-testing`. There is no way to run these
     tests from the app target; it is an OS boundary, not a convention. Fix it:

     ```bash
     xforge test setup --dry-run   # show what would change
     xforge test setup             # create target + Info.plist + shared scheme
     ```

     This edits `project.pbxproj`. It backs the file up first, verifies the
     result structurally before and after writing, and restores the backup on
     any surprise — but tell the user it happened and point them at
     `git diff -- '*.pbxproj'`. Never hand-edit that file yourself; a lost
     cross-reference makes Xcode refuse to open the project.

   - `missing-accessibility-identifiers` / `locator-not-found-in-source` — the
     app is missing the identifiers the tests locate elements by. That has its
     own command, because each edit lands in product source and needs its own
     approval:

     ```bash
     xforge test a11y <plan-id>            # proposal: one entry per locator
     xforge test a11y <plan-id> --apply    # writes only the approved entries
     ```

     Use `/xforge:test-a11y` to do it properly — the judgement it needs is which
     element each locator belongs to, and the rule is: the element under test,
     never its container. Then re-run `xforge docs` so the model sees them.

   After `test setup`, re-plan: `xforge test plan --level smoke`. The plan you
   were reviewing was built when the project could not be tested at all, so its
   case ids no longer mean the same thing.

3. **Investigate each remaining question against the source.** Do not answer
   from the Project Model — that model is what produced the question. Use `Grep`
   for the type name and read what you find:

   - Only match is the declaration → the screen is unreachable; every case
     aimed at it is testing dead code.
   - Matches in a navigation destination, a factory, a tab builder, a
     `NavigationLink`, a router table → it is live; record how it is reached.
   - Matches only in a string, a comment or a `#Preview` → not a real entry
     point. Say so explicitly, because it looks like a use.

   Watch for reflection, storyboard/XIB instantiation and string-keyed
   registration: the static check cannot see any of them, so a screen with zero
   textual references may still be live. If you cannot tell, mark it
   `reachable: false` only when the evidence supports it — otherwise leave the
   case alone and say why in the summary.

4. **Find the real entry point.** When a feature's screen turns out to be dead,
   the interesting question is what the user _does_ see instead. Locate the live
   screen, and prefer retargeting a case to it over dropping the case outright —
   a dropped case leaves a coverage hole, a retargeted one tests the shipped
   app.

5. Fill in `.xforge/test/plans/<plan-id>/review.json`:

   - `keep` — the case is sound.
   - `drop` — it tests something unreachable or an action the screen does not
     have. A template case with no object in the app is dropped, not repaired.
   - `retarget` — right intent, wrong screen. Supply `new_anchor` (an
     accessibility identifier that genuinely exists, or one you list under
     `required_identifiers`).
   - `revise` — right screen, wrong steps or assertions too weak to fail.

   Every verdict other than `keep` **requires** a `rationale` and at least one
   `evidence` entry naming the file you read. The schema rejects the review
   otherwise, deliberately: a change you cannot justify should not reach a test
   plan.

   Use `added_cases` for coverage the planner missed — anchored in real source,
   with evidence. An added case inherits its feature's risk score, priority and
   requirement links from the plan; you supply behaviour, not provenance, so you
   cannot invent a requirement link.

   Use `required_identifiers` for `accessibilityIdentifier` values the app needs
   before these cases can work. **Record them here; add them elsewhere.** They
   are carried into the plan and become proposals in `xforge test a11y`, where
   each edit gets its own approval — a plan merge is not the place to change
   product code.

6. Apply. If the user asked you to take it all the way to a run, add
   `--approve`:

   ```bash
   xforge test review $ARGUMENTS --apply --json
   # or, to close the loop in one step:
   xforge test review $ARGUMENTS --apply --approve --json
   ```

   The CLI performs the merge — you never write `plan.json`. It keeps suites,
   shards and stats consistent, records every verdict in the plan for later
   readers, and deletes the approval, because the plan it authorized no longer
   exists.

   `--approve` regenerates the XCUITest sources (mandatory after a retarget: the
   old Swift still points at the old anchors) and approves — **but only if the
   review answered every question that withheld approval**. A flagged case left
   at `keep` with no rationale and no evidence is silence, not an answer, and
   the CLI refuses: approving there would convert "we do not know whether this
   tests dead code" into "approved", which is worse than the original problem
   because the doubt becomes invisible.

   So if you could not settle a question, say so and leave it — do not write a
   hollow `keep` to get past the gate. A `keep` **with** rationale and evidence
   ("reached via `NavigationLink` in `Router.swift:42`") is a real answer and
   passes.

7. Report: what you dropped and why, what you retargeted and to where, what you
   added, and which questions you could not settle. If `--approve` refused,
   relay `unresolved` verbatim — that list is the work still outstanding.

   Then run it, if that is what the user asked for:

   ```bash
   xforge test run <plan-id>             # dry run: records the commands
   xforge test run <plan-id> --execute   # needs Xcode + sources in the targets
   ```

   Without `--approve`, approval stays the user's to give:

   ```bash
   xforge test generate <plan-id> --force
   xforge test approve <plan-id>
   ```

## Rules

- **Evidence or no verdict.** "This looks like dead code" is not a finding;
  "the only match for `CategoryDetailScreen` is its declaration at
  `Views/CategoryDetailScreen.swift:12`" is.
- **Never approve past a question you could not answer.** `--approve` enforces
  this, but do not try to satisfy it with an empty `keep`. Leaving a question
  open and saying so is a good outcome; hiding it is not.
- **Never edit product source here.** Missing identifiers get recorded in
  `required_identifiers` and are added by `/xforge:test-a11y`, one approved edit
  at a time. A review changes the plan; it does not change the app on the way
  past.
- **Do not delete screens.** If a screen is dead, say so and let the user
  decide; an orphan today may be a feature landing next week.
- **A review that drops everything is refused** by the CLI, and rightly: that is
  a planning failure, not a review. Fix the inputs — navigation graph, feature
  scope, identifiers — and re-plan instead.
- Prefer retargeting to dropping, and dropping to inventing. A plan with four
  honest cases beats one with twelve that pass against code nobody runs.
