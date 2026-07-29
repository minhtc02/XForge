import { describe, expect, it } from "vitest";
import {
  isSafeToDelete,
  isSafeWorktreePath,
  isValidDevBranch,
  planWorktrees,
} from "./index.js";

const ctx = { projectRoot: "/repo", worktreeRootRel: ".xforge/worktrees" };

describe("isSafeWorktreePath", () => {
  it("accepts a path inside the worktree root", () => {
    expect(isSafeWorktreePath(ctx, ".xforge/worktrees/XFDEV-1/ui").safe).toBe(
      true,
    );
  });
  it("rejects the main checkout root", () => {
    expect(isSafeWorktreePath(ctx, ".").safe).toBe(false);
    expect(isSafeWorktreePath(ctx, "").reason).toBe("empty-path");
  });
  it("rejects paths outside the worktree root", () => {
    expect(isSafeWorktreePath(ctx, "Sources/Alarm").reason).toBe(
      "outside-worktree-root",
    );
  });
  it("rejects path traversal escaping the repo", () => {
    const r = isSafeWorktreePath(ctx, ".xforge/worktrees/../../etc/passwd");
    expect(r.safe).toBe(false);
  });
  it("rejects absolute paths outside the repo", () => {
    expect(isSafeWorktreePath(ctx, "/etc/passwd").safe).toBe(false);
  });
});

describe("isSafeToDelete", () => {
  it("allows deleting a managed worktree", () => {
    expect(isSafeToDelete(ctx, ".xforge/worktrees/XFDEV-1/ui").safe).toBe(true);
  });
  it("never allows deleting the worktree root itself", () => {
    expect(isSafeToDelete(ctx, ".xforge/worktrees").safe).toBe(false);
  });
});

describe("isValidDevBranch", () => {
  it("accepts xforge/dev/<change>/<group>", () => {
    expect(isValidDevBranch("xforge/dev/XFDEV-025/ui")).toBe(true);
  });
  it("rejects main and arbitrary branches", () => {
    expect(isValidDevBranch("main")).toBe(false);
    expect(isValidDevBranch("feature/x")).toBe(false);
  });
  it("rejects dangerous ref characters", () => {
    expect(isValidDevBranch("xforge/dev/XFDEV-1/..")).toBe(false);
    expect(isValidDevBranch("xforge/dev/XFDEV-1/ui..lock")).toBe(false);
  });
});

describe("planWorktrees", () => {
  it("plans one worktree per group plus an integration worktree", () => {
    const result = planWorktrees({
      changeId: "XFDEV-025",
      base: "main",
      worktreeRootRel: ".xforge/worktrees",
      projectRoot: "/repo",
      groups: [
        {
          id: "domain",
          name: "Domain",
          depends_on: [],
          tasks: [],
          shares_files: false,
        },
        {
          id: "ui",
          name: "UI",
          depends_on: ["domain"],
          tasks: [],
          shares_files: false,
        },
      ],
    });
    expect(result.worktrees).toHaveLength(3);
    expect(result.integrationBranch).toBe("xforge/dev/XFDEV-025/integration");
    expect(result.worktrees.find((w) => w.is_integration)).toBeDefined();
    expect(result.issues).toHaveLength(0);
    for (const w of result.worktrees) {
      expect(w.path.startsWith(".xforge/worktrees/")).toBe(true);
    }
  });
});
