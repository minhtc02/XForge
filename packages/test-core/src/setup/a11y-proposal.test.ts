import { describe, expect, it } from "vitest";
import { buildA11yProposal } from "./a11y-proposal.js";

const HOME = `struct HomeScreen: View {
    var body: some View {
        VStack {
            Button("Save") {
                save()
            }
            Text("Total")
        }
    }
}
`;

const SETTINGS = `struct SettingsScreen: View {
    var body: some View {
        Button("Save") {
            persist()
        }
    }
}
`;

const need = (locator: string, files: string[]) => ({
  locator,
  cases: ["TC-001"],
  intent: "tap (TC-001: save a thing)",
  files,
});

describe("buildA11yProposal", () => {
  it("suggests the matching element but leaves it unapproved", () => {
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("save-button", ["Home.swift"])],
      sources: [{ path: "Home.swift", content: HOME }],
    });

    const request = proposal.requests[0]!;
    expect(request.site?.kind).toBe("Button");
    expect(request.basis).toBe("label-match");
    // The whole point: a suggestion is not a decision.
    expect(request.approved).toBe(false);
    // The anchor is the line the modifier goes after, with the text to verify.
    expect(request.site?.anchor_line).toBe(6);
    expect(request.site?.anchor_text.trim()).toBe("}");
  });

  it("lists the other unidentified elements as alternatives", () => {
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("save-button", ["Home.swift"])],
      sources: [{ path: "Home.swift", content: HOME }],
    });
    const request = proposal.requests[0]!;
    expect(request.candidates.map((c) => c.kind)).toEqual(["Text"]);
    // The suggestion is not repeated in its own alternatives list.
    expect(
      request.candidates.some(
        (c) => c.element_line === request.site?.element_line,
      ),
    ).toBe(false);
  });

  it("declines to choose when two files both offer a match", () => {
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("save-button", ["Home.swift", "Settings.swift"])],
      sources: [
        { path: "Home.swift", content: HOME },
        { path: "Settings.swift", content: SETTINGS },
      ],
    });
    const request = proposal.requests[0]!;
    expect(request.site).toBeUndefined();
    expect(request.note).toContain("2 files");
    // Both are still listed, so a human has something to choose from.
    expect(request.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("says so when it has nothing to suggest", () => {
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("home-root", ["Home.swift"])],
      sources: [{ path: "Home.swift", content: HOME }],
    });
    const request = proposal.requests[0]!;
    // No label resembles "home-root", and two elements are unidentified — the
    // honest output is a blank with the alternatives listed.
    expect(request.site).toBeUndefined();
    expect(request.note).toContain("guess");
    expect(request.candidates).toHaveLength(2);
  });

  it("matches a locator that merely contains the element's label", () => {
    // `Text("Total")` ← `total-label` is a real match, not a coincidence: the
    // locator names the label plus a role suffix, which is how they are written.
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("total-label", ["Home.swift"])],
      sources: [{ path: "Home.swift", content: HOME }],
    });
    expect(proposal.requests[0]?.site?.kind).toBe("Text");
  });

  it("reports the cap instead of silently truncating candidates", () => {
    const many = `VStack {\n${Array.from(
      { length: 6 },
      (_, i) => `    Text(label${i})`,
    ).join("\n")}\n}\n`;
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("anything", ["Many.swift"])],
      sources: [{ path: "Many.swift", content: many }],
      maxCandidates: 2,
    });
    const request = proposal.requests[0]!;
    expect(request.candidates).toHaveLength(2);
    expect(request.note).toContain("2 of 6");
  });

  it("records the cases and intent a reviewer needs to judge the site", () => {
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      planHash: "abc",
      needs: [need("save-button", ["Home.swift"])],
      sources: [{ path: "Home.swift", content: HOME }],
    });
    expect(proposal.plan_hash).toBe("abc");
    expect(proposal.requests[0]?.affected_cases).toEqual(["TC-001"]);
    expect(proposal.requests[0]?.intent).toContain("TC-001");
  });

  it("searches every source when no candidate file is known", () => {
    const proposal = buildA11yProposal({
      planId: "XFPLAN-1",
      needs: [need("save-button", [])],
      sources: [{ path: "Home.swift", content: HOME }],
    });
    expect(proposal.requests[0]?.site?.file).toBe("Home.swift");
  });
});
