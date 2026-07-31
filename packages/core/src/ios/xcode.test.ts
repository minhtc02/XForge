import { describe, expect, it } from "vitest";
import {
  PRODUCT_TYPE,
  detectSharedSchemes,
  detectUserSchemes,
  detectXcodeSetup,
  parsePbxprojBundleIds,
  parsePbxprojTargets,
} from "./xcode.js";
import type { ScannedFile } from "../discovery/scanner.js";

const PBXPROJ = `// !$*UTF8*$!
{
	objects = {
/* Begin PBXNativeTarget section */
		A1 /* MyApp */ = {
			isa = PBXNativeTarget;
			name = MyApp;
			productType = "com.apple.product-type.application";
		};
		A2 /* MyAppTests */ = {
			isa = PBXNativeTarget;
			name = MyAppTests;
			productType = "com.apple.product-type.bundle.unit-test";
		};
		A3 /* MyAppUITests */ = {
			isa = PBXNativeTarget;
			name = MyAppUITests;
			productType = "com.apple.product-type.bundle.ui-testing";
		};
/* End PBXNativeTarget section */
/* Begin XCBuildConfiguration section */
		B1 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.acme.myapp;
			};
		};
		B2 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.acme.myapp.MyAppUITests;
			};
		};
		B3 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = "$(inherited).generated";
			};
		};
/* End XCBuildConfiguration section */
	};
}
`;

function file(path: string): ScannedFile {
  return { path, size: 1, sensitive: false };
}

describe("parsePbxprojTargets", () => {
  it("reads every native target with its product type", () => {
    const targets = parsePbxprojTargets(PBXPROJ);
    expect(targets).toEqual([
      { name: "MyApp", productType: PRODUCT_TYPE.application },
      { name: "MyAppTests", productType: PRODUCT_TYPE.unitTest },
      { name: "MyAppUITests", productType: PRODUCT_TYPE.uiTest },
    ]);
  });

  it("returns nothing for a file with no target section", () => {
    expect(parsePbxprojTargets("{ objects = {}; }")).toEqual([]);
  });
});

describe("parsePbxprojBundleIds", () => {
  it("collects literal identifiers and skips build variables", () => {
    expect(parsePbxprojBundleIds(PBXPROJ)).toEqual([
      "com.acme.myapp",
      "com.acme.myapp.MyAppUITests",
    ]);
  });
});

describe("scheme detection", () => {
  const files = [
    file("MyApp.xcodeproj/xcshareddata/xcschemes/MyApp.xcscheme"),
    file("MyApp.xcodeproj/xcshareddata/xcschemes/MyApp-Staging.xcscheme"),
    file(
      "MyApp.xcodeproj/xcuserdata/alice.xcuserdatad/xcschemes/Scratch.xcscheme",
    ),
  ];

  it("separates shared schemes from per-user ones", () => {
    expect(detectSharedSchemes(files)).toEqual(["MyApp", "MyApp-Staging"]);
    expect(detectUserSchemes(files)).toEqual(["Scratch"]);
  });
});

describe("detectXcodeSetup", () => {
  const baseFiles = [
    file("MyApp.xcodeproj/xcshareddata/xcschemes/MyApp.xcscheme"),
    file("MyApp.xcodeproj/xcshareddata/xcschemes/Other.xcscheme"),
  ];

  it("resolves scheme, targets and the app's bundle id", () => {
    const setup = detectXcodeSetup({
      files: baseFiles,
      pbxproj: [{ path: "MyApp.xcodeproj/project.pbxproj", content: PBXPROJ }],
      workspaces: ["MyApp.xcworkspace"],
      projects: ["MyApp.xcodeproj"],
    });
    expect(setup.scheme).toBe("MyApp");
    expect(setup.appTarget).toBe("MyApp");
    expect(setup.uiTestTarget).toBe("MyAppUITests");
    expect(setup.unitTestTarget).toBe("MyAppTests");
    // The UI test bundle's id must never be mistaken for the app's.
    expect(setup.appBundleId).toBe("com.acme.myapp");
    expect(setup.workspace).toBe("MyApp.xcworkspace");
    expect(setup.unresolved).toEqual([]);
  });

  it("prefers a shared scheme named after the app target", () => {
    const setup = detectXcodeSetup({
      files: [
        file("MyApp.xcodeproj/xcshareddata/xcschemes/Aaa.xcscheme"),
        file("MyApp.xcodeproj/xcshareddata/xcschemes/MyApp.xcscheme"),
      ],
      pbxproj: [{ path: "p", content: PBXPROJ }],
      projects: ["MyApp.xcodeproj"],
    });
    // Alphabetically "Aaa" comes first; the app-target match must win.
    expect(setup.scheme).toBe("MyApp");
  });

  it("never picks a per-user scheme, and says why", () => {
    const setup = detectXcodeSetup({
      files: [
        file(
          "MyApp.xcodeproj/xcuserdata/alice.xcuserdatad/xcschemes/MyApp.xcscheme",
        ),
      ],
      pbxproj: [{ path: "p", content: PBXPROJ }],
      projects: ["MyApp.xcodeproj"],
    });
    expect(setup.scheme).toBeUndefined();
    expect(setup.userSchemes).toEqual(["MyApp"]);
    expect(setup.unresolved.join(" ")).toContain("Shared");
  });

  it("prefers a literal Info.plist bundle id over build settings", () => {
    const setup = detectXcodeSetup({
      files: baseFiles,
      pbxproj: [{ path: "p", content: PBXPROJ }],
      projects: ["MyApp.xcodeproj"],
      infoPlistBundleId: "com.acme.fromplist",
    });
    expect(setup.appBundleId).toBe("com.acme.fromplist");
  });

  it("reports what it could not resolve instead of guessing", () => {
    const setup = detectXcodeSetup({ files: [], projects: [] });
    expect(setup.scheme).toBeUndefined();
    expect(setup.appBundleId).toBeUndefined();
    expect(setup.unresolved.sort()).toEqual([
      "app_bundle_id",
      "scheme",
      "ui_test_target",
      "workspace/project",
    ]);
  });
});
