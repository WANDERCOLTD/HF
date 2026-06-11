/**
 * Pins the `derivePreviewBubbleRef` strategy from #1493 R1 (Strategy A).
 *
 * The ref is the deterministic key that ties a sticky-note annotation to a
 * specific Preview bubble — its stability across re-renders is the whole
 * reason annotations don't silently detach when the session-flow re-fetches.
 *
 * If a future change reorders bubbles within a lens, the ref WILL shift —
 * that is the documented R1 trade-off, mitigated by the "detached" warning
 * banner rendered by PreviewLens.tsx when stored refs don't match any
 * current bubble.
 */

import { describe, it, expect } from "vitest";

import { derivePreviewBubbleRef } from "@/app/x/courses/[courseId]/_components/PreviewLens";

describe("derivePreviewBubbleRef (#1493 R1 strategy A)", () => {
  it("produces a stable ref from lens + side + caption + index", () => {
    const ref = derivePreviewBubbleRef(
      {
        kind: "bubble",
        side: "bot",
        lens: "intake",
        lensLabel: "Edit Goals",
        caption: "Goals question",
        text: "What would you most like to get out of this course?",
      },
      0,
    );
    expect(ref).toBe("intake__bot__goals-question__0");
  });

  it("uses the bubble text when no caption is set", () => {
    const ref = derivePreviewBubbleRef(
      {
        kind: "bubble",
        side: "user",
        lens: "intake",
        lensLabel: "Edit Goals",
        text: "(learner's response will go here)",
      },
      1,
    );
    // The default text contains parens + apostrophes — they collapse to
    // hyphens so the key stays URL-safe and DB-friendly.
    expect(ref).toContain("intake__user__");
    expect(ref).toMatch(/__1$/);
    expect(ref).not.toMatch(/[()'!]/);
  });

  it("collapses whitespace + casing so caption tweaks don't detach the annotation", () => {
    const a = derivePreviewBubbleRef(
      {
        kind: "bubble",
        side: "bot",
        lens: "welcome",
        lensLabel: "Edit Welcome",
        caption: "Welcome message",
        text: "Hi!",
      },
      3,
    );
    const b = derivePreviewBubbleRef(
      {
        kind: "bubble",
        side: "bot",
        lens: "welcome",
        lensLabel: "Edit Welcome",
        caption: "  WELCOME    Message  ",
        text: "Hi!",
      },
      3,
    );
    expect(a).toBe(b);
  });

  it("includes the positional index so two bubbles with the same caption stay distinct", () => {
    const item = {
      kind: "bubble" as const,
      side: "bot" as const,
      lens: "onboarding",
      lensLabel: "Edit Onboarding",
      caption: "Phase 1 of 3 — Warm-up",
      text: "Let's start.",
    };
    expect(derivePreviewBubbleRef(item, 0)).not.toBe(
      derivePreviewBubbleRef(item, 1),
    );
  });

  it("clamps captions to 60 chars so DB keys stay readable", () => {
    const ref = derivePreviewBubbleRef(
      {
        kind: "bubble",
        side: "bot",
        lens: "intake",
        lensLabel: "Edit",
        caption: "a".repeat(200),
        text: "x",
      },
      0,
    );
    // Format: `${lens}__${side}__${slug}__${idx}` — slug capped to 60.
    const parts = ref.split("__");
    expect(parts).toHaveLength(4);
    expect(parts[2].length).toBeLessThanOrEqual(60);
  });
});
