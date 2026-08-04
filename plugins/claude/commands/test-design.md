---
description: Fill a plan's Figma design references using the Figma MCP, so XForge can check the app against the real design.
argument-hint: "[plan-id]"
---

# /xforge:test-design

Freeze the design references a test plan will be checked against.

XForge's CLI is a plain Node process: it cannot reach the Figma MCP server, but
**you can**. So you fetch, and the CLI reads what you wrote. That keeps
credentials out of the CLI, keeps planning reproducible from a file, and lets
the comparison run later on a machine with no Figma access.

## Steps

1. Ask the CLI which nodes the plan needs:

   ```bash
   xforge test design ${ARGUMENTS:-<plan-id>} --json
   ```

   It writes a template at
   `.xforge/test/design-snapshots/<plan-id>/snapshots.json` and reports the
   nodes still `unresolved`.

2. For each unresolved node, call the Figma MCP:

   - `get_figma_data` with the file key and node id.
   - Take the frame's `absoluteBoundingBox` → `width` / `height`.
   - Take design variables (colour, typography, spacing) → `variables`.

3. Fill the file in. For every node set at minimum `width` and `height` — a node
   with neither is treated as unresolved and simply skipped, never guessed at.
   Set `file_version` to the version Figma reports and `captured_at` to now.
   Leave `source` as `mcp`.

   Optionally add `elements`, keyed by the **accessibility identifier** the app
   uses, to get per-element checks:

   ```json
   "elements": {
     "save-button": { "width": 120, "height": 44 },
     "title-label": { "fontSize": 17, "color": "#1C1C1E" }
   }
   ```

   This is where the most actionable findings come from — "save-button height
   is 32pt; the design says 44pt" rather than "the screen differs by 3%".

4. Confirm nothing is outstanding:

   ```bash
   xforge test design ${ARGUMENTS:-<plan-id>}
   ```

5. Report which nodes you filled and which you could not, and why.

## Rules

- **Never invent a measurement.** A node you cannot read stays unresolved; the
  comparison skips it. A guessed number produces a false bug report, which is
  worse than no check.
- **Do not fetch during a run.** Snapshots are frozen at plan time (§11.4) so a
  design edited mid-run cannot change a test result.
- Record the Figma `version` — it is the evidence for which revision the app was
  judged against.

## What happens next

`xforge test run --execute` compares these measurements against the
accessibility tree the probe captures on the running app. Under the default
policy an element in the design that the app never rendered fails the case;
size and token differences are reported as warnings until the project lowers
`visual.conformance_fails_at` to `major`.
