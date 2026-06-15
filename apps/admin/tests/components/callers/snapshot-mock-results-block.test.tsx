/**
 * Tests for SnapshotMockResultsBlock — Wave C1 of the legacy-tab
 * retirement plan.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotMockResultsBlock } from "@/components/callers/caller-detail/SnapshotMockResultsBlock";

const CALLER_ID = "caller-c1-mock";

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotMockResultsBlock", () => {
  it("self-hides when caller has no calls at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, calls: [] }), { status: 200 }),
      ),
    );
    const { container } = render(<SnapshotMockResultsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="hf-snapshot-mock-results"]')).toBeNull();
    });
  });

  it("self-hides when caller has calls but none are Mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            calls: [
              {
                id: "c1",
                source: "vapi",
                createdAt: "2026-06-14T10:00:00Z",
                scores: [{ parameterId: "p1", score: 0.7 }],
              },
              { id: "c2", source: "sim", createdAt: "2026-06-15T10:00:00Z", scores: [] },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const { container } = render(<SnapshotMockResultsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      // Block mounts the section shell but MockResultV2 returns null inside
      // because no mock calls match. We test the inner card title is absent.
      expect(screen.queryByText("Mock results")).toBeNull();
    });
  });

  it("renders Mock results card when caller has at least one Mock call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            calls: [
              {
                id: "m1",
                source: "MOCK_EXAM",
                createdAt: "2026-06-14T10:00:00Z",
                scores: [
                  { parameterId: "p1", score: 0.85 },
                  { parameterId: "p2", score: 0.75 },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotMockResultsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Mock results")).toBeTruthy();
    });
  });

  it("self-hides on fetch error (no surprise UI for the operator)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { container } = render(<SnapshotMockResultsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="hf-snapshot-mock-results"]')).toBeNull();
    });
  });
});
