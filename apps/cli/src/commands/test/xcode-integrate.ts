import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  addFileToTarget,
  usesSynchronizedGroups,
  verifyPbxproj,
} from "@xforge/core";
import { GENERATED_FILES, generatedFilePath } from "@xforge/test-core";

/**
 * Put the generated sources where Xcode will build them.
 *
 * Two routes, preferred in order:
 *
 *  1. **Copy into the target's folder.** Xcode 16 folder-backed targets pick up
 *     anything on disk, so no project edit is needed at all. Always safest.
 *  2. **Edit `project.pbxproj`.** Necessary for older projects. A bad edit makes
 *     the project unopenable, so this path backs the file up, verifies the
 *     result structurally, and restores the backup if anything looks wrong.
 *
 * Either way the operation is idempotent and reports exactly what it did.
 */

export interface IntegrateInput {
  projectRoot: string;
  planId: string;
  /** `.xcodeproj` path, relative to the project root. */
  xcodeProject?: string;
  uiTestTarget?: string;
  appTarget?: string;
}

export interface IntegrateResult {
  /** How the sources were wired in. */
  method: "synchronized-folder" | "pbxproj" | "none";
  /** Files copied into the project tree, relative to the root. */
  copied: string[];
  /** Targets each file was added to, for the pbxproj route. */
  added: Array<{ file: string; target: string }>;
  /** Why nothing (or only part) happened. */
  warnings: string[];
  /** Backup written before editing, when the pbxproj route was taken. */
  backup?: string;
}

/** Files to place, and which target each belongs to. */
function placements(
  input: IntegrateInput,
): Array<{ key: keyof typeof GENERATED_FILES; target?: string }> {
  return [
    { key: "uiTests", target: input.uiTestTarget },
    { key: "testSupport", target: input.appTarget },
  ];
}

export async function integrateWithXcode(
  input: IntegrateInput,
): Promise<IntegrateResult> {
  const { projectRoot, xcodeProject } = input;
  const result: IntegrateResult = {
    method: "none",
    copied: [],
    added: [],
    warnings: [],
  };

  if (!xcodeProject) {
    result.warnings.push(
      "No .xcodeproj detected — add the generated sources to your targets by hand.",
    );
    return result;
  }
  const pbxPath = join(projectRoot, xcodeProject, "project.pbxproj");
  if (!existsSync(pbxPath)) {
    result.warnings.push(`No project.pbxproj at ${xcodeProject}`);
    return result;
  }

  const original = await readFile(pbxPath, "utf8");
  const targetCount = (original.match(/isa = PBXNativeTarget;/g) ?? []).length;

  // Route 1: folder-backed targets need only the file on disk.
  if (usesSynchronizedGroups(original)) {
    result.method = "synchronized-folder";
    for (const { key, target } of placements(input)) {
      if (!target) continue;
      const dir = await findTargetFolder(projectRoot, target);
      if (!dir) {
        result.warnings.push(
          `Could not find a folder named "${target}" to place ${GENERATED_FILES[key]} in.`,
        );
        continue;
      }
      const dest = join(dir, GENERATED_FILES[key]);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(generatedFilePath(projectRoot, input.planId, key), dest);
      result.copied.push(relative(projectRoot, dest));
    }
    return result;
  }

  // Route 2: edit the project. Copy the sources next to the project first, so
  // the reference path resolves, then wire each one in.
  let content = original;
  const pending: Array<{ file: string; target: string }> = [];

  for (const { key, target } of placements(input)) {
    if (!target) {
      result.warnings.push(
        `No target known for ${GENERATED_FILES[key]} — add it by hand.`,
      );
      continue;
    }
    const fileName = GENERATED_FILES[key];
    const dir = (await findTargetFolder(projectRoot, target)) ?? projectRoot;
    const dest = join(dir, fileName);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(generatedFilePath(projectRoot, input.planId, key), dest);
    result.copied.push(relative(projectRoot, dest));

    const edit = addFileToTarget({
      content,
      targetName: target,
      fileName,
      relativePath: fileName,
    });
    if (edit.skipped === "already-present") {
      // The file is referenced already; the copy above refreshed its contents.
      continue;
    }
    if (!edit.content) {
      result.warnings.push(
        `Could not add ${fileName} to ${target}: ${edit.detail ?? edit.skipped}. Add it in Xcode.`,
      );
      continue;
    }
    content = edit.content;
    pending.push({ file: fileName, target });
  }

  if (pending.length === 0) {
    result.method = "pbxproj";
    return result;
  }

  // Verify before writing; a structurally broken project is unopenable.
  const check = verifyPbxproj(content, { targets: targetCount });
  if (!check.ok) {
    result.warnings.push(
      `Refused to modify project.pbxproj: ${check.reason}. Add the sources in Xcode.`,
    );
    return result;
  }

  const backup = `${pbxPath}.xforge-backup`;
  await writeFile(backup, original, "utf8");
  await writeFile(pbxPath, content, "utf8");

  // Re-read what landed on disk; if it does not verify, restore immediately.
  const written = await readFile(pbxPath, "utf8");
  const after = verifyPbxproj(written, { targets: targetCount });
  if (!after.ok) {
    await writeFile(pbxPath, original, "utf8");
    result.warnings.push(
      `project.pbxproj failed verification after writing (${after.reason}); restored from backup.`,
    );
    return result;
  }

  result.method = "pbxproj";
  result.added = pending;
  result.backup = relative(projectRoot, backup);
  return result;
}

/** Find the directory a target's sources live in, by folder name. */
async function findTargetFolder(
  projectRoot: string,
  target: string,
): Promise<string | undefined> {
  const seen = new Set<string>();
  const queue: string[] = [projectRoot];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (
        name.startsWith(".") ||
        name === "node_modules" ||
        name.endsWith(".xcodeproj") ||
        name.endsWith(".xcworkspace") ||
        name === "DerivedData"
      ) {
        continue;
      }
      const full = join(dir, name);
      if (basename(full) === target) return full;
      queue.push(full);
    }
  }
  return undefined;
}
