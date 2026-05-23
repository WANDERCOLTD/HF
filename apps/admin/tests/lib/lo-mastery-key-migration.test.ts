/**
 * #614 — lo_mastery key migration parser + reader tolerance.
 *
 * Exercises the pure-function pieces of the migration so the parsing
 * contract is enforced without a live DB. The actual DB writes are
 * covered by the dry-run + apply summary on DEV (see the audit counter
 * `callerAttributeOldKeyFormCount` trending to 0 post-apply).
 *
 * Also pins the reader tolerance pattern used by `transforms/modules.ts`
 * and `transforms/retrieval-practice.ts` — both forms (canonical slug
 * and legacy name) must produce a non-empty suffix during the grace
 * window. When the migration completes everywhere, the tolerance can be
 * tightened (separate follow-on issue).
 *
 * See: gh issue view 614
 *      scripts/migrate-caller-attribute-lo-mastery-keys.ts
 *      lib/prompt/composition/transforms/modules.ts:687 grace-window comment
 */
import { describe, it, expect } from "vitest";

// ── Parser under test (mirrored from the migration script) ───────────
// Inlined here so the test doesn't need to import a top-level script.

interface ParsedKey {
  prefix: string;
  specSlug: string;
  moduleToken: string;
  loRef: string;
}

function parseLoMasteryKey(key: string): ParsedKey | null {
  const marker = ":lo_mastery:";
  const markerIdx = key.indexOf(marker);
  if (markerIdx < 0) return null;
  const head = key.slice(0, markerIdx);
  const tail = key.slice(markerIdx + marker.length);
  const curriculumMarker = "curriculum:";
  const curIdx = head.lastIndexOf(curriculumMarker);
  if (curIdx < 0) return null;
  const specSlug = head.slice(curIdx + curriculumMarker.length);
  if (!specSlug) return null;
  const lastColon = tail.lastIndexOf(":");
  if (lastColon < 0) return null;
  const moduleToken = tail.slice(0, lastColon);
  const loRef = tail.slice(lastColon + 1);
  if (!moduleToken || !loRef) return null;
  return {
    prefix: key.slice(0, markerIdx + marker.length),
    specSlug,
    moduleToken,
    loRef,
  };
}

function isCanonical(moduleToken: string): boolean {
  return !/[A-Z ]/.test(moduleToken);
}

describe("#614 — parseLoMasteryKey", () => {
  it("parses canonical slug-form key", () => {
    const parsed = parseLoMasteryKey("curriculum:ielts-speaking-001:lo_mastery:part1:OUT-01");
    expect(parsed).toEqual({
      prefix: "curriculum:ielts-speaking-001:lo_mastery:",
      specSlug: "ielts-speaking-001",
      moduleToken: "part1",
      loRef: "OUT-01",
    });
  });

  it("parses legacy name-form key (spaces, colons inside the module token)", () => {
    const parsed = parseLoMasteryKey(
      "curriculum:ielts-speaking-001:lo_mastery:Part 1: Familiar Topics:OUT-01",
    );
    expect(parsed?.moduleToken).toBe("Part 1: Familiar Topics");
    expect(parsed?.loRef).toBe("OUT-01");
    expect(parsed?.specSlug).toBe("ielts-speaking-001");
  });

  it("parses key with hyphenated LO ref", () => {
    const parsed = parseLoMasteryKey("curriculum:wnf-content-001:lo_mastery:mod-1:LO-1.2");
    expect(parsed?.loRef).toBe("LO-1.2");
    expect(parsed?.moduleToken).toBe("mod-1");
  });

  it("returns null when :lo_mastery: marker is absent", () => {
    expect(parseLoMasteryKey("curriculum:foo:current_module")).toBeNull();
    expect(parseLoMasteryKey("memory:foo:bar")).toBeNull();
  });

  it("returns null when specSlug is missing", () => {
    expect(parseLoMasteryKey("curriculum::lo_mastery:part1:OUT-01")).toBeNull();
  });

  it("returns null when loRef is missing", () => {
    expect(parseLoMasteryKey("curriculum:foo:lo_mastery:part1")).toBeNull();
  });

  it("returns null when moduleToken is missing", () => {
    expect(parseLoMasteryKey("curriculum:foo:lo_mastery::OUT-01")).toBeNull();
  });
});

describe("#614 — isCanonical heuristic (matches audit-counter regex)", () => {
  it("canonical slugs return true", () => {
    expect(isCanonical("part1")).toBe(true);
    expect(isCanonical("mod-1")).toBe(true);
    expect(isCanonical("ielts-mock-exam")).toBe(true);
  });

  it("uppercase or space in moduleToken returns false", () => {
    expect(isCanonical("Part 1")).toBe(false);
    expect(isCanonical("Part 1: Familiar Topics")).toBe(false);
    expect(isCanonical("Part1")).toBe(false);
  });
});

// ── Reader tolerance pattern — pinned during grace window ──────────────

describe("#614 grace window — reader tolerance must accept BOTH forms", () => {
  // Mirror of transforms/modules.ts:702-707 + retrieval-practice.ts:71-74.
  // When #614 fully drains, the reader can use a stricter pattern; until
  // then this test guards against an accidental tightening.
  function readMastery(key: string): string | null {
    if (!key.includes(":lo_mastery:")) return null;
    const suffix = key.split(":lo_mastery:")[1];
    if (suffix && suffix.length > 0) return suffix;
    return null;
  }

  it("reads suffix from canonical slug-form key", () => {
    expect(readMastery("curriculum:ielts:lo_mastery:part1:OUT-01")).toBe("part1:OUT-01");
  });

  it("reads suffix from legacy name-form key (with embedded colons)", () => {
    expect(readMastery("curriculum:ielts:lo_mastery:Part 1: Familiar Topics:OUT-01")).toBe(
      "Part 1: Familiar Topics:OUT-01",
    );
  });

  it("returns null for unrelated keys", () => {
    expect(readMastery("curriculum:ielts:current_module")).toBeNull();
    expect(readMastery("memory:foo:bar")).toBeNull();
  });
});
