import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  collectAttachments,
  probeAttachment,
  screenshotAttachments,
  xcresultExportCommand,
  xcresultRootCommand,
  type AttachmentRef,
  type CommandRunner,
  type ProbeScreen,
} from "@xforge/test-core";

/**
 * Pulling artifacts out of an `.xcresult` bundle.
 *
 * XCUITest can only hand data back as attachments inside the result bundle, so
 * both things a run needs afterwards — the accessibility probe's JSON dump and
 * the screenshots — have to be exported with `xcresulttool`. Without this step
 * the probe runs, writes its attachment, and nothing ever reads it: design
 * conformance would report "no probe ran" forever.
 *
 * Every failure here is an environment condition (§4.4): no Xcode, a bundle
 * that never got written, an `xcresulttool` whose output shape changed. So the
 * functions return what they managed to get and never throw — a run must not go
 * red because an artifact could not be extracted.
 */

/** Read a bundle's object graph. Returns undefined when it cannot be parsed. */
async function readBundle(
  runner: CommandRunner,
  bundlePath: string,
): Promise<unknown | undefined> {
  const result = await runner.run(xcresultRootCommand(bundlePath));
  if (result.code !== 0 || result.stdout.trim().length === 0) return undefined;
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return undefined;
  }
}

async function exportAttachment(
  runner: CommandRunner,
  bundlePath: string,
  attachment: AttachmentRef,
  outputPath: string,
): Promise<boolean> {
  await mkdir(dirname(outputPath), { recursive: true });
  const result = await runner.run(
    xcresultExportCommand(bundlePath, attachment.id, outputPath),
  );
  return result.code === 0;
}

export interface ProbeExport {
  screens: ProbeScreen[];
  path: string;
}

/**
 * Export the probe's accessibility dump. This is the input design conformance
 * and live locator reconciliation both consume, so it runs before the matrix.
 */
export async function exportProbeDump(
  runner: CommandRunner,
  bundlePath: string,
  outputPath: string,
): Promise<ProbeExport | undefined> {
  const root = await readBundle(runner, bundlePath);
  if (!root) return undefined;

  const attachment = probeAttachment(collectAttachments(root));
  if (!attachment) return undefined;
  if (!(await exportAttachment(runner, bundlePath, attachment, outputPath))) {
    return undefined;
  }

  try {
    const raw = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return undefined;
    return { screens: raw as ProbeScreen[], path: outputPath };
  } catch {
    return undefined;
  }
}

/**
 * Export every screenshot, filed under the test that produced it so a visual
 * comparison can find the right image later.
 */
export async function exportScreenshots(
  runner: CommandRunner,
  bundlePath: string,
  screensDir: string,
): Promise<string[]> {
  const root = await readBundle(runner, bundlePath);
  if (!root) return [];

  const written: string[] = [];
  for (const attachment of screenshotAttachments(collectAttachments(root))) {
    // `XForgeUITests/test_TC_ALARM_003()` → `TC_ALARM_003`, so screenshots sit
    // beside the case they belong to rather than in one flat pile.
    const caseDir = caseFolder(attachment.testIdentifier);
    const outputPath = join(screensDir, caseDir, safeName(attachment.name));
    if (await exportAttachment(runner, bundlePath, attachment, outputPath)) {
      written.push(outputPath);
    }
  }
  return written;
}

function caseFolder(testIdentifier?: string): string {
  if (!testIdentifier) return "_unattributed";
  const last = basename(testIdentifier).replace(/\(\)$/, "");
  return last.replace(/^test_/, "") || "_unattributed";
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return /\.png$/i.test(cleaned) ? cleaned : `${cleaned}.png`;
}
