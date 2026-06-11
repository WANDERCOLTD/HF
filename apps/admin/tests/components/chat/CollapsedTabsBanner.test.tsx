/**
 * #1504 Slice 3 — CollapsedTabsBanner shows once per user.
 *
 * The banner:
 *   - renders by default on first load (state = null in localStorage)
 *   - hides after the user clicks "Got it" (state flips to "shown")
 *   - stays hidden on subsequent mounts (idempotent across page reloads)
 *   - is independent of the Slice 2 "history merged" banner (different
 *     storage key, different copy)
 *
 * Uses next-auth's mocked session so the user-scoped storage key
 * (`hf.chat.tabs-collapsed-banner.v1504s3.<userId>`) resolves to a stable
 * value per test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "u_test_banner", email: "t@x", name: "T", role: "OPERATOR", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    status: "authenticated",
  }),
}));

import { CollapsedTabsBanner } from "@/components/chat/CollapsedTabsBanner";
import { getTabsCollapsedBannerKey } from "@/contexts/ChatContext";

const STORAGE_KEY = getTabsCollapsedBannerKey("u_test_banner");

beforeEach(() => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  }
});

describe("CollapsedTabsBanner — first-time visibility", () => {
  it("renders on first mount when localStorage has no record", () => {
    render(<CollapsedTabsBanner />);
    expect(
      screen.queryByText(/Chat tabs simplified/i),
    ).not.toBeNull();
  });

  it("renders the dismiss button labelled 'Got it'", () => {
    render(<CollapsedTabsBanner />);
    expect(screen.queryByRole("button", { name: /dismiss tab simplification notice/i })).not.toBeNull();
  });

  it("uses the design-system info-banner class (no inline colours)", () => {
    const { container } = render(<CollapsedTabsBanner />);
    const banner = container.querySelector(".hf-banner");
    expect(banner).not.toBeNull();
    expect(banner?.className).toContain("hf-banner-info");
    expect(banner?.className).toContain("chat-tabs-banner");
  });
});

describe("CollapsedTabsBanner — dismiss + persistence", () => {
  it("hides after the dismiss button is clicked", () => {
    render(<CollapsedTabsBanner />);
    const dismissBtn = screen.getByRole("button", { name: /dismiss tab simplification notice/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByText(/Chat tabs simplified/i)).toBeNull();
  });

  it("writes 'shown' to the user-scoped localStorage key after dismiss", () => {
    render(<CollapsedTabsBanner />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss tab simplification notice/i }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("shown");
  });

  it("stays hidden on a subsequent mount when localStorage already says 'shown'", () => {
    window.localStorage.setItem(STORAGE_KEY, "shown");
    render(<CollapsedTabsBanner />);
    expect(screen.queryByText(/Chat tabs simplified/i)).toBeNull();
  });
});

describe("CollapsedTabsBanner — storage key contract", () => {
  it("scopes the key by userId so two operators sharing a machine don't collide", () => {
    const userAKey = getTabsCollapsedBannerKey("alice");
    const userBKey = getTabsCollapsedBannerKey("bob");
    expect(userAKey).not.toBe(userBKey);
    expect(userAKey).toBe("hf.chat.tabs-collapsed-banner.v1504s3.alice");
    expect(userBKey).toBe("hf.chat.tabs-collapsed-banner.v1504s3.bob");
  });

  it("falls back to the bare prefix when userId is undefined (unauthenticated mount)", () => {
    expect(getTabsCollapsedBannerKey(undefined)).toBe(
      "hf.chat.tabs-collapsed-banner.v1504s3",
    );
  });

  it("uses a DIFFERENT key from the Slice 2 history-merged banner", async () => {
    const tabsKey = getTabsCollapsedBannerKey("alice");
    const { getMergedBannerKey } = await import("@/contexts/ChatContext");
    const mergedKey = getMergedBannerKey("alice");
    expect(tabsKey).not.toBe(mergedKey);
  });
});
