import { describe, expect, it } from "vitest";
import { findAppEntry, planTestSupportHook } from "./app-entry.js";

/**
 * The one edit XForge makes to product source. The tests that matter are the
 * refusals: a wrong edit here either breaks a build or, worse, ships test hooks
 * in a release, and every case below is a shape where guessing would do that.
 */

const SWIFTUI_APP = `import SwiftUI

@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`;

describe("findAppEntry", () => {
  it("finds the @main App declared on its own line", () => {
    const found = findAppEntry(SWIFTUI_APP);
    expect(found && "entry" in found && found.entry.name).toBe("MyApp");
    expect(found && "entry" in found && found.entry.line).toBe(4);
  });

  it("finds it when @main shares the declaration line", () => {
    const found = findAppEntry("import SwiftUI\n@main struct A: App {\n}\n");
    expect(found && "entry" in found && found.entry.name).toBe("A");
  });

  it("ignores a file with no entry point", () => {
    expect(findAppEntry("struct HomeScreen: View {}\n")).toBeUndefined();
  });

  it("does not read @main out of a comment", () => {
    expect(
      findAppEntry("// @main used to be here\nstruct X: App {}\n"),
    ).toBeUndefined();
  });
});

describe("planTestSupportHook", () => {
  it("adds an init() with a DEBUG-guarded call when there is none", () => {
    const plan = planTestSupportHook(SWIFTUI_APP);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;

    expect(plan.strategy).toBe("new-init");
    expect(plan.content).toContain("    init() {");
    // The callee only exists in DEBUG, so an unguarded call would not build.
    expect(plan.content).toContain("#if DEBUG");
    expect(plan.content).toContain("XForgeTestSupport.configure()");
    expect(plan.content).toContain("#endif");
    // The guard has to bracket the call, not sit somewhere near it.
    const lines = plan.content.split("\n");
    const call = lines.findIndex((l) => l.includes("configure()"));
    expect(lines[call - 1]?.trim()).toBe("#if DEBUG");
    expect(lines[call + 1]?.trim()).toBe("#endif");
    // The Scene body is untouched.
    expect(plan.content).toContain("WindowGroup {");
  });

  it("uses an existing init() rather than adding a second one", () => {
    const source = `@main
struct MyApp: App {
    init() {
        setUpLogging()
    }

    var body: some Scene { WindowGroup { ContentView() } }
}
`;
    const plan = planTestSupportHook(source);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;

    expect(plan.strategy).toBe("existing-init");
    expect(plan.content.match(/init\(\)/g)).toHaveLength(1);
    // Inserted at the top of the body, before the app's own work.
    const lines = plan.content.split("\n");
    expect(lines.findIndex((l) => l.includes("configure()"))).toBeLessThan(
      lines.findIndex((l) => l.includes("setUpLogging()")),
    );
  });

  it("is idempotent — a second pass changes nothing", () => {
    const first = planTestSupportHook(SWIFTUI_APP);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    const second = planTestSupportHook(first.content);
    expect(second.status).toBe("already-present");
  });

  it("matches the file's indentation, tabs included", () => {
    const plan = planTestSupportHook(
      "@main\nstruct A: App {\n\tvar x = 1\n}\n",
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.content).toContain("\tinit() {");
    expect(plan.content).toContain("\t\t#if DEBUG");
  });

  it("refuses a UIKit entry point instead of editing a delegate blind", () => {
    const plan = planTestSupportHook(
      "@main\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n}\n",
    );
    expect(plan.status).toBe("refused");
    if (plan.status !== "refused") return;
    expect(plan.reason).toContain("didFinishLaunchingWithOptions");
  });

  it("refuses a custom initializer rather than make init ambiguous", () => {
    const plan = planTestSupportHook(
      "@main\nstruct A: App {\n    init(seed: Int = 0) {}\n    var body: some Scene { WindowGroup {} }\n}\n",
    );
    expect(plan.status).toBe("refused");
    if (plan.status !== "refused") return;
    expect(plan.reason).toContain("custom initializer");
  });

  it("refuses a one-line init() rather than reflow product source", () => {
    const plan = planTestSupportHook(
      "@main\nstruct A: App {\n    init() { setUp() }\n    var body: some Scene { WindowGroup {} }\n}\n",
    );
    expect(plan.status).toBe("refused");
    if (plan.status !== "refused") return;
    expect(plan.reason).toContain("one line");
  });

  it("refuses a file with no @main App", () => {
    const plan = planTestSupportHook("struct HomeScreen: View {}\n");
    expect(plan.status).toBe("refused");
  });

  it("does not mistake an init inside a nested type for the entry point's", () => {
    const source = `@main
struct A: App {
    struct Config {
        init() {}
    }

    var body: some Scene { WindowGroup {} }
}
`;
    const plan = planTestSupportHook(source);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    // The nested Config.init() must not be the insertion point.
    expect(plan.strategy).toBe("new-init");
    const lines = plan.content.split("\n");
    expect(lines.findIndex((l) => l.includes("configure()"))).toBeLessThan(
      lines.findIndex((l) => l.includes("struct Config")),
    );
  });
});
