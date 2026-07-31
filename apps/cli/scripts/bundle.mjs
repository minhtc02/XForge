#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Bundle the CLI into a single self-contained ESM file (blueprint §5.1, §26
 * Phase 8, MVP criterion §27.1).
 *
 * The workspace packages (`@xforge/core`, `@xforge/shared`, ...) are private and
 * resolved through pnpm's `workspace:*` protocol, so a published package cannot
 * depend on them from the registry. Bundling them — together with the handful of
 * third-party runtime deps — makes `npm install -g @xforge/cli` install exactly
 * one artifact with no runtime resolution surprises.
 */

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outFile = join(pkgRoot, "bundle", "xforge.mjs");

await mkdir(dirname(outFile), { recursive: true });

const result = await build({
  entryPoints: [join(pkgRoot, "src", "index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Node built-ins stay external; everything else is inlined.
  packages: "bundle",
  banner: {
    // The shebang comes from `src/index.ts` and esbuild keeps it at the very
    // top, so the banner must not add another one.
    js: [
      // globby (via fast-glob) reaches for `require` in a few code paths; ESM
      // bundles have none, so provide one built from this module's URL.
      "import { createRequire as __xforgeCreateRequire } from 'node:module';",
      "const require = __xforgeCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

await chmod(outFile, 0o755);

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
await writeFile(
  join(pkgRoot, "bundle", ".gitignore"),
  "# Build output — regenerate with `pnpm --filter @xforge/cli bundle`.\n*\n",
);
process.stderr.write(
  `Bundled CLI → ${outFile} (${(bytes / 1024).toFixed(0)} KB)\n`,
);
