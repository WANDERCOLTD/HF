import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useRef } from "react";

import { useBubblePulse } from "@/components/journey-tab/use-bubble-pulse";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useBubblePulse — #1698", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function renderHookWithRoot(
    settingId: string | null,
    root: HTMLElement,
  ) {
    return renderHook(() => {
      const ref = useRef<HTMLElement>(root);
      useBubblePulse(ref, settingId);
    });
  }

  it("adds hf-preview-pulse to the matching data-compose-section element", () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.setAttribute("data-compose-section", "welcome");
    root.appendChild(bubble);
    document.body.appendChild(root);

    bubble.scrollIntoView = vi.fn();

    renderHookWithRoot("welcomeMessage", root);
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

    renderHookWithRoot("welcomeMessage", root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(false);
  });

  it("noops when no settingId", () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.setAttribute("data-compose-section", "welcome");
    root.appendChild(bubble);
    document.body.appendChild(root);

    renderHookWithRoot(null, root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(false);
  });

  it("noops when contract has no previewLocators", () => {
    const root = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.setAttribute("data-compose-section", "instructions");
    root.appendChild(bubble);
    document.body.appendChild(root);

    // skillScoringEmaHalfLife has previewLocators=[]
    renderHookWithRoot("skillScoringEmaHalfLife", root);
    expect(bubble.classList.contains("hf-preview-pulse")).toBe(false);
  });

  it("noops when no DOM matches the selector", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHookWithRoot("welcomeMessage", root);
    // No throws, no assertions needed — just that the hook returns
    // safely.
    expect(root.children.length).toBe(0);
  });
});
