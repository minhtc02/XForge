---
description: Bring a project initialized by an older XForge up to date (never overwrites your settings).
---

# /xforge:upgrade

Bring an older project current. `upgrade` only ever _adds_: it fills `auto`
sentinels from the Xcode project, relocates output roots still sitting at
legacy defaults under `.xforge/`, and reports everything else as an action.
It never overwrites a value the project set — `init --force` is the wrong tool
here because it would discard hand edits.

## Steps

1. Preview first (writes nothing):

   ```bash
   xforge upgrade --dry-run --json
   ```

2. Read the JSON result:

   - `filled` — `auto` Xcode fields this run resolved.
   - `movedRoots` — legacy output locations consolidated under `.xforge/`
     (docs tree, QA runs). Generated artifacts are safe to relocate.
   - `unresolved` — fields the user must fill by hand (`xcodebuild -list`).
   - `actions` — things the upgrade cannot do itself, each with the command
     that does.

3. Apply:

   ```bash
   xforge upgrade --json
   ```

4. Walk the `actions` with the user: stale plan approvals need re-planning,
   missing `.gitignore` entries need appending, and an overlapping docs
   input/output pair needs a human decision about where the project keeps its
   documentation.
