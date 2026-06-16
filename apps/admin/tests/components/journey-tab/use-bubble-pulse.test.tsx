import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useRef } from "react";

import { useBubblePulse } from "@/components/journey-tab/use-bubble-pulse";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useBubblePulse — Slice C (#1721) multi-bubble pulse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function renderHookWithRoot(
    bucketId: JourneyMenuBucketId | null,
    root: HTMLElement,
  ) {
    return renderHook(() => {
      const ref = useRef<HTMLElement>(root);
      useBubblePulse(ref, bucketId);
    });
  }

  it("adds hf-preview-pulse to every data-compose-section element in the bucket", () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    // B_call1_opening's welcomeMessage targets `welcome` bubble.
    bubble.setAttribute("data-compose-section", "welcome");
    root.appendChild(bubble);
    document.body.appendChild(root);

    bubble.scrollIntoView = vi.fn();

    renderHookWithRoot("B_call1_opening", root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(true);
    expect(bubble.scrollIntoView).toHaveBeenCalled();
  });

  it("holds the pulse class persistently (Slice C3 #1738 — no auto-remove)", async () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.setAttribute("data-compose-section", "welcome");
    bubble.scrollIntoView = vi.fn();
    root.appendChild(bubble);
    document.body.appendChild(root);

    renderHookWithRoot("B_call1_opening", root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(true);
    // Pre-C3 the class was removed after 1800ms. Slice C3 holds it for
    // the lifetime of the selection — verify it survives 10s.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(true);
  });

  it("removes the pulse class when the selected bucket changes (cleanup fires)", () => {
    const root = document.createElement("div");
    const welcome = document.createElement("div");
    welcome.setAttribute("data-compose-section", "welcome");
    welcome.scrollIntoView = vi.fn();
    root.appendChild(welcome);
    document.body.appendChild(root);

    const { rerender } = renderHook(
      ({ bucket }: { bucket: JourneyMenuBucketId | null }) => {
        const ref = useRef<HTMLElement>(root);
        useBubblePulse(ref, bucket);
      },
      { initialProps: { bucket: "B_call1_opening" as JourneyMenuBucketId | null } },
    );

    expect(welcome.classList.contains("hf-preview-pulse")).toBe(true);

    rerender({ bucket: null });

    expect(welcome.classList.contains("hf-preview-pulse")).toBe(false);
  });

  it("noops when no bucket id", () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.setAttribute("data-compose-section", "welcome");
    root.appendChild(bubble);
    document.body.appendChild(root);

    renderHookWithRoot(null, root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(false);
  });

  it("noops when no DOM matches the bucket's sections", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHookWithRoot("B_call1_opening", root);
    expect(root.children.length).toBe(0);
  });
});
