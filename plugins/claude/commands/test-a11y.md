---
description: Add the accessibility identifiers a test plan needs — decide which element each locator belongs to by reading the view, then approve the edits one at a time.
argument-hint: "<plan-id>"
---

# /xforge:test-a11y

Give the plan's locators something real to find.

XCUITest locates elements by `accessibilityIdentifier`. When a plan targets one
the source never declares, every case using it fails by timeout — and triage
reads a timeout as a product bug, so the report blames the app for a defect in
the test. `xforge test plan` already detects this (the
`locator-not-found-in-source` deviation). What it cannot do is decide **which
element** the identifier belongs on.

That decision is why you are here, and it is not a formality: an identifier on
the wrong element does not fail. Put it on the `VStack` instead of the `Button`
inside it and the test finds an element, taps it, passes, and exercises nothing —
for as long as the test exists. A _missing_ identifier fails loudly on the first
run. So a wrong placement is strictly worse than no placement, and "I was not
sure so I picked the outer view" is the one answer that must never happen.

## Steps

1. Get the proposal:

   ```bash
   xforge test a11y $ARGUMENTS --json
   ```

   Each entry in `.xforge/test/plans/<plan-id>/a11y-proposal.json` has:

   - `locator` — the identifier the tests will look for.
   - `affected_cases` and `intent` — what the cases _do_ with it (`tap`,
     `assert screen-is`). This is the requirement the site has to satisfy.
   - `site` — a suggestion, present only when it was unambiguous. `basis` says
     why: `label-match` (the element's label matches the locator) or
     `only-unidentified-element` (nothing else it could be — weaker).
   - `candidates` — the other unidentified elements found. Containers are never
     listed, by design.
   - `approved: false` on every entry. Nothing is written until you change that.

   No `site` means the deterministic layer refused to guess: two files each
   offered a match, or no label resembled the locator. That is not a gap to fill
   in mechanically — it is the case that needs source reading.

2. **Read the view before approving anything.** On a plan with many entries,
   delegate the per-screen reading to the `accessibility-analysis-agent` —
   one pass per screen, each returning the element that satisfies the entry's
   `intent` (or "could not settle" — a valid answer). The deterministic layer
   refuses to guess exactly when a screen root is wanted (`assert screen-is`
   with no label match), and that is the case this agent exists for.

   Whether you read the view yourself or via the agent, check three things:

   - **Is it the element under test?** Match it against `intent`. A locator a
     case _taps_ must be on the control that responds to a tap, not the row, cell
     or stack containing it. A locator a case asserts `screen-is` on is a _screen
     root_ — usually the outermost content view of that screen, which is one of
     the few times a container is right. If `intent` says `tap` and the only
     candidate is a `Text`, something is wrong with the plan, not the source.
   - **Is the identifier stable?** It must not come from an array index. Derived
     from data (`"lesson-\(lesson.id)"`) is right; positional (`"row-2"`) breaks
     the moment content changes. Note that a dynamic identifier is reported as
     _unresolvable_, not missing, so the plan will not claim it is absent.
   - **Does the element appear once?** If the view builds several from a
     `ForEach`, a literal identifier on it lands on every copy, and
     `XCUIElement` matching becomes ambiguous. Use an interpolated identifier and
     retarget the case, or pick the specific element.

3. **Set the site.** For each entry you are confident about:

   ```json
   {
     "locator": "save-button",
     "approved": true,
     "basis": "manual",
     "site": {
       "file": "MyApp/Features/Home/HomeScreen.swift",
       "element_line": 10,
       "element": "Button(\"Continue\") {",
       "kind": "Button",
       "anchor_line": 12,
       "anchor_text": "            }",
       "indent": "            "
     }
   }
   ```

   The easiest correct move is to copy an entry out of `candidates` into `site` —
   the anchor fields are already right. If you write them yourself:
   `anchor_line` is the line the modifier goes **after** (where the element
   expression's brackets balance, not where it starts), and `anchor_text` must be
   that line verbatim. A mismatch is refused rather than applied at a guessed
   offset.

   Leave `approved: false` on anything you could not settle. An unapproved entry
   is honest; a wrongly-approved one is invisible.

4. Apply:

   ```bash
   xforge test a11y $ARGUMENTS --apply --json
   ```

   The CLI re-reads each anchor, inserts one `.accessibilityIdentifier(...)`
   line, and re-parses the file to confirm it can read the identifier back. A
   refusal leaves the file untouched. Applied entries drop out of the proposal;
   the rest stay, so approving more and re-running is the normal loop.

5. **Re-scan and re-plan.** The identifiers exist now, but the plan reconciled
   before the edit and still records the deviation:

   ```bash
   xforge docs
   xforge test plan --level smoke
   ```

6. Report per locator: which element you put it on and why that element, which
   ones you left alone and what you could not determine. Tell the user their
   product source changed and point at `git diff` for the files involved.

## Rules

- **Never approve an entry you did not read the source for.** The proposal is a
  starting point; `basis: "label-match"` means a string matched, not that the
  element is right.
- **Never put an identifier on a container to make a locator resolve.** If the
  case wants something the screen does not have, the case is wrong — fix it with
  `/xforge:test-review`, not with an identifier that makes the failure silent.
- **One identifier, one element.** Do not reuse the same literal on two elements
  to satisfy two locators; the match becomes ambiguous and the failure looks
  random.
- **Do not edit the views by hand here.** Let `--apply` write them: it verifies
  the anchor, verifies the result, and reverts on surprise. A hand edit gets none
  of that and is easy to place off by a line.
- **The identifier is not `#if DEBUG`-guarded**, deliberately: it changes no
  behaviour, and stripping it from Release builds would mean the tests that pass
  locally time out on the build a TestFlight run exercises. If the user asks for
  a DEBUG-only identifier, say what it costs.
- Adding an identifier for a screen root is fine and often necessary — that is
  what `assert screen-is` needs. Adding one for an interaction is not the same
  job; keep the two straight.
