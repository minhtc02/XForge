---
description: Inspect (or scaffold) the navigation graph the planner uses for BFS screen paths.
---

# /xforge:test-navigation

The planner walks screens via a navigation graph. XForge scaffolds it from the
Project Model, but the graph is a **user-editable** file — edges the parser
cannot prove (deep links, programmatic navigation, conditional flows) are
yours to add.

## Steps

1. Inspect the current graph:

   ```bash
   xforge test navigation --json
   ```

2. When no graph exists, scaffold it from the model:

   ```bash
   xforge test navigation --init --json
   ```

   Pass `--force` only to rebuild over an existing graph — it discards
   hand-added edges, so confirm with the user first.

3. Review the scaffolded edges against the app's real navigation. Add missing
   edges to `.xforge/test/navigation.yaml` by hand where the parser could not
   see them; the BFS paths in generated tests are only as good as this graph.
4. Report screens with no inbound edges — those are the ones `test plan` will
   later withhold approval for.
