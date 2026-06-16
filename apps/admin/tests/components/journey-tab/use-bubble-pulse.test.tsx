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

  it("removes the pulse class after 1800ms", async () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.setAttribute("data-compose-section", "welcome");
    bubble.scrollIntoView = vi.fn();
    root.appendChild(bubble);
    document.body.appendChild(root);

    renderHookWithRoot("B_call1_opening", root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(false);
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
