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

2. **Investigate each question against the source.** Do not answer from the
   Project Model — that model is what produced the question. Use `Grep` for the
   type name and read what you find:

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

3. **Find the real entry point.** When a feature's screen turns out to be dead,
   the interesting question is what the user _does_ see instead. Locate the live
   screen, and prefer retargeting a case to it over dropping the case outright —
   a dropped case leaves a coverage hole, a retargeted one tests the shipped
   app.

4. Fill in `.xforge/test/plans/<plan-id>/review.json`:

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
   before these cases can work. **Record them; do not add them.** Editing
   product source is not this command's job.

5. Apply:

   ```bash
   xforge test review $ARGUMENTS --apply --json
   ```

   The CLI performs the merge — you never write `plan.json` directly. It keeps
   suites, shards and stats consistent, records every verdict in the plan for
   later readers, and deletes the approval, because the plan it authorized no
   longer exists.

6. Report: what you dropped and why, what you retargeted and to where, what you
   added, and which questions you could not settle. Then:

   ```bash
   xforge test generate <plan-id> --force
   xforge test approve <plan-id>
   ```

   Approval is the user's consent. Tell them what changed and let them approve;
   do not approve on their behalf unless they asked you to.

## Rules

- **Evidence or no verdict.** "This looks like dead code" is not a finding;
  "the only match for `CategoryDetailScreen` is its declaration at
  `Views/CategoryDetailScreen.swift:12`" is.
- **Never edit product source here.** Missing identifiers are recorded for the
  user, not added by you. XForge changes test artifacts, not the app.
- **Do not delete screens.** If a screen is dead, say so and let the user
  decide; an orphan today may be a feature landing next week.
- **A review that drops everything is refused** by the CLI, and rightly: that is
  a planning failure, not a review. Fix the inputs — navigation graph, feature
  scope, identifiers — and re-plan instead.
- Prefer retargeting to dropping, and dropping to inventing. A plan with four
  honest cases beats one with twelve that pass against code nobody runs.
