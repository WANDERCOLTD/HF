/**
 * #1504 Slice 3 — ChatModeTabs renders the two-tab world.
 *
 * Pre-Slice-3 the strip rendered 4 tabs (Assistant / Tuning / Course /
 * Demo). After the consolidation it MUST render exactly 2 (Assistant +
 * Demo) — Tuning and Course are gone as standalone tabs; their intents
 * funnel into Assistant via the breadcrumb + Scope toggle.
 *
 * Pin the structural shape here so any future regression that re-adds a
 * legacy tab breaks loudly instead of silently re-introducing the 4-tab
 * confusion. The legacy ChatPanel.tsx::ChatModeTabs was simple enough
 * that we cover it via a small render-test against the public Provider
 * surface (mocks next-auth so no real session is needed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "u-test", email: "t@x", name: "T", role: "OPERATOR", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    status: "authenticated",
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/x/test",
}));

vi.mock("@/components/shared/AIModelBadge", () => ({
  AIModelBadge: () => null,
}));

vi.mock("@/hooks/useEntityDetection", () => ({
  useEntityDetection: () => undefined,
}));

import { ChatProvider, MODE_CONFIG } from "@/contexts/ChatContext";
import { EntityProvider } from "@/contexts/EntityContext";
import { ChatPanel } from "@/components/chat/ChatPanel";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <EntityProvider>
      <ChatProvider>{children}</ChatProvider>
    </EntityProvider>
  );
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  }
});

describe("MODE_CONFIG — post-Slice-3 structural shape", () => {
  it("exposes exactly two visible tabs: ASSISTANT and DEMO", () => {
    const keys = Object.keys(MODE_CONFIG).sort();
    expect(keys).toEqual(["ASSISTANT", "DEMO"]);
  });

  it("uses operator-readable labels for the two surviving tabs", () => {
    expect(MODE_CONFIG.ASSISTANT.label).toBe("Assistant");
    expect(MODE_CONFIG.DEMO.label).toBe("Demo");
  });

  it("does NOT include legacy DATA / TUNING / COURSE_MANAGE keys", () => {
    const cfg = MODE_CONFIG as unknown as Record<string, unknown>;
    expect(cfg.DATA).toBeUndefined();
    expect(cfg.TUNING).toBeUndefined();
    expect(cfg.COURSE_MANAGE).toBeUndefined();
  });
});

describe("ChatPanel — ChatModeTabs renders exactly two tabs", () => {
  it("renders the Assistant tab and the Demo tab — no Tuning, no Course", () => {
    render(
      <Wrapper>
        <ChatPanel />
      </Wrapper>,
    );
    // Force the panel open via the provider's openPanel — without a click
    // it stays closed and the tabs don't mount. The simplest way is to
    // render and then look for the tab strip even when collapsed; the
    // tablist always renders inside the panel root regardless of the
    // open state because the strip is part of the persistent layout.
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    const labels = tabs.map((t) => t.textContent ?? "");
    expect(labels.some((l) => l.includes("Assistant"))).toBe(true);
    expect(labels.some((l) => l.includes("Demo"))).toBe(true);
    expect(labels.some((l) => l.includes("Tuning"))).toBe(false);
    expect(labels.some((l) => l.includes("Course"))).toBe(false);
  });

  it("marks Assistant as the active tab on first render (default mode = ASSISTANT)", () => {
    render(
      <Wrapper>
        <ChatPanel />
      </Wrapper>,
    );
    const tabs = screen.getAllByRole("tab");
    const assistantTab = tabs.find((t) => (t.textContent ?? "").includes("Assistant"));
    const demoTab = tabs.find((t) => (t.textContent ?? "").includes("Demo"));
    expect(assistantTab?.getAttribute("aria-selected")).toBe("true");
    expect(demoTab?.getAttribute("aria-selected")).toBe("false");
  });

  it("switches active tab on click", () => {
    render(
      <Wrapper>
        <ChatPanel />
      </Wrapper>,
    );
    const tabs = screen.getAllByRole("tab");
    const demoTab = tabs.find((t) => (t.textContent ?? "").includes("Demo"));
    expect(demoTab).toBeDefined();
    fireEvent.click(demoTab!);

    // Re-read after the click — aria-selected should have flipped.
    const tabsAfter = screen.getAllByRole("tab");
    const assistantAfter = tabsAfter.find((t) => (t.textContent ?? "").includes("Assistant"));
    const demoAfter = tabsAfter.find((t) => (t.textContent ?? "").includes("Demo"));
    expect(assistantAfter?.getAttribute("aria-selected")).toBe("false");
    expect(demoAfter?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("ChatPanel — TuningScopeToggle visibility", () => {
  it("renders the Scope toggle while on the Assistant tab", () => {
    render(
      <Wrapper>
        <ChatPanel />
      </Wrapper>,
    );
    // The toggle wrapper carries role=radiogroup aria-label="Tuning scope".
    const toggle = screen.queryByRole("radiogroup", { name: /tuning scope/i });
    expect(toggle).not.toBeNull();
  });

  it("hides the Scope toggle on the Demo tab (DEMO has its own narrow palette)", () => {
    render(
      <Wrapper>
        <ChatPanel />
      </Wrapper>,
    );
    const tabs = screen.getAllByRole("tab");
    const demoTab = tabs.find((t) => (t.textContent ?? "").includes("Demo"));
    fireEvent.click(demoTab!);

    const toggle = screen.queryByRole("radiogroup", { name: /tuning scope/i });
    expect(toggle).toBeNull();
  });
});
