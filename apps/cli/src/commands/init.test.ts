import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlreadyExistsError, createLogger } from "@xforge/shared";
import { loadConfig } from "@xforge/core";
import { runInit } from "./init.js";
import type { CliContext } from "../context.js";

let root: string;

function ctx(projectRoot: string): CliContext {
  return {
    projectRoot,
    json: true,
    logger: createLogger({ level: "error", sink: () => {} }),
  };
}

async function scaffoldIosFixture(dir: string): Promise<void> {
  await mkdir(join(dir, "Sources/Alarm"), { recursive: true });
  await mkdir(join(dir, "Tests/AlarmTests"), { recursive: true });
  await mkdir(join(dir, ".specify/memory"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(
    join(dir, "Package.swift"),
    'import PackageDescription\nlet package = Package(name: "Cuckoo")\n',
  );
  await writeFile(
    join(dir, "Sources/Alarm/AlarmView.swift"),
    'import SwiftUI\nstruct AlarmView: View { var body: some View { Text("a") } }\n',
  );
  await writeFile(
    join(dir, "Sources/Alarm/AlarmScheduler.swift"),
    "import UserNotifications\nfinal class AlarmScheduler {}\n",
  );
  await writeFile(
    join(dir, "Tests/AlarmTests/AlarmSchedulerTests.swift"),
    "import XCTest\nfinal class AlarmSchedulerTests: XCTestCase {}\n",
  );
  await writeFile(
    join(dir, ".specify/memory/constitution.md"),
    "# Constitution\n- No force unwrap\n",
  );
  // A secret file that must never be ingested.
  await writeFile(
    join(dir, "GoogleService-Info.plist"),
    "SECRET_API_KEY=abc123",
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xforge-init-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runInit", () => {
  it("detects an iOS project and writes config + state + output dirs", async () => {
    await scaffoldIosFixture(root);
    const result = await runInit(ctx(root), {});

    expect(result.detection.platform).toBe("iOS");
    expect(result.detection.ui).toContain("SwiftUI");
    expect(result.detection.tests).toContain("XCTest");
    expect(result.detection.hasSpecKit).toBe(true);

    expect(existsSync(join(root, ".xforge/config.yaml"))).toBe(true);
    expect(existsSync(join(root, ".xforge/state"))).toBe(true);
    expect(existsSync(join(root, "docs/project/_meta"))).toBe(true);

    const cfg = await loadConfig(root);
    expect(cfg.project.profile).toBe("ios-swift");
    expect(cfg.project.name).toBe("Cuckoo");
  });

  it("does not read secret files into config", async () => {
    await scaffoldIosFixture(root);
    await runInit(ctx(root), {});
    const configText = await readFile(
      join(root, ".xforge/config.yaml"),
      "utf8",
    );
    expect(configText).not.toContain("abc123");
  });

  it("refuses to overwrite an existing config without --force", async () => {
    await scaffoldIosFixture(root);
    await runInit(ctx(root), {});
    await expect(runInit(ctx(root), {})).rejects.toBeInstanceOf(
      AlreadyExistsError,
    );
  });

  it("overwrites with --force", async () => {
    await scaffoldIosFixture(root);
    await runInit(ctx(root), {});
    const result = await runInit(ctx(root), { force: true });
    expect(result.createdConfig).toBe(true);
  });
});
