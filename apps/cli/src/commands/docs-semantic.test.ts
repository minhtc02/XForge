import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AlreadyExistsError,
  NotFoundError,
  ValidationError,
} from "@xforge/shared";
import { createLogger } from "@xforge/shared";
import { runInit } from "./init.js";
import { runDocs } from "./docs.js";
import { runDocsSemantic } from "./docs-semantic.js";
import type { CliContext } from "../context.js";

/**
 * The write-back loop for the LLM-written feature sections. The property that
 * matters: nothing an agent writes reaches a generated document without a
 * source ref the model recognizes — and what survives validation survives
 * every later regeneration.
 */

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

async function scaffold(dir: string): Promise<void> {
  await mkdir(join(dir, "App/Features/Alarm"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmView.swift"),
    'import SwiftUI\nstruct AlarmView: View { var body: some View { Text("a") } }\n',
  );
  await writeFile(
    join(dir, "App/Features/Alarm/AlarmViewModel.swift"),
    "import Foundation\nfinal class AlarmViewModel: ObservableObject {}\n",
  );
}

async function initAndGenerate(dir: string): Promise<void> {
  await scaffold(dir);
  await runInit(ctx(dir), {});
  await runDocs(ctx(dir), {});
}

async function modelFeatureId(dir: string): Promise<string> {
  const model = JSON.parse(
    await readFile(join(dir, ".xforge/state/project-model.json"), "utf8"),
  ) as { features: Array<{ id: string }> };
  const first = model.features[0];
  if (!first) throw new Error("fixture produced no features");
  return first.id;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-semantic-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("xforge docs semantic", () => {
  it("refuses to template without a project model", async () => {
    await scaffold(root);
    await runInit(ctx(root), {});
    await expect(runDocsSemantic(ctx(root), {})).rejects.toThrow(NotFoundError);
  });

  it("writes a template covering every feature", async () => {
    await initAndGenerate(root);
    const result = await runDocsSemantic(ctx(root), {});
    expect(result.mode).toBe("template");
    expect(result.features.length).toBeGreaterThan(0);
    const raw = JSON.parse(await readFile(result.templatePath, "utf8"));
    const featureId = await modelFeatureId(root);
    expect(raw.features[featureId]._files.length).toBeGreaterThan(0);
  });

  it("keeps an existing template unless forced", async () => {
    await initAndGenerate(root);
    await runDocsSemantic(ctx(root), {});
    await expect(runDocsSemantic(ctx(root), {})).rejects.toThrow(
      AlreadyExistsError,
    );
    const rebuilt = await runDocsSemantic(ctx(root), { force: true });
    expect(existsSync(rebuilt.templatePath)).toBe(true);
  });

  it("refuses to apply before a template exists", async () => {
    await initAndGenerate(root);
    await expect(runDocsSemantic(ctx(root), { apply: true })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects a documented claim whose source the model does not know", async () => {
    await initAndGenerate(root);
    const templateResult = await runDocsSemantic(ctx(root), {});
    const featureId = await modelFeatureId(root);
    const raw = JSON.parse(await readFile(templateResult.templatePath, "utf8"));
    raw.features[featureId].user_flows = {
      status: "documented",
      text: "The user opens the list and taps add.",
      sources: [{ file: "Sources/Hallucinated.swift" }],
    };
    await writeFile(
      templateResult.templatePath,
      JSON.stringify(raw, null, 2) + "\n",
    );
    await expect(runDocsSemantic(ctx(root), { apply: true })).rejects.toThrow(
      ValidationError,
    );
    expect(
      existsSync(join(root, ".xforge/state/semantic-enrichment.json")),
    ).toBe(false);
  });

  it("merges validated enrichment and regenerates the feature doc", async () => {
    await initAndGenerate(root);
    const featureId = await modelFeatureId(root);
    const docPath = join(root, ".xforge/docs/features", `${featureId}.md`);
    const before = await readFile(docPath, "utf8");
    expect(before).toContain("cần phân tích ngữ nghĩa");

    const templateResult = await runDocsSemantic(ctx(root), {});
    const raw = JSON.parse(await readFile(templateResult.templatePath, "utf8"));
    const sourceFile = raw.features[featureId]._files[0] as string;
    raw.features[featureId].user_flows = {
      status: "documented",
      text: "Người dùng mở danh sách báo thức và chạm nút thêm.",
      sources: [{ file: sourceFile, line: 2 }],
    };
    raw.features[featureId].edge_cases = {
      status: "not_applicable",
      note: "không có trạng thái biên",
    };
    await writeFile(
      templateResult.templatePath,
      JSON.stringify(raw, null, 2) + "\n",
    );

    const result = await runDocsSemantic(ctx(root), { apply: true });

    expect(result.mode).toBe("apply");
    expect(result.applied?.documentedSections).toBe(1);
    expect(result.applied?.regeneratedDocuments).toContain(
      `features/${featureId}.md`,
    );
    const doc = await readFile(docPath, "utf8");
    expect(doc).toContain("Người dùng mở danh sách báo thức");
    expect(doc).toContain(`${sourceFile}:2`);
    expect(doc).toContain("Không áp dụng");
  });

  it("keeps applied enrichment across a full regeneration", async () => {
    await initAndGenerate(root);
    const featureId = await modelFeatureId(root);
    const templateResult = await runDocsSemantic(ctx(root), {});
    const raw = JSON.parse(await readFile(templateResult.templatePath, "utf8"));
    const sourceFile = raw.features[featureId]._files[0] as string;
    raw.features[featureId].business_rules = {
      status: "documented",
      text: "Báo thức lặp lại hàng ngày.",
      sources: [{ file: sourceFile }],
    };
    await writeFile(
      templateResult.templatePath,
      JSON.stringify(raw, null, 2) + "\n",
    );
    await runDocsSemantic(ctx(root), { apply: true });

    await runDocs(ctx(root), {});

    const doc = await readFile(
      join(root, ".xforge/docs/features", `${featureId}.md`),
      "utf8",
    );
    expect(doc).toContain("Báo thức lặp lại hàng ngày.");
  });

  it("prefills a rebuilt template with what was already applied", async () => {
    await initAndGenerate(root);
    const featureId = await modelFeatureId(root);
    const templateResult = await runDocsSemantic(ctx(root), {});
    const raw = JSON.parse(await readFile(templateResult.templatePath, "utf8"));
    const sourceFile = raw.features[featureId]._files[0] as string;
    raw.features[featureId].error_handling = {
      status: "documented",
      text: "Lỗi được hiển thị bằng alert.",
      sources: [{ file: sourceFile }],
    };
    await writeFile(
      templateResult.templatePath,
      JSON.stringify(raw, null, 2) + "\n",
    );
    await runDocsSemantic(ctx(root), { apply: true });

    const rebuilt = await runDocsSemantic(ctx(root), { force: true });
    const filled = JSON.parse(await readFile(rebuilt.templatePath, "utf8"));
    expect(filled.features[featureId].error_handling.status).toBe("documented");
    expect(filled.features[featureId].user_flows.status).toBe("unknown");
  });
});
