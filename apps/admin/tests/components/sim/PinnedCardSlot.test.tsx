/**
 * #1744 (epic #1700 Theme 3) — PinnedCardSlot render contract.
 *
 * Pinned acceptance:
 *   1. cueCard variant renders topic + bullets + secondaryNote
 *   2. topicFocus variant renders topic + focusArea on one line
 *   3. phaseEnded=true → renders null even when a card is loaded
 *   4. Esc dismisses; click ✕ also dismisses; remounting with new callId resets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PinnedCardSlot } from "@/components/sim/PinnedCardSlot";

function mockFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PinnedCardSlot", () => {
  it("(1) renders cueCard variant — topic + bullets + secondaryNote", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: {
          kind: "cueCard",
          topic: "Describe a book you enjoyed",
          bullets: ["what kind", "what it was about", "why you enjoyed it"],
          secondaryNote: "You have 1 minute to make notes.",
        },
      }),
    );
    render(<PinnedCardSlot callId="call-1" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(screen.getByText("Describe a book you enjoyed")).toBeInTheDocument();
    expect(screen.getByText("what kind")).toBeInTheDocument();
    expect(screen.getByText("what it was about")).toBeInTheDocument();
    expect(screen.getByText("why you enjoyed it")).toBeInTheDocument();
    expect(screen.getByText("You have 1 minute to make notes.")).toBeInTheDocument();
  });

  it("(2) renders topicFocus variant — topic + focusArea inline", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: {
          kind: "topicFocus",
          topic: "Education in your country",
          focusArea: "giving reasons",
        },
      }),
    );
    render(<PinnedCardSlot callId="call-2" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(screen.getByText("Education in your country")).toBeInTheDocument();
    expect(screen.getByText("— giving reasons")).toBeInTheDocument();
    // No bullets list in the focus variant.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("(3) phaseEnded=true renders null even when a card is loaded", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "X", bullets: ["y"] },
      }),
    );
    const { rerender } = render(
      <PinnedCardSlot callId="call-3" phaseEnded={false} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    rerender(<PinnedCardSlot callId="call-3" phaseEnded={true} />);
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
  });

  it("(4) Esc dismisses; ✕ dismisses; new callId resets dismissal", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "T", bullets: ["b"] },
      }),
    );
    const { rerender } = render(
      <PinnedCardSlot callId="call-4" phaseEnded={false} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();

    // New callId resets dismissal — re-fetch should render again.
    rerender(<PinnedCardSlot callId="call-5" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );

    // ✕ button also dismisses.
    fireEvent.click(screen.getByLabelText("Dismiss pinned card"));
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
  });
});
