import { describe, expect, it } from "vitest";
import { createUiTestTarget } from "./pbxproj-target.js";
import { verifyPbxproj } from "./pbxproj-edit.js";
import { parsePbxprojTargets } from "./xcode.js";

/**
 * Creating a target is the most dangerous edit XForge makes: a pbxproj that
 * loses a cross-reference does not fail loudly, it makes Xcode refuse to open
 * the project. So these check the structure that has to be right, and — just as
 * important — that every unexpected input is refused rather than half-applied.
 */

/** A minimal but structurally complete single-target project. */
function appOnlyProject(): string {
  return `// !$*UTF8*$!
{
	archiveVersion = 1;
	objectVersion = 56;
	objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
		AAAAAAAAAAAAAAAAAAAAAA01 /* MyApp.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; path = MyApp.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
		BBBBBBBBBBBBBBBBBBBBBB01 /* Products */ = {
			isa = PBXGroup;
			children = (
				AAAAAAAAAAAAAAAAAAAAAA01 /* MyApp.app */,
			);
			name = Products;
			sourceTree = "<group>";
		};
		BBBBBBBBBBBBBBBBBBBBBB02 = {
			isa = PBXGroup;
			children = (
				BBBBBBBBBBBBBBBBBBBBBB01 /* Products */,
			);
			sourceTree = "<group>";
		};
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
		CCCCCCCCCCCCCCCCCCCCCC01 /* MyApp */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = DDDDDDDDDDDDDDDDDDDDDD01 /* Build configuration list for PBXNativeTarget "MyApp" */;
			buildPhases = (
				EEEEEEEEEEEEEEEEEEEEEE01 /* Sources */,
			);
			name = MyApp;
			productName = MyApp;
			productReference = AAAAAAAAAAAAAAAAAAAAAA01 /* MyApp.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */
/* Begin PBXProject section */
		FFFFFFFFFFFFFFFFFFFFFF01 /* Project object */ = {
			isa = PBXProject;
			attributes = {
				TargetAttributes = {
					CCCCCCCCCCCCCCCCCCCCCC01 = {
						CreatedOnToolsVersion = 15.0;
					};
				};
			};
			mainGroup = BBBBBBBBBBBBBBBBBBBBBB02;
			productRefGroup = BBBBBBBBBBBBBBBBBBBBBB01 /* Products */;
			targets = (
				CCCCCCCCCCCCCCCCCCCCCC01 /* MyApp */,
			);
		};
/* End PBXProject section */
/* Begin PBXResourcesBuildPhase section */
/* End PBXResourcesBuildPhase section */
/* Begin PBXSourcesBuildPhase section */
		EEEEEEEEEEEEEEEEEEEEEE01 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
			);
		};
/* End PBXSourcesBuildPhase section */
/* Begin XCBuildConfiguration section */
		DDDDDDDDDDDDDDDDDDDDDD02 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.acme.myapp;
			};
			name = Debug;
		};
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
		DDDDDDDDDDDDDDDDDDDDDD01 /* Build configuration list for PBXNativeTarget "MyApp" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				DDDDDDDDDDDDDDDDDDDDDD02 /* Debug */,
			);
		};
/* End XCConfigurationList section */
	};
	rootObject = FFFFFFFFFFFFFFFFFFFFFF01 /* Project object */;
}
`;
}

const input = {
  targetName: "MyAppUITests",
  appTargetName: "MyApp",
  bundleId: "com.acme.myapp.uitests",
  sourceDir: "MyAppUITests",
};

describe("createUiTestTarget", () => {
  it("produces a project Xcode would still open", () => {
    const result = createUiTestTarget({ content: appOnlyProject(), ...input });
    expect(result.skipped).toBeUndefined();
    const content = result.content!;

    // Braces balanced, sections intact, and exactly one target more than before.
    expect(verifyPbxproj(content, { targets: 2 })).toEqual({ ok: true });
  });

  it("creates a target the OS will accept as a UI test bundle", () => {
    // This product type is the whole point: iOS only lets a bundle drive
    // another process through the accessibility APIs when it carries it.
    const content = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;

    const targets = parsePbxprojTargets(content);
    const uiTest = targets.find((t) => t.name === "MyAppUITests");
    expect(uiTest?.productType).toBe(
      "com.apple.product-type.bundle.ui-testing",
    );
  });

  it("binds the test bundle to the app under test", () => {
    // Without TEST_TARGET_NAME the bundle builds but has no app to launch.
    const content = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;
    expect(content).toContain("TEST_TARGET_NAME = MyApp;");
    expect(content).toContain("TestTargetID = CCCCCCCCCCCCCCCCCCCCCC01;");
  });

  it("registers the target everywhere the project references it from", () => {
    // A target missing from any one of these is the classic "Xcode opens but
    // the scheme is empty" failure.
    const content = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;

    expect(content).toMatch(/targets = \(\n\s+\S+ \/\* MyAppUITests \*\//);
    expect(content).toContain("MyAppUITests.xctest */,");
    expect(content).toContain("productReference =");
    expect(content).toMatch(/buildConfigurationList = \S+ .*MyAppUITests/);
  });

  it("gives the target both build phases it needs", () => {
    const content = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;
    const target =
      /MyAppUITests \*\/ = \{[\s\S]*?buildPhases = \(([\s\S]*?)\);/.exec(
        content,
      );
    expect(target?.[1]).toContain("Sources");
    expect(target?.[1]).toContain("Resources");
  });

  it("is idempotent — a project that already has one is left alone", () => {
    const first = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;
    const second = createUiTestTarget({ content: first, ...input });
    expect(second.skipped).toBe("already-present");
    expect(second.content).toBeUndefined();
  });

  it("refuses when the app target does not exist", () => {
    const result = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
      appTargetName: "NoSuchApp",
    });
    expect(result.skipped).toBe("app-target-not-found");
    expect(result.content).toBeUndefined();
  });

  it("refuses a project with no Project object rather than guessing", () => {
    const broken = appOnlyProject().replace("/* Project object */", "/* x */");
    const result = createUiTestTarget({ content: broken, ...input });
    expect(result.skipped).toBe("no-project-object");
  });

  it("refuses a project with no Products group", () => {
    const broken = appOnlyProject().replace(
      "BBBBBBBBBBBBBBBBBBBBBB01 /* Products */ = {\n\t\t\tisa = PBXGroup;",
      "BBBBBBBBBBBBBBBBBBBBBB01 /* Products */ = {\n\t\t\tisa = PBXOther;",
    );
    const result = createUiTestTarget({ content: broken, ...input });
    expect(result.skipped).toBe("no-products-group");
  });

  it("mints the same ids on a repeat run", () => {
    // A rolled-back edit must not leave the next attempt minting different ids,
    // or a half-applied change would accumulate duplicate objects.
    const a = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;
    const b = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
    }).content!;
    expect(a).toBe(b);
  });

  it("carries the development team through when the project has one", () => {
    const result = createUiTestTarget({
      content: appOnlyProject(),
      ...input,
      developmentTeam: "ABCDE12345",
    });
    expect(result.content).toContain("DEVELOPMENT_TEAM = ABCDE12345;");
  });
});
