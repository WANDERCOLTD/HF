/**
 * parse-content-sources.test.ts (#1850 P3f)
 *
 * Unit tests for `parseContentSources` — the Content Sources section
 * parser feeding the source-ref resolver.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseContentSources } from "../parse-content-sources";

const IELTS_V23 = readFileSync(
  join(__dirname, "fixtures", "course-reference-ielts-v2.3.md"),
  "utf-8",
);

describe("parseContentSources — IELTS v2.3 fixture", () => {
  it("finds every Source N — Title block under the ## Content Sources heading", () => {
    const parsed = parseContentSources(IELTS_V23);
    // Sources 1-8 declared in the fixture; not all carry moduleRef/settingRef.
    expect(parsed.all.length).toBeGreaterThanOrEqual(8);
    const headers = parsed.all.map((e) => e.header);
    expect(headers).toContain("Source 2 — Part 2 cue card bank");
    expect(headers).toContain("Source 6 — Part 2 stall scaffolds (monologue)");
    expect(headers).toContain("Source 7 — Part 3 stall scaffolds (discussion)");
  });

  it("indexes by (moduleRef, settingRef) for the three resolvable cohort entries", () => {
    const parsed = parseContentSources(IELTS_V23);
    const part2Cue = parsed.byModuleAndSetting.get("part2:cueCardPool");
    expect(part2Cue).toBeDefined();
    expect(part2Cue!.location).toContain("ielts-speaking-question-bank-part2.md");
    expect(part2Cue!.format).toBe("structured-md");

    const part2Scaffold = parsed.byModuleAndSetting.get("part2:scaffoldPool");
    expect(part2Scaffold).toBeDefined();
    expect(part2Scaffold!.location).toContain("stall-scaffolds-monologue.md");

    const part3Scaffold = parsed.byModuleAndSetting.get("part3:scaffoldPool");
    expect(part3Scaffold).toBeDefined();
    expect(part3Scaffold!.location).toContain("stall-scaffolds-discussion.md");
  });

  it("strips the `module` prefix from settingRef so it matches AuthoredModuleSettings keys", () => {
    const parsed = parseContentSources(IELTS_V23);
    // The doc says `*settingRef:* moduleCueCardPool` — we want `cueCardPool`.
    for (const entry of parsed.all) {
      if (entry.settingRef) {
        expect(entry.settingRef.startsWith("module")).toBe(false);
      }
    }
  });

  it("returns an empty index when the section is missing", () => {
    const parsed = parseContentSources("# Some doc\n\nNo content sources section here.\n");
    expect(parsed.all).toEqual([]);
    expect(parsed.byModuleAndSetting.size).toBe(0);
  });
});

describe("parseContentSources — tolerant of cosmetic variations", () => {
  it("handles backtick-wrapped location values", () => {
    const body = [
      "## Content Sources",
      "",
      "### Source 1 — Test source",
      "",
      "- *location:* `docs/external/foo.md`",
      "- *format:* structured-md",
      "- *moduleRef:* test",
      "- *settingRef:* moduleFoo",
      "",
    ].join("\n");
    const parsed = parseContentSources(body);
    const entry = parsed.byModuleAndSetting.get("test:foo");
    expect(entry).toBeDefined();
    expect(entry!.location).toBe("docs/external/foo.md");
  });

  it("ignores extra fields it doesn't recognise (Outcomes/Ordering/Notes)", () => {
    const body = [
      "## Content Sources",
      "",
      "### Source 1 — Test",
      "",
      "- *location:* foo.md",
      "- *format:* structured-md",
      "- *moduleRef:* m",
      "- *settingRef:* moduleX",
      "- *Outcomes served:* OUT-01, OUT-02.",
      "- *Notes:* irrelevant metadata.",
      "",
    ].join("\n");
    const parsed = parseContentSources(body);
    const entry = parsed.byModuleAndSetting.get("m:x");
    expect(entry).toBeDefined();
    expect(entry!.location).toBe("foo.md");
  });

  it("parses `Source 2a` sub-numbering with a single lowercase suffix", () => {
    const body = [
      "## Content Sources",
      "",
      "### Source 2a — Part 2 cue card bank (Mock)",
      "",
      "- *location:* `docs/external/cue-cards-mock.md`",
      "- *format:* structured-md",
      "- *moduleRef:* part2Mock",
      "- *settingRef:* moduleCueCardPool",
      "",
      "### Source 2b — Part 2 cue card bank (Baseline)",
      "",
      "- *location:* `docs/external/cue-cards-baseline.md`",
      "- *format:* structured-md",
      "- *moduleRef:* part2Baseline",
      "- *settingRef:* moduleCueCardPool",
      "",
    ].join("\n");
    const parsed = parseContentSources(body);
    expect(parsed.all.length).toBe(2);
    expect(parsed.all.map((e) => e.header)).toEqual([
      "Source 2a — Part 2 cue card bank (Mock)",
      "Source 2b — Part 2 cue card bank (Baseline)",
    ]);
    const mock = parsed.byModuleAndSetting.get("part2Mock:cueCardPool");
    expect(mock?.location).toBe("docs/external/cue-cards-mock.md");
    const baseline = parsed.byModuleAndSetting.get("part2Baseline:cueCardPool");
    expect(baseline?.location).toBe("docs/external/cue-cards-baseline.md");
  });

  it("parses two-digit + suffix headers (`Source 10b`)", () => {
    const body = [
      "## Content Sources",
      "",
      "### Source 10b — Some pool",
      "",
      "- *location:* `docs/external/pool-10b.md`",
      "- *format:* structured-md",
      "- *moduleRef:* part3",
      "- *settingRef:* moduleScaffoldPool",
      "",
    ].join("\n");
    const parsed = parseContentSources(body);
    expect(parsed.all.length).toBe(1);
    expect(parsed.all[0].header).toBe("Source 10b — Some pool");
    const entry = parsed.byModuleAndSetting.get("part3:scaffoldPool");
    expect(entry?.location).toBe("docs/external/pool-10b.md");
  });

  it("rejects multi-letter suffixes (`Source 99x` parses; `Source 99xy` does NOT)", () => {
    // Single letter is allowed; the regex uses `[a-z]?` (zero or one).
    const single = parseContentSources(
      [
        "## Content Sources",
        "",
        "### Source 99x — Single letter ok",
        "- *location:* ok.md",
        "- *format:* structured-md",
        "- *moduleRef:* m",
        "- *settingRef:* moduleX",
        "",
      ].join("\n"),
    );
    expect(single.all.length).toBe(1);
    expect(single.all[0].header).toBe("Source 99x — Single letter ok");

    // Multi-letter suffix should NOT match — header parser silently skips it.
    const multi = parseContentSources(
      [
        "## Content Sources",
        "",
        "### Source 99xy — Multi letter rejected",
        "- *location:* skip.md",
        "- *moduleRef:* m",
        "- *settingRef:* moduleX",
        "",
      ].join("\n"),
    );
    expect(multi.all.length).toBe(0);
  });

  it("stops at the next ## section header", () => {
    const body = [
      "## Content Sources",
      "",
      "### Source 1 — A",
      "- *location:* a.md",
      "- *format:* structured-md",
      "- *moduleRef:* m1",
      "- *settingRef:* moduleA",
      "",
      "## Some Other Section",
      "",
      "### Source 99 — Should-not-appear",
      "- *location:* should-not.md",
      "- *moduleRef:* mX",
      "- *settingRef:* moduleZ",
    ].join("\n");
    const parsed = parseContentSources(body);
    expect(parsed.all.length).toBe(1);
    expect(parsed.byModuleAndSetting.has("mX:z")).toBe(false);
  });
});
