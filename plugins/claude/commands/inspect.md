---
description: Inspect the Canonical Project Model (project, features, requirements, evidence, technologies).
argument-hint: "[project|features|requirements|evidence|technologies]"
---

# /xforge:inspect

Read and explain a slice of the Canonical Project Model.

## Steps

1. Run (default target is `project`):

   ```bash
   xforge inspect ${ARGUMENTS:-project} --json
   ```

2. Present the returned data clearly. For features/requirements, show status and
   confidence. For evidence, show the file + line references.
3. Do not invent entries that are not in the model. If the model is empty,
   suggest running `/xforge:docs` first.
