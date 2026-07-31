import type { Assertion, TestCase, TestStep } from "../models/test-case.js";

/**
 * XCUITest source generation (blueprint §14, Phase 3, master prompt §3).
 *
 * Turns deterministic TestCase skeletons into compilable XCUITest Swift. The
 * generator maps abstract step actions to XCUIElement interactions and uses
 * accessibility identifiers as locators (never coordinate tapping, §4.2). It
 * emits `--xforge-test` launch arguments so the app can enable test-support
 * (§14) without any production behavior change.
 *
 * Every interaction asserts before acting and every expectation becomes either a
 * real `XCTAssert` or an explicit `XCTSkip`/`XCTFail`. A generated test that
 * cannot fail is worse than no test at all: `xcodebuild` would exit 0 and the
 * run would be reported as a pass (the "exit-0 trap").
 */

export interface XcuiGenOptions {
  /** Swift class name for the generated test file. */
  className: string;
  /** App/module under test (for the file header comment only). */
  module?: string;
  /**
   * How to render an expectation with no matching assertion. `skip` (default)
   * records it as an explicit XCTSkip so the result is visibly unverified;
   * `fail` makes it a hard failure. Never a silent comment.
   */
  unverifiedExpectations?: "skip" | "fail";
  /**
   * Privacy services the simulator cannot pre-grant (camera, notifications,
   * ...). Each gets an `addUIInterruptionMonitor` so the system alert is
   * dismissed deterministically instead of stalling the run (§4.1).
   */
  permissionAlerts?: string[];
}

const DEFAULT_TIMEOUT = 5;

function swiftString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Alert buttons to accept, per service. `simctl privacy` cannot grant these,
 * so the only deterministic option is to answer the alert from inside the test.
 */
const ALERT_ACCEPT_BUTTONS: Readonly<Record<string, string[]>> = {
  camera: ["OK", "Allow"],
  notifications: ["Allow", "Allow While Using App"],
  "health-share": ["Allow", "Turn On All"],
  "health-update": ["Allow", "Turn On All"],
  bluetooth: ["OK", "Allow"],
  "face-id": ["OK"],
  "local-network": ["OK", "Allow"],
  "user-tracking": ["Allow"],
};

/** Render interruption monitors for permissions a simulator cannot grant. */
export function renderPermissionMonitors(services: string[]): string[] {
  if (services.length === 0) return [];
  const buttons = [
    ...new Set(
      services.flatMap((s) => ALERT_ACCEPT_BUTTONS[s] ?? ["OK", "Allow"]),
    ),
  ];
  return [
    `// Permissions simctl cannot pre-grant: ${services.join(", ")}`,
    `let xforgeAlertButtons = [${buttons.map(swiftString).join(", ")}]`,
    'addUIInterruptionMonitor(withDescription: "XForge system alert") { alert in',
    "    for title in xforgeAlertButtons {",
    "        let button = alert.buttons[title]",
    "        if button.exists {",
    "            button.tap()",
    "            return true",
    "        }",
    "    }",
    "    return false",
    "}",
  ];
}

/** The XCUIElementQuery used to locate an accessibility identifier. */
function element(identifier: string): string {
  return `app.descendants(matching: .any)[${swiftString(identifier)}].firstMatch`;
}

/** Render one assertion as XCUITest Swift. */
export function renderAssertion(assertion: Assertion): string[] {
  const target = assertion.target ?? "";
  const el = element(target);
  const note = assertion.source_text
    ? [`// EXPECT: ${assertion.source_text}`]
    : [];
  const message = swiftString(
    assertion.source_text ?? `${assertion.kind} ${target}`,
  );

  switch (assertion.kind) {
    case "exists":
    case "screen-is":
      return [
        ...note,
        `XCTAssertTrue(${el}.waitForExistence(timeout: ${DEFAULT_TIMEOUT}), ${message})`,
      ];
    case "not-exists":
      return [...note, `XCTAssertFalse(${el}.exists, ${message})`];
    case "label-equals":
      return [
        ...note,
        `XCTAssertTrue(${el}.waitForExistence(timeout: ${DEFAULT_TIMEOUT}), ${message})`,
        `XCTAssertEqual(${el}.label, ${swiftString(String(assertion.value ?? ""))}, ${message})`,
      ];
    case "label-contains":
      return [
        ...note,
        `XCTAssertTrue(${el}.waitForExistence(timeout: ${DEFAULT_TIMEOUT}), ${message})`,
        `XCTAssertTrue(${el}.label.contains(${swiftString(String(assertion.value ?? ""))}), ${message})`,
      ];
    case "count-equals":
      return [
        ...note,
        `XCTAssertEqual(app.descendants(matching: .any).matching(identifier: ${swiftString(target)}).count, ${Number(assertion.value ?? 0)}, ${message})`,
      ];
    case "enabled":
      return [
        ...note,
        `XCTAssertTrue(${el}.waitForExistence(timeout: ${DEFAULT_TIMEOUT}), ${message})`,
        `XCTAssertTrue(${el}.isEnabled, ${message})`,
      ];
    case "selected":
      return [
        ...note,
        `XCTAssertTrue(${el}.waitForExistence(timeout: ${DEFAULT_TIMEOUT}), ${message})`,
        `XCTAssertTrue(${el}.isSelected, ${message})`,
      ];
    default: {
      // Exhaustiveness guard: an unhandled kind must fail loudly, not silently.
      const never: never = assertion.kind;
      return [`XCTFail("unhandled assertion kind: ${String(never)}")`];
    }
  }
}

function swiftIdentifier(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9]+/g, "_").replace(/^(\d)/, "_$1");
  return cleaned.length > 0 ? cleaned : "case_unnamed";
}

/** Map one abstract step to XCUITest Swift lines. */
export function renderStep(step: TestStep): string[] {
  const target = step.target ?? "";
  const el = element(target);
  const located = (what: string): string[] => [
    `XCTAssertTrue(${el}.waitForExistence(timeout: ${DEFAULT_TIMEOUT}), ${swiftString(`${what} not found: ${target}`)})`,
    `XCTAssertTrue(${el}.isHittable, ${swiftString(`${what} not hittable: ${target}`)})`,
  ];

  switch (step.action) {
    case "launch-app":
      return ['app.launchArguments = ["--xforge-test"]', "app.launch()"];
    case "relaunch-app":
      return ["app.terminate()", "app.launch()"];
    case "open":
      return [...located("screen entry"), `${el}.tap()`];
    case "tap":
      return [...located("tap target"), `${el}.tap()`];
    case "type":
      return [
        ...located("text field"),
        `${el}.tap()`,
        `${el}.typeText(${swiftString(String(step.value ?? ""))})`,
      ];
    case "set-time":
      return [
        `// set-time ${String(step.value ?? "")} via test-support seed`,
        `XCTSkipIf(true, ${swiftString(`set-time is not automatable without a test-support hook (step ${step.id})`)})`,
      ];
    case "select-weekdays":
      return [
        `// select weekdays ${Array.isArray(step.value) ? step.value.join(",") : String(step.value ?? "")}`,
        `XCTSkipIf(true, ${swiftString(`select-weekdays needs a mapped control (step ${step.id})`)})`,
      ];
    case "capture-screenshot":
      return [
        "let shot = app.screenshot()",
        `let att = XCTAttachment(screenshot: shot)`,
        `att.name = ${swiftString(step.target ?? step.id)}`,
        "att.lifetime = .keepAlways",
        "add(att)",
      ];
    case "audit-accessibility":
      return ["// accessibility audit performed by analyzer on captured tree"];
    case "measure-cold-launch":
      return [
        "measure(metrics: [XCTApplicationLaunchMetric()]) {",
        "  app.launch()",
        "}",
      ];
    case "create-item":
      return [
        "// create-item via test-support seed or UI flow",
        `XCTSkipIf(true, ${swiftString(`create-item has no mapped UI flow (step ${step.id})`)})`,
      ];
    default:
      // An unmapped action must never look like a silent pass.
      return [
        `XCTFail(${swiftString(`unmapped action "${step.action}" (step ${step.id}) — XForge cannot verify this`)})`,
      ];
  }
}

function renderCaseMethod(testCase: TestCase, options: XcuiGenOptions): string {
  const method = `test_${swiftIdentifier(testCase.id)}`;
  const bodyLines: string[] = [];
  bodyLines.push(`// ${testCase.title}`);
  bodyLines.push(
    `// risk=${testCase.risk_score} priority=${testCase.priority}`,
  );
  if (testCase.requirements.length > 0) {
    bodyLines.push(`// requirements: ${testCase.requirements.join(", ")}`);
  }
  bodyLines.push("let app = XCUIApplication()");
  for (const step of testCase.steps) {
    for (const line of renderStep(step)) bodyLines.push(line);
  }
  for (const assertion of testCase.assertions) {
    for (const line of renderAssertion(assertion)) bodyLines.push(line);
  }

  // Expectations with no assertion are reported, never dropped into a comment.
  const asserted = new Set(
    testCase.assertions
      .map((a) => a.source_text)
      .filter((t): t is string => Boolean(t)),
  );
  const unverified = testCase.expected_results.filter((e) => !asserted.has(e));
  const mode = options.unverifiedExpectations ?? "skip";
  for (const expected of unverified) {
    const message = swiftString(`unverified expectation: ${expected}`);
    bodyLines.push(
      mode === "fail" ? `XCTFail(${message})` : `XCTSkipIf(true, ${message})`,
    );
  }

  const indented = bodyLines.map((l) => `        ${l}`).join("\n");
  return `    func ${method}() throws {\n${indented}\n    }`;
}

/** Generate a full XCUITest Swift file for a set of cases. */
export function generateXcuiTestFile(
  cases: TestCase[],
  options: XcuiGenOptions,
): string {
  const monitors = renderPermissionMonitors(options.permissionAlerts ?? []);
  const header = [
    "// Generated by XForge Test — do not edit by hand.",
    "// This file is test-support only and must not change production behavior.",
    options.module ? `// Module under test: ${options.module}` : "",
    "import XCTest",
    "",
    `final class ${options.className}: XCTestCase {`,
    "    override func setUpWithError() throws {",
    "        continueAfterFailure = false",
    ...monitors.map((l) => `        ${l}`),
    "    }",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  const methods = cases.map((c) => renderCaseMethod(c, options)).join("\n\n");
  return `${header}\n${methods}\n}\n`;
}

/** The XForgeTestSupport interface (blueprint §14) — DEBUG-only, opt-in. */
export function generateTestSupportFile(): string {
  return [
    "// Generated by XForge Test. DEBUG-only; enabled via the --xforge-test",
    "// launch argument. Contains NO production behavior — only test hooks.",
    "#if DEBUG",
    "import Foundation",
    "",
    "public enum XForgeTestSupport {",
    "    public static var isEnabled: Bool {",
    '        ProcessInfo.processInfo.arguments.contains("--xforge-test")',
    "    }",
    "",
    "    public static func configure() {",
    "        guard isEnabled else { return }",
    "        configureDeterministicClock()",
    "        configureMockNetworking()",
    "        configureSeedData()",
    "        disableAnimations()",
    "    }",
    "",
    "    private static func configureDeterministicClock() {}",
    "    private static func configureMockNetworking() {}",
    "    private static func configureSeedData() {}",
    "    private static func disableAnimations() {}",
    "}",
    "#endif",
    "",
  ].join("\n");
}
