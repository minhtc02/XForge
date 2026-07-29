import { describe, expect, it } from "vitest";
import {
  extractManualBlocks,
  manualPlaceholder,
  mergeManualContent,
} from "./index.js";

describe("manual blocks", () => {
  it("extracts manual blocks with and without ids", () => {
    const doc = [
      "intro",
      '<!-- xforge:manual:start id="notes" -->',
      "team note",
      "<!-- xforge:manual:end -->",
      "<!-- xforge:manual:start -->",
      "anon note",
      "<!-- xforge:manual:end -->",
    ].join("\n");
    const blocks = extractManualBlocks(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.id).toBe("notes");
    expect(blocks[0]!.content).toContain("team note");
    expect(blocks[1]!.id).toBeUndefined();
  });

  it("returns generated content unchanged when there is no existing doc", () => {
    const gen = "fresh content";
    expect(mergeManualContent(gen, undefined)).toBe(gen);
  });

  it("preserves an id-matched manual block during regeneration", () => {
    const existing = [
      "# Alarm",
      manualPlaceholder("caveats", "old team caveat"),
    ].join("\n");
    const regenerated = [
      "# Alarm (regenerated)",
      manualPlaceholder("caveats", "PLACEHOLDER default"),
    ].join("\n");
    const merged = mergeManualContent(regenerated, existing);
    expect(merged).toContain("old team caveat");
    expect(merged).not.toContain("PLACEHOLDER default");
    expect(merged).toContain("# Alarm (regenerated)");
  });

  it("appends orphaned manual blocks so nothing is lost", () => {
    const existing = manualPlaceholder(
      "removed-section",
      "important manual text",
    );
    const regenerated = "# New doc with no matching placeholder";
    const merged = mergeManualContent(regenerated, existing);
    expect(merged).toContain("Preserved manual content");
    expect(merged).toContain("important manual text");
  });
});
