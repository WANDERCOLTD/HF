/**
 * Tests for SnapshotTopicsBlock — Wave C2 of the legacy-tab
 * retirement plan.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotTopicsBlock } from "@/components/callers/caller-detail/SnapshotTopicsBlock";

const CALLER_ID = "caller-c2-topics";

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotTopicsBlock", () => {
  it("renders empty-state copy when topTopics is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            uplift: {
              topTopics: [],
              memoryCounts: { topics: 0 },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotTopicsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/No topics covered yet/)).toBeTruthy();
    });
  });

  it("renders topic chips with names from uplift.topTopics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            uplift: {
              topTopics: [
                { topic: "Photosynthesis", lastMentioned: "2026-06-13T00:00:00Z" },
                { topic: "Mitochondria", lastMentioned: "2026-06-10T00:00:00Z" },
              ],
              memoryCounts: { topics: 2 },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotTopicsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Photosynthesis")).toBeTruthy();
      expect(screen.getByText("Mitochondria")).toBeTruthy();
      expect(screen.getByText(/2 topics surfaced/)).toBeTruthy();
    });
  });

  it("self-hides on fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { container } = render(<SnapshotTopicsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="hf-snapshot-topics"]'),
      ).toBeNull();
    });
  });

  it("carries the hf-snapshot-topics data-testid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            uplift: {
              topTopics: [],
              memoryCounts: { topics: 0 },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const { container } = render(<SnapshotTopicsBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="hf-snapshot-topics"]'),
      ).toBeTruthy();
    });
  });
});
