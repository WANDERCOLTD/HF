/**
 * Tests for SnapshotRecentCallsBlock — Wave C1 of the legacy-tab
 * retirement plan.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotRecentCallsBlock } from "@/components/callers/caller-detail/SnapshotRecentCallsBlock";

const CALLER_ID = "caller-c1-recent";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotRecentCallsBlock", () => {
  it("self-hides when caller has no calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, calls: [] }), { status: 200 }),
      ),
    );
    const { container } = render(<SnapshotRecentCallsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="hf-snapshot-recent-calls"]')).toBeNull();
    });
  });

  it("renders Recent calls card with TimelineRibbon when calls exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            calls: [
              { id: "c1", source: "vapi", createdAt: "2026-06-10T10:00:00Z" },
              { id: "c2", source: "sim", createdAt: "2026-06-12T10:00:00Z" },
              { id: "c3", source: "vapi", createdAt: "2026-06-14T10:00:00Z" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotRecentCallsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Recent calls")).toBeTruthy();
      expect(screen.getByText("View all")).toBeTruthy();
    });
  });

  it("self-hides on fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { container } = render(<SnapshotRecentCallsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="hf-snapshot-recent-calls"]')).toBeNull();
    });
  });
});
