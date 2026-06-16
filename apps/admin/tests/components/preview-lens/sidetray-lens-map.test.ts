/**
 * Pins the `SIDETRAY_LENS_TO_SECTION` map in PreviewLens — Slice C3
 * follow-on (#1738).
 *
 * The map is the bridge between PreviewLens bubble emission and the
 * Journey tab bucket model. Gaps cause silent "click does nothing"
 * UX (the educator clicks a bubble, the Inspector doesn't mount any
 * bucket). Pre-follow-on, `moduleVisibility` was the lens-less gap;
 * its bubble carried no `data-compose-section` tag.
 *
 * Invariants pinned:
 *   1. Every PreviewLens lens key that emits a bubble has an entry.
 *   2. Every mapped value is a real ComposeSectionKey (not a typo).
 *   3. Mapped sections are reachable through the journey bucket model
 *      (every section maps to at least one bucket via
 *      `getBucketsForSection`).
 */

import { describe, it, expect } from "vitest";

import { SIDETRAY_LENS_TO_SECTION } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { COMPOSE_SECTION_KEYS } from "@/lib/compose";
import { getBucketsForSection } from "@/lib/journey/bucket-relations";

// The lens keys PreviewLens actually emits. When PreviewLens gains a
// new lens, add it here AND to the map; the test enforces parity at
// CI time so the gap can't reappear silently.
const EMITTED_LENS_KEYS = [
  "intake",
  "onboarding",
  "welcome",
  "stops",
  "moduleVisibility",
] as const;

describe("SIDETRAY_LENS_TO_SECTION — Slice C3 (#1738) lens-less audit", () => {
  it("covers every lens PreviewLens emits", () => {
    for (const lens of EMITTED_LENS_KEYS) {
      expect(
        SIDETRAY_LENS_TO_SECTION[lens],
        `lens "${lens}" is emitted by PreviewLens but has no SIDETRAY_LENS_TO_SECTION entry`,
      ).toBeDefined();
    }
  });

  it("maps every entry to a real ComposeSectionKey", () => {
    for (const [lens, section] of Object.entries(SIDETRAY_LENS_TO_SECTION)) {
      if (!section) continue;
      expect(
        (COMPOSE_SECTION_KEYS as readonly string[]).includes(section),
        `lens "${lens}" maps to "${section}" — not a real ComposeSectionKey`,
      ).toBe(true);
    }
  });

  it("maps every mapped section to at least one journey bucket", () => {
    for (const [lens, section] of Object.entries(SIDETRAY_LENS_TO_SECTION)) {
      if (!section) continue;
      const buckets = getBucketsForSection(section);
      expect(
        buckets.length,
        `lens "${lens}" → section "${section}" maps to no journey buckets — click would do nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("specifically maps moduleVisibility → modulesGate (the Slice C3 fix)", () => {
    expect(SIDETRAY_LENS_TO_SECTION.moduleVisibility).toBe("modulesGate");
  });
});
