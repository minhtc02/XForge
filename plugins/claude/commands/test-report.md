---
description: Summarize an XForge Test run — results, coverage and deduplicated bugs.
argument-hint: "<run-id>"
---

# /xforge:test-report

Present a QA run's results and bug reports.

## Steps

1. Run:

   ```bash
   xforge test report $ARGUMENTS --json
   xforge test bugs $ARGUMENTS --json
   ```

2. Summarize: totals by status, requirement/feature/design coverage, and the
   deduplicated bug list with severity/priority.
3. Every reported bug must carry evidence (screenshot/log/xcresult) and a
   source reference. Present suspected root causes as hypotheses, not facts
   (blueprint §24).

> Phase 1 note: reporting/triage land in Phase 6.
