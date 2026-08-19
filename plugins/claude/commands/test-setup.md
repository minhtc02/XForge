---
description: Make a project QA-able — UI test target, shared scheme, test-support file and its call site.
---

# /xforge:test-setup

One-time project preparation for XForge Test. This is one of only two commands
that touch **product** source, and its edit is deliberately narrow: a four-line
`XForgeTestSupport.configure()` call inside `#if DEBUG` in the `@main` App.
Everything else it creates is test infrastructure.

## Steps

1. Preview first — nothing is written:

   ```bash
   xforge test setup --dry-run --json
   ```

   Read what would change: the UI test target, the shared scheme, the
   test-support file, and the exact call site edit. If the CLI reports it
   cannot recognise the app's entry point, it refuses rather than guessing —
   tell the user what it needs.

2. Show the user the planned product-source edit (the `configure()` call) and
   get explicit consent before writing — this edit is only acceptable because
   it is narrow and individually approvable.
3. Apply:

   ```bash
   xforge test setup --json
   ```

   Pass `--target <name>` only when the user wants a specific UI test target
   name.

4. Verify with `xforge test doctor --json` and report what was created. The
   project is now ready for `/xforge:test-plan`.
