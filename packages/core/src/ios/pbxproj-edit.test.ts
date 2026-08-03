import { describe, expect, it } from "vitest";
import {
  addFileToTarget,
  referencesFile,
  usesSynchronizedGroups,
  verifyPbxproj,
} from "./pbxproj-edit.js";

/**
 * A corrupted `project.pbxproj` makes a project unopenable, so these lock in
 * the two behaviours that matter more than the happy path: the edit is
 * structurally valid, and anything unexpected declines instead of guessing.
 */

const PBXPROJ = `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {

/* Begin PBXBuildFile section */
		AAAAAAAAAAAAAAAAAAAAAA01 /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = BBBBBBBBBBBBBBBBBBBBBB01 /* AppDelegate.swift */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		BBBBBBBBBBBBBBBBBBBBBB01 /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppDelegate.swift; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
		CCCCCCCCCCCCCCCCCCCCCC01 = {
			isa = PBXGroup;
			children = (
				DDDDDDDDDDDDDDDDDDDDDD01 /* MyAppUITests */,
			);
			sourceTree = "<group>";
		};
		DDDDDDDDDDDDDDDDDDDDDD01 /* MyAppUITests */ = {
			isa = PBXGroup;
			children = (
				BBBBBBBBBBBBBBBBBBBBBB01 /* AppDelegate.swift */,
			);
			path = MyAppUITests;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		EEEEEEEEEEEEEEEEEEEEEE01 /* MyApp */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				FFFFFFFFFFFFFFFFFFFFFF01 /* Sources */,
			);
			name = MyApp;
			productType = "com.apple.product-type.application";
		};
		EEEEEEEEEEEEEEEEEEEEEE02 /* MyAppUITests */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				FFFFFFFFFFFFFFFFFFFFFF02 /* Sources */,
			);
			name = MyAppUITests;
			productType = "com.apple.product-type.bundle.ui-testing";
		};
/* End PBXNativeTarget section */

/* Begin PBXSourcesBuildPhase section */
		FFFFFFFFFFFFFFFFFFFFFF01 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
				AAAAAAAAAAAAAAAAAAAAAA01 /* AppDelegate.swift in Sources */,
			);
		};
		FFFFFFFFFFFFFFFFFFFFFF02 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
			);
		};
/* End PBXSourcesBuildPhase section */
	};
}
`;

describe("addFileToTarget", () => {
  it("wires a file into the target's group and sources phase", () => {
    const result = addFileToTarget({
      content: PBXPROJ,
      targetName: "MyAppUITests",
      fileName: "XForgeUITests.swift",
      relativePath: "XForgeUITests.swift",
    });
    const out = result.content;
    expect(result.skipped).toBeUndefined();
    expect(out).toBeDefined();

    // All four edges must exist, or Xcode will not compile the file.
    expect(out).toMatch(
      /isa = PBXBuildFile; fileRef = [0-9A-F]{24} \/\* XForgeUITests\.swift \*\//,
    );
    expect(out).toMatch(
      /isa = PBXFileReference;.*path = XForgeUITests\.swift;/,
    );
    // Group membership.
    const groupBlock =
      /MyAppUITests \*\/ = \{\s*isa = PBXGroup;[\s\S]*?\};/.exec(out!)?.[0];
    expect(groupBlock).toContain("XForgeUITests.swift");
    // Sources phase membership — and specifically the *UI test* target's
    // phase (02), not the app's (01). Scope to the section so the id's
    // appearance inside `buildPhases = (…)` is not mistaken for the definition.
    const sourcesSection = out!
      .split("/* Begin PBXSourcesBuildPhase section */")[1]!
      .split("/* End")[0]!;
    const [appPhase, uiTestPhase] = sourcesSection.split(
      "FFFFFFFFFFFFFFFFFFFFFF02",
    );
    expect(appPhase).not.toContain("XForgeUITests.swift");
    expect(uiTestPhase).toContain("XForgeUITests.swift in Sources");
  });

  it("keeps the project structurally valid", () => {
    const before = verifyPbxproj(PBXPROJ, { targets: 2 });
    expect(before.ok).toBe(true);

    const out = addFileToTarget({
      content: PBXPROJ,
      targetName: "MyAppUITests",
      fileName: "XForgeUITests.swift",
      relativePath: "XForgeUITests.swift",
    }).content!;
    expect(verifyPbxproj(out, { targets: 2 })).toEqual({ ok: true });
  });

  it("is idempotent — a referenced file is left alone", () => {
    const once = addFileToTarget({
      content: PBXPROJ,
      targetName: "MyAppUITests",
      fileName: "XForgeUITests.swift",
      relativePath: "XForgeUITests.swift",
    }).content!;
    const twice = addFileToTarget({
      content: once,
      targetName: "MyAppUITests",
      fileName: "XForgeUITests.swift",
      relativePath: "XForgeUITests.swift",
    });
    expect(twice.skipped).toBe("already-present");
    expect(twice.content).toBeUndefined();
  });

  it("adds each of two files exactly once", () => {
    let content = PBXPROJ;
    for (const name of ["XForgeUITests.swift", "XForgeTestSupport.swift"]) {
      const result = addFileToTarget({
        content,
        targetName: "MyAppUITests",
        fileName: name,
        relativePath: name,
      });
      expect(result.content, name).toBeDefined();
      content = result.content!;
    }
    expect(verifyPbxproj(content, { targets: 2 }).ok).toBe(true);
    for (const name of ["XForgeUITests.swift", "XForgeTestSupport.swift"]) {
      const refs = content.match(
        new RegExp(`isa = PBXFileReference;[^\\n]*${name}`, "g"),
      );
      expect(refs, name).toHaveLength(1);
    }
  });

  it("declines when the target does not exist", () => {
    const result = addFileToTarget({
      content: PBXPROJ,
      targetName: "NoSuchTarget",
      fileName: "X.swift",
      relativePath: "X.swift",
    });
    expect(result.skipped).toBe("target-not-found");
    expect(result.content).toBeUndefined();
  });

  it("declines when the target has no Sources phase", () => {
    const noPhase = PBXPROJ.replace(
      "				FFFFFFFFFFFFFFFFFFFFFF02 /* Sources */,\n",
      "",
    );
    const result = addFileToTarget({
      content: noPhase,
      targetName: "MyAppUITests",
      fileName: "X.swift",
      relativePath: "X.swift",
    });
    expect(result.skipped).toBe("no-sources-phase");
  });

  it("generates ids that do not collide with existing ones", () => {
    const out = addFileToTarget({
      content: PBXPROJ,
      targetName: "MyAppUITests",
      fileName: "XForgeUITests.swift",
      relativePath: "XForgeUITests.swift",
    }).content!;
    const ids = out.match(/\b[0-9A-F]{24}\b/g) ?? [];
    const unique = new Set(ids);
    // Every id appears at least twice (declaration + reference), but the two
    // new ids must not duplicate an existing object's id.
    expect(unique.size).toBeGreaterThan(6);
  });
});

describe("verifyPbxproj", () => {
  it("rejects unbalanced braces", () => {
    expect(verifyPbxproj(PBXPROJ + "{", { targets: 2 })).toEqual({
      ok: false,
      reason: "unbalanced braces",
    });
  });

  it("rejects a project that lost a target", () => {
    const result = verifyPbxproj(PBXPROJ, { targets: 3 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("target count changed");
  });

  it("rejects a missing section", () => {
    const broken = PBXPROJ.replace("/* Begin PBXFileReference section */", "");
    expect(verifyPbxproj(broken, { targets: 2 }).ok).toBe(false);
  });
});

describe("usesSynchronizedGroups", () => {
  it("detects Xcode 16 folder-backed targets, where no edit is needed", () => {
    expect(usesSynchronizedGroups(PBXPROJ)).toBe(false);
    expect(
      usesSynchronizedGroups(
        PBXPROJ.replace(
          "PBXGroup section",
          "PBXFileSystemSynchronizedRootGroup section",
        ),
      ),
    ).toBe(true);
  });
});

describe("referencesFile", () => {
  it("finds an existing reference", () => {
    expect(referencesFile(PBXPROJ, "AppDelegate.swift")).toBe(true);
    expect(referencesFile(PBXPROJ, "Nope.swift")).toBe(false);
  });
});
