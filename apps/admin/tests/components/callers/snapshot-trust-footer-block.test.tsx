/**
 * Tests for SnapshotTrustFooterBlock — Wave C3 of the legacy-tab
 * retirement plan. Pinned by `gh pr view 1685` gap #13.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotTrustFooterBlock } from "@/components/callers/caller-detail/SnapshotTrustFooterBlock";

const CALLER_ID = "caller-c3-trust";

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotTrustFooterBlock", () => {
  it("self-hides when no score row has hasLearnerEvidence (pre-#566 callers)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            uplift: {
              trustCalls: [{ id: "c1", createdAt: "2026-06-14T00:00:00Z" }],
              trustScores: [
                { callId: "c1", score: 0.6, hasLearnerEvidence: null },
                { callId: "c1", score: 0.7, hasLearnerEvidence: null },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotTrustFooterBlock callerId={CALLER_ID} />);
    // Wait a microtask so the fetch resolves and the TrustFooterV2
    // self-hide branch runs.
    await waitFor(() => {
      expect(screen.queryByText("Trust footer")).toBeNull();
    });
  });

  it("renders Evidence-backed + Goodhart drops tiles when scores carry the flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            uplift: {
              trustCalls: [
                { id: "c1", createdAt: "2026-06-10T00:00:00Z" },
                { id: "c2", createdAt: "2026-06-14T00:00:00Z" },
              ],
              trustScores: [
                { callId: "c1", score: 0.8, hasLearnerEvidence: true },
                { callId: "c1", score: 0.6, hasLearnerEvidence: false },
                { callId: "c2", score: 0.9, hasLearnerEvidence: true },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotTrustFooterBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Trust footer")).toBeTruthy();
      expect(screen.getByText("Evidence-backed")).toBeTruthy();
      expect(screen.getByText("Goodhart drops")).toBeTruthy();
    });
  });

  it("renders evidence-ratio sparkline when 2+ calls have scored rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            uplift: {
              trustCalls: [
                { id: "c1", createdAt: "2026-06-10T00:00:00Z" },
                { id: "c2", createdAt: "2026-06-12T00:00:00Z" },
                { id: "c3", createdAt: "2026-06-14T00:00:00Z" },
              ],
              trustScores: [
                { callId: "c1", score: 0.8, hasLearnerEvidence: true },
                { callId: "c2", score: 0.6, hasLearnerEvidence: false },
                { callId: "c3", score: 0.7, hasLearnerEvidence: true },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotTrustFooterBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(screen.getByText(/Evidence ratio per call/)).toBeTruthy();
    });
  });

  it("self-hides on fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { container } = render(<SnapshotTrustFooterBlock callerId={CALLER_ID} />);
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="hf-snapshot-trust-footer"]'),
      ).toBeNull();
    });
  });
});
