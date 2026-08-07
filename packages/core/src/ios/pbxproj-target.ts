import {
  findObjectByName,
  insertIntoList,
  insertIntoSection,
  makeObjectId,
} from "./pbxproj-internals.js";

/**
 * Creating a UI test target in `project.pbxproj`.
 *
 * This is a bigger edit than adding a file, and correspondingly more dangerous:
 * a native target needs a build-configuration list, two build phases, a product
 * reference, a `TEST_TARGET_NAME` pointing at the app, and an entry in the
 * project's target list. Miss one and Xcode refuses to open the project.
 *
 * Why it is worth doing at all: XCUITest drives the app from a *separate*
 * process through the accessibility APIs, and iOS only grants that to a bundle
 * whose product type is `com.apple.product-type.bundle.ui-testing`. There is no
 * way to run these tests from the app target — not a convention, an OS
 * boundary. So a project without one cannot be QA'd, and the target has to come
 * from somewhere.
 *
 * The same rules as {@link addFileToTarget} apply, harder:
 *
 *  - **Refuse rather than guess.** Every anchor is located explicitly. Anything
 *    unexpected returns a reason, never a best effort.
 *  - **Pure.** Returns new content; the caller backs up, verifies and rolls
 *    back. Nothing here writes to disk.
 *  - **Idempotent.** An existing UI test target is left alone.
 */

export interface CreateUiTestTargetInput {
  content: string;
  /** Name for the new target, e.g. `MyAppUITests`. */
  targetName: string;
  /** The application target under test — XCUITest needs it by name. */
  appTargetName: string;
  /** Bundle identifier for the test bundle. */
  bundleId: string;
  /** Folder the sources live in, relative to the project dir. */
  sourceDir: string;
  /** Deployment target to match the app's, e.g. `17.0`. */
  deploymentTarget?: string;
  /** Development team, when the project sets one. */
  developmentTeam?: string;
  /** Swift version to declare, defaults to 5.0. */
  swiftVersion?: string;
}

export interface CreateUiTestTargetResult {
  content?: string;
  skipped?:
    | "already-present"
    | "app-target-not-found"
    | "no-project-object"
    | "no-products-group"
    | "unparseable";
  detail?: string;
  /** Ids minted for the new objects, for the caller's report. */
  created?: {
    targetId: string;
    productRefId: string;
  };
}

/** The product type that grants a bundle permission to drive another process. */
const UI_TEST_PRODUCT_TYPE = "com.apple.product-type.bundle.ui-testing";

export function createUiTestTarget(
  input: CreateUiTestTargetInput,
): CreateUiTestTargetResult {
  const {
    content,
    targetName,
    appTargetName,
    bundleId,
    sourceDir,
    deploymentTarget = "15.0",
    swiftVersion = "5.0",
  } = input;

  if (content.includes(UI_TEST_PRODUCT_TYPE)) {
    return { skipped: "already-present" };
  }

  const appTarget = findObjectByName(content, appTargetName, "PBXNativeTarget");
  if (!appTarget) {
    return {
      skipped: "app-target-not-found",
      detail: `No PBXNativeTarget named "${appTargetName}" to test against`,
    };
  }

  // The PBXProject object owns the target list and the project-wide config.
  const projectMatch =
    /([0-9A-Fa-f]{24})\s*\/\*\s*Project object\s*\*\/\s*=\s*\{/.exec(content);
  if (!projectMatch) {
    return {
      skipped: "no-project-object",
      detail: "No PBXProject 'Project object' to attach the target to",
    };
  }
  const projectId = projectMatch[1]!;

  // Products group holds the .xctest product reference.
  const productsGroup = findObjectByName(content, "Products", "PBXGroup");
  if (!productsGroup) {
    return {
      skipped: "no-products-group",
      detail: "No Products PBXGroup for the .xctest product reference",
    };
  }

  const seed = targetName;
  const targetId = makeObjectId(content, seed, "target");
  const productRefId = makeObjectId(content, seed, "product");
  const sourcesPhaseId = makeObjectId(content, seed, "sources");
  const resourcesPhaseId = makeObjectId(content, seed, "resources");
  const configListId = makeObjectId(content, seed, "configlist");
  const debugConfigId = makeObjectId(content, seed, "debug");
  const releaseConfigId = makeObjectId(content, seed, "release");
  const groupId = makeObjectId(content, seed, "group");

  let next = content;
  const fail = (): CreateUiTestTargetResult => ({
    skipped: "unparseable",
    detail: "A required pbxproj section was missing; nothing was changed",
  });

  // 1. The product: <name>.xctest, owned by the build system.
  next = insertIntoSection(
    next,
    "PBXFileReference",
    `\t\t${productRefId} /* ${targetName}.xctest */ = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = ${targetName}.xctest; sourceTree = BUILT_PRODUCTS_DIR; };`,
  );
  if (next === content) return fail();

  // 2. A group for the sources, so Xcode shows them in the navigator.
  const before2 = next;
  next = insertIntoSection(
    next,
    "PBXGroup",
    [
      `\t\t${groupId} /* ${targetName} */ = {`,
      "\t\t\tisa = PBXGroup;",
      "\t\t\tchildren = (",
      "\t\t\t);",
      `\t\t\tpath = ${sourceDir};`,
      '\t\t\tsourceTree = "<group>";',
      "\t\t};",
    ].join("\n"),
  );
  if (next === before2) return fail();

  // 3. Build phases. UI tests need Sources; Resources keeps Xcode happy when
  //    someone later adds a fixture file.
  const before3 = next;
  next = insertIntoSection(
    next,
    "PBXSourcesBuildPhase",
    [
      `\t\t${sourcesPhaseId} /* Sources */ = {`,
      "\t\t\tisa = PBXSourcesBuildPhase;",
      "\t\t\tbuildActionMask = 2147483647;",
      "\t\t\tfiles = (",
      "\t\t\t);",
      "\t\t\trunOnlyForDeploymentPostprocessing = 0;",
      "\t\t};",
    ].join("\n"),
  );
  if (next === before3) return fail();

  next = insertIntoSection(
    next,
    "PBXResourcesBuildPhase",
    [
      `\t\t${resourcesPhaseId} /* Resources */ = {`,
      "\t\t\tisa = PBXResourcesBuildPhase;",
      "\t\t\tbuildActionMask = 2147483647;",
      "\t\t\tfiles = (",
      "\t\t\t);",
      "\t\t\trunOnlyForDeploymentPostprocessing = 0;",
      "\t\t};",
    ].join("\n"),
  );

  // 4. Build settings. TEST_TARGET_NAME is what makes this a UI test bundle
  //    bound to an app rather than a free-floating one.
  const settings = (configName: string): string =>
    [
      `\t\t${configName === "Debug" ? debugConfigId : releaseConfigId} /* ${configName} */ = {`,
      "\t\t\tisa = XCBuildConfiguration;",
      "\t\t\tbuildSettings = {",
      "\t\t\t\tALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES;",
      "\t\t\t\tCODE_SIGN_STYLE = Automatic;",
      "\t\t\t\tCURRENT_PROJECT_VERSION = 1;",
      ...(input.developmentTeam
        ? [`\t\t\t\tDEVELOPMENT_TEAM = ${input.developmentTeam};`]
        : []),
      "\t\t\t\tGENERATE_INFOPLIST_FILE = YES;",
      `\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = ${deploymentTarget};`,
      "\t\t\t\tMARKETING_VERSION = 1.0;",
      `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`,
      '\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";',
      "\t\t\t\tSWIFT_EMIT_LOC_STRINGS = NO;",
      `\t\t\t\tSWIFT_VERSION = ${swiftVersion};`,
      '\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";',
      `\t\t\t\tTEST_TARGET_NAME = ${appTargetName};`,
      "\t\t\t};",
      `\t\t\tname = ${configName};`,
      "\t\t};",
    ].join("\n");

  const before4 = next;
  next = insertIntoSection(next, "XCBuildConfiguration", settings("Release"));
  next = insertIntoSection(next, "XCBuildConfiguration", settings("Debug"));
  if (next === before4) return fail();

  const before5 = next;
  next = insertIntoSection(
    next,
    "XCConfigurationList",
    [
      `\t\t${configListId} /* Build configuration list for PBXNativeTarget "${targetName}" */ = {`,
      "\t\t\tisa = XCConfigurationList;",
      "\t\t\tbuildConfigurations = (",
      `\t\t\t\t${debugConfigId} /* Debug */,`,
      `\t\t\t\t${releaseConfigId} /* Release */,`,
      "\t\t\t);",
      "\t\t\tdefaultConfigurationIsVisible = 0;",
      "\t\t\tdefaultConfigurationName = Release;",
      "\t\t};",
    ].join("\n"),
  );
  if (next === before5) return fail();

  // 5. The target itself.
  const before6 = next;
  next = insertIntoSection(
    next,
    "PBXNativeTarget",
    [
      `\t\t${targetId} /* ${targetName} */ = {`,
      "\t\t\tisa = PBXNativeTarget;",
      `\t\t\tbuildConfigurationList = ${configListId} /* Build configuration list for PBXNativeTarget "${targetName}" */;`,
      "\t\t\tbuildPhases = (",
      `\t\t\t\t${sourcesPhaseId} /* Sources */,`,
      `\t\t\t\t${resourcesPhaseId} /* Resources */,`,
      "\t\t\t);",
      "\t\t\tbuildRules = (",
      "\t\t\t);",
      "\t\t\tdependencies = (",
      "\t\t\t);",
      `\t\t\tname = ${targetName};`,
      `\t\t\tproductName = ${targetName};`,
      `\t\t\tproductReference = ${productRefId} /* ${targetName}.xctest */;`,
      `\t\t\tproductType = "${UI_TEST_PRODUCT_TYPE}";`,
      "\t\t};",
    ].join("\n"),
  );
  if (next === before6) return fail();

  // 6. Register it: products group, project target list, and the main group so
  //    the sources are visible in the navigator.
  next = insertIntoList(
    next,
    productsGroup.id,
    "children",
    `\t\t\t\t${productRefId} /* ${targetName}.xctest */,`,
  );
  next = insertIntoList(
    next,
    projectId,
    "targets",
    `\t\t\t\t${targetId} /* ${targetName} */,`,
  );

  const mainGroupId = /mainGroup\s*=\s*([0-9A-Fa-f]{24})/.exec(next)?.[1];
  if (mainGroupId) {
    next = insertIntoList(
      next,
      mainGroupId,
      "children",
      `\t\t\t\t${groupId} /* ${targetName} */,`,
    );
  }

  // 7. TargetAttributes, when the project keeps them — Xcode writes a
  //    TestTargetID there and warns about a UI test target without one.
  const attrs = /TargetAttributes\s*=\s*\{/.exec(next);
  if (attrs) {
    const insertAt = attrs.index + attrs[0].length;
    next =
      next.slice(0, insertAt) +
      `\n\t\t\t\t\t${targetId} = {\n\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;\n\t\t\t\t\t\tTestTargetID = ${appTarget.id};\n\t\t\t\t\t};` +
      next.slice(insertAt);
  }

  return { content: next, created: { targetId, productRefId } };
}

export { UI_TEST_PRODUCT_TYPE };
