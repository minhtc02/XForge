import { describe, expect, it } from "vitest";
import {
  applyIdentifier,
  findInteractiveElements,
  matchLocator,
} from "./a11y-patch.js";

/**
 * The failure this module exists to avoid is silent: an identifier on a
 * container produces a test that finds an element, taps it, passes, and
 * exercises nothing. So the tests are mostly about what is *not* offered —
 * containers, ties, elements that already have one.
 */

const SCREEN = `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        VStack {
            Text("Welcome")
            Button("Save") {
                save()
            }
            .padding()
            TextField("Email", text: $email)
                .accessibilityIdentifier("email-field")
        }
    }
}
`;

describe("findInteractiveElements", () => {
  it("finds leaf elements and skips containers", () => {
    const kinds = findInteractiveElements(SCREEN).map((e) => e.kind);
    expect(kinds).toEqual(["Text", "Button", "TextField"]);
    // A VStack is exactly the wrong place to put an identifier.
    expect(kinds).not.toContain("VStack");
  });

  it("anchors a multi-line element at the line its brackets balance", () => {
    const button = findInteractiveElements(SCREEN).find(
      (e) => e.kind === "Button",
    );
    expect(button?.line).toBe(7);
    // Line 9 is the `}` closing the trailing closure — where a modifier goes,
    // not line 7 where the expression starts.
    expect(button?.anchorLine).toBe(9);
    expect(button?.anchorText.trim()).toBe("}");
    expect(button?.label).toBe("Save");
  });

  it("knows which elements already carry an identifier", () => {
    const byKind = new Map(
      findInteractiveElements(SCREEN).map((e) => [e.kind, e.hasIdentifier]),
    );
    expect(byKind.get("TextField")).toBe(true);
    expect(byKind.get("Button")).toBe(false);
  });

  it("skips an element embedded mid-expression", () => {
    // A line-based insertion into the middle of an expression is how you get
    // source that does not compile.
    const found = findInteractiveElements(
      'let v = condition ? Text("a") : Text("b")\n',
    );
    expect(found).toEqual([]);
  });
});

describe("matchLocator", () => {
  const elements = findInteractiveElements(SCREEN);

  it("matches a locator to the element whose label it names", () => {
    const hit = matchLocator("save-button", elements);
    expect(hit?.site.kind).toBe("Button");
    expect(hit?.basis).toBe("label-match");
  });

  it("never offers an element that already has an identifier", () => {
    expect(matchLocator("email-field", elements)).toBeUndefined();
  });

  it("returns nothing on a tie rather than pick by source order", () => {
    const twoSaves = findInteractiveElements(
      'VStack {\n    Button("Save") {}\n    Button("Save") {}\n}\n',
    );
    expect(matchLocator("save", twoSaves)).toBeUndefined();
  });

  it("falls back to the only unidentified element, and says so", () => {
    const one = findInteractiveElements('Button("Continue") {}\n');
    const hit = matchLocator("home-root", one);
    expect(hit?.basis).toBe("only-unidentified-element");
  });

  it("indents a modifier the file has no precedent for by one step", () => {
    // No existing chain to copy, so fall back to the element's indent + the
    // file's own step — tabs included.
    const tabbed = findInteractiveElements(
      'VStack {\n\t\tButton("Go") {}\n}\n',
    );
    expect(tabbed[0]?.modifierIndent).toBe("\t\t\t");
  });

  it("returns nothing when several elements are unlabelled candidates", () => {
    const many = findInteractiveElements(
      "VStack {\n    Text(title)\n    Text(subtitle)\n}\n",
    );
    expect(matchLocator("home-root", many)).toBeUndefined();
  });
});

describe("applyIdentifier", () => {
  const button = findInteractiveElements(SCREEN).find(
    (e) => e.kind === "Button",
  )!;

  function apply(
    overrides: Partial<Parameters<typeof applyIdentifier>[0]> = {},
  ) {
    return applyIdentifier({
      path: "HomeScreen.swift",
      content: SCREEN,
      anchorLine: button.anchorLine,
      anchorText: button.anchorText,
      indent: button.modifierIndent,
      locator: "save-button",
      ...overrides,
    });
  }

  it("aligns the modifier with the chain the element already has", () => {
    const result = apply();
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    const lines = result.content.split("\n");
    // `.padding()` sits at 12 spaces, so the new modifier does too — the file's
    // convention wins over any house style of ours.
    expect(lines[result.line - 1]).toBe(
      '            .accessibilityIdentifier("save-button")',
    );
    // The chain that followed still follows — a chain broken by a newline is
    // still one chain.
    expect(lines[result.line]?.trim()).toBe(".padding()");
  });

  it("refuses when the anchor line has changed since the proposal", () => {
    const result = apply({ anchorText: "            } // moved" });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toContain("changed after the proposal");
  });

  it("refuses an anchor past the end of the file", () => {
    const result = apply({ anchorLine: 9999 });
    expect(result.status).toBe("refused");
  });

  it("reports an identifier that already exists instead of adding a second", () => {
    const result = apply({ locator: "email-field" });
    expect(result.status).toBe("already-present");
  });

  it("refuses a locator that cannot be a Swift string literal", () => {
    const result = apply({ locator: 'save"button' });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toContain("string literal");
  });

  it("produces source the parser can read the identifier back out of", () => {
    const result = apply();
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    // Applying twice is a no-op, which is what makes re-running --apply safe.
    const again = applyIdentifier({
      path: "HomeScreen.swift",
      content: result.content,
      anchorLine: button.anchorLine,
      anchorText: button.anchorText,
      indent: button.modifierIndent,
      locator: "save-button",
    });
    expect(again.status).toBe("already-present");
  });
});
