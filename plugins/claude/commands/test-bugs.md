---
description: List deduplicated bugs from a QA run and triage them with the bug-triage agent.
argument-hint: "[run-id]"
---

# /xforge:test-bugs

Turn a run's failures into a deduplicated bug list, then triage.

## Steps

1. List the bugs (latest run by default):

   ```bash
   xforge test bugs ${ARGUMENTS} --json
   ```

2. Deduplication is deterministic (the CLI does it); severity and root-cause
   judgement are not. Delegate the triage of each open bug to the
   `bug-triage-agent`: it reads the failing case, the run artifacts under
   `.xforge/test/runs/<run-id>/` (screenshots, diffs, probe attachments) and
   the relevant source, and returns a severity + suspected-cause verdict with
   evidence.
3. Keep infrastructure/environment failures out of the bug list — a simulator
   boot failure is not a product defect. Ask the `environment-agent` when the
   boundary is unclear.
4. Report: confirmed product bugs with severity and evidence first, then
   flaky/infra items separately. Present root causes as hypotheses, not
   verdicts, unless the evidence is conclusive.
