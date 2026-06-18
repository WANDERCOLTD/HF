/**
 * resolve-module-source-refs.test.ts (#1850 P3f)
 *
 * Integration test for the resolver — feeds it the IELTS v2.3 fixture
 * + a mock filesystem and asserts the per-module Settings come back
 * with `cueCardPool` + `scaffoldPool` inlined as the expected shapes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractSourceRefsFromYamlBlocks,
  resolveModuleSourceRefs,
  type SourceFileReader,
} from "../resolve-module-source-refs";
import type { AuthoredModuleSettings } from "@/lib/types/json-fields";

const IELTS_V23 = readFileSync(
  join(__dirname, "fixtures", "course-reference-ielts-v2.3.md"),
  "utf-8",
);

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

describe("extractSourceRefsFromYamlBlocks — IELTS v2.3", () => {
  it("captures cueCardPool + scaffoldPool source-refs per module", () => {
    const refs = extractSourceRefsFromYamlBlocks(IELTS_V23);
    // 5 modules in v2.3 — each block carries at least one source-ref.
    expect(refs.size).toBeGreaterThanOrEqual(4);
    const part2 = refs.get("part2");
    expect(part2).toBeDefined();
    expect(part2!.get("cueCardPool")).toBe("source:cue-card-bank-v1");
    expect(part2!.get("scaffoldPool")).toBe("source:stall-scaffolds-monologue");
    const part3 = refs.get("part3");
    expect(part3!.get("scaffoldPool")).toBe("source:stall-scaffolds-discussion");
  });

  it("returns empty for a body with no settings blocks", () => {
    const refs = extractSourceRefsFromYamlBlocks("# A doc with no Module Settings blocks.\n");
    expect(refs.size).toBe(0);
  });
});

describe("resolveModuleSourceRefs — IELTS v2.3 against real disk", () => {
  it("inlines part2.cueCardPool from the question-bank file", () => {
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    const part2 = out.byModuleId.get("part2");
    expect(part2).toBeDefined();
    expect(Array.isArray(part2!.cueCardPool)).toBe(true);
    expect(part2!.cueCardPool!.length).toBeGreaterThanOrEqual(80);
    expect(part2!.cueCardPool![0]).toEqual({
      topic: "Family member you admire",
      bullets: ["who this person is", "how often you see them", "what kind of personality they have"],
    });
  });

  it("inlines scaffoldPool for part2 + part3 + mock + baseline", () => {
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    expect(out.byModuleId.get("part2")!.scaffoldPool).toEqual(
      expect.arrayContaining(["Take another moment.", "Take your time."]),
    );
    expect(out.byModuleId.get("part3")!.scaffoldPool).toEqual(
      expect.arrayContaining(["Could you give an example?"]),
    );
  });

  it("inlines baseline.cueCardPool + mock.cueCardPool via Source 2a/2b multi-route entries", () => {
    // Source 2a (moduleRef: mock) and Source 2b (moduleRef: baseline) point the
    // same Part 2 question-bank file at the Mock and Baseline contexts. Both
    // resolve against the multi-route Content Sources entries; the legacy
    // `source:mock-exam-scenario-pool-v1` / `source:cue-card-bank-baseline-v1`
    // sentinels in the YAML are sentinels-only (the resolver matches by
    // `(moduleRef, settingRef)`, not by the source id string).
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    const baseline = out.byModuleId.get("baseline");
    const mock = out.byModuleId.get("mock");
    expect(baseline).toBeDefined();
    expect(mock).toBeDefined();
    expect(Array.isArray(baseline!.cueCardPool)).toBe(true);
    expect(baseline!.cueCardPool!.length).toBeGreaterThanOrEqual(80);
    expect(Array.isArray(mock!.cueCardPool)).toBe(true);
    expect(mock!.cueCardPool!.length).toBeGreaterThanOrEqual(80);
  });

  it("inlines baseline.scaffoldPool + mock.scaffoldPool + part1.scaffoldPool via Source 6a/6b/7a", () => {
    // Source 6a (moduleRef: baseline), 6b (moduleRef: mock) route the
    // monologue stall scaffolds to Baseline + Mock Part 2 long-turn. Source
    // 7a (moduleRef: part1) routes the discussion scaffolds to Part 1 short
    // Q&A. All resolve against the multi-route Content Sources entries.
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    expect(out.byModuleId.get("baseline")!.scaffoldPool).toEqual(
      expect.arrayContaining(["Take another moment.", "Take your time."]),
    );
    expect(out.byModuleId.get("mock")!.scaffoldPool).toEqual(
      expect.arrayContaining(["Take another moment.", "Take your time."]),
    );
    expect(out.byModuleId.get("part1")!.scaffoldPool).toEqual(
      expect.arrayContaining(["Could you give an example?"]),
    );
  });

  it("inlines baseline.profileFieldsToCapture from Source 14 (P3g)", () => {
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    const baseline = out.byModuleId.get("baseline");
    expect(baseline).toBeDefined();
    expect(Array.isArray(baseline!.profileFieldsToCapture)).toBe(true);
    expect(baseline!.profileFieldsToCapture!).toHaveLength(4);
    const reason = baseline!.profileFieldsToCapture!.find(
      (f) => f.key === "profile:reason",
    );
    expect(reason).toBeDefined();
    expect(reason!.type).toBe("text");
    expect(reason!.prompt.length).toBeGreaterThan(0);
    const targetBand = baseline!.profileFieldsToCapture!.find(
      (f) => f.key === "profile:targetBand",
    );
    expect(targetBand!.type).toBe("band");
  });

  it("returns a structured resolution log", () => {
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    const resolved = out.resolutions.filter((r) => r.status === "resolved");
    // post-multi-route + P3g: 3 cueCardPool (part2 + mock + baseline) +
    // 5 scaffoldPool (part2 + part3 + mock + baseline + part1) +
    // 1 profileFieldsToCapture (baseline) = 9
    expect(resolved.length).toBeGreaterThanOrEqual(9);
    const part2Cue = resolved.find(
      (r) => r.moduleId === "part2" && r.field === "cueCardPool",
    );
    expect(part2Cue).toBeDefined();
    expect(part2Cue!.itemCount).toBeGreaterThanOrEqual(80);
    const baselineProfile = resolved.find(
      (r) =>
        r.moduleId === "baseline" && r.field === "profileFieldsToCapture",
    );
    expect(baselineProfile).toBeDefined();
    expect(baselineProfile!.itemCount).toBe(4);
  });
});

describe("resolveModuleSourceRefs — file errors + missing files", () => {
  it("skips with a warning when the file doesn't exist", () => {
    const mockReader: SourceFileReader = {
      exists: () => false,
      read: () => "",
    };
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, {
      repoRoot: "/tmp",
      reader: mockReader,
    });
    expect(out.byModuleId.get("part2")?.cueCardPool).toBeUndefined();
    expect(out.validationWarnings.length).toBeGreaterThan(0);
    expect(out.validationWarnings[0].code).toBe("MODULE_SOURCE_REF_UNRESOLVED");
  });

  it("skips with a warning when the file exists but the parser yields 0 items", () => {
    const mockReader: SourceFileReader = {
      exists: () => true,
      read: () => "# Empty content — no cue cards or scaffolds here.",
    };
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, {
      repoRoot: "/tmp",
      reader: mockReader,
    });
    expect(out.byModuleId.get("part2")?.cueCardPool).toBeUndefined();
    const skipReasons = out.resolutions
      .filter((r) => r.status === "skipped")
      .map((r) => r.reason);
    expect(skipReasons.some((r) => r?.includes("produced 0"))).toBe(true);
  });

  it("merges into an existing byModuleId without clobbering unrelated fields", () => {
    const byModuleId = new Map<string, Partial<AuthoredModuleSettings>>();
    byModuleId.set("part2", { closingLine: "Existing", minSpeakingSec: 120 });
    const out = resolveModuleSourceRefs(byModuleId, IELTS_V23, { repoRoot: REPO_ROOT });
    const part2 = out.byModuleId.get("part2")!;
    expect(part2.closingLine).toBe("Existing");
    expect(part2.minSpeakingSec).toBe(120);
    expect(Array.isArray(part2.cueCardPool)).toBe(true);
  });
});
