/**
 * #1744 (epic #1700 Theme 3) — PinnedCardSlot render contract.
 * #2227 (U8 of #2185) — collapse / restore round-trip.
 *
 * Pinned acceptance:
 *   1. cueCard variant renders topic + bullets + secondaryNote
 *   2. topicFocus variant renders topic + focusArea on one line
 *   3. phaseEnded=true → renders null even when a card is loaded
 *   4. Esc collapses (chip renders); ✕ collapses (chip renders); new
 *      callId resets to expanded
 *   5. (#2227) cueCard collapse → chip → click to expand round-trip,
 *      no refetch
 *   6. (#2227) topicFocus collapse → chip → click to expand round-trip,
 *      no refetch
 *   7. (#2227) Esc toggles — second Esc on a collapsed card re-expands
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
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
  });

  it("(4) Esc collapses; ✕ collapses; new callId resets to expanded", async () => {
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
    // Esc collapses to a chip — full card gone, chip present.
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
    expect(screen.getByTestId("pinned-card-restore-chip")).toBeInTheDocument();

    // New callId resets to expanded — chip gone, full card back.
    rerender(<PinnedCardSlot callId="call-5" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();

    // ✕ button also collapses to chip.
    fireEvent.click(screen.getByLabelText("Collapse pinned card"));
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
    expect(screen.getByTestId("pinned-card-restore-chip")).toBeInTheDocument();
  });

  it("(5) #2227 cueCard collapse → chip → click expand, no refetch", async () => {
    const fetchMock = mockFetch({
      ok: true,
      card: {
        kind: "cueCard",
        topic: "Family member you admire",
        bullets: [
          "who this person is",
          "how often you see them",
          "what kind of personality they have",
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PinnedCardSlot callId="call-6" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Collapse via ✕.
    fireEvent.click(screen.getByLabelText("Collapse pinned card"));
    const chip = screen.getByTestId("pinned-card-restore-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-label", "Show cue card");
    // Chip carries the topic so the learner sees what they're restoring.
    expect(chip).toHaveTextContent("Family member you admire");

    // Click chip → expand. No additional fetch.
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
    expect(screen.getByText("who this person is")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("(6) #2227 topicFocus collapse → chip → click expand, no refetch", async () => {
    const fetchMock = mockFetch({
      ok: true,
      card: {
        kind: "topicFocus",
        topic: "Education in your country",
        focusArea: "structuring an argument",
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PinnedCardSlot callId="call-7" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Collapse via ✕.
    fireEvent.click(screen.getByLabelText("Collapse pinned card"));
    const chip = screen.getByTestId("pinned-card-restore-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-label", "Show topic focus");
    expect(chip).toHaveTextContent("Education in your country");

    // Click chip → expand. No additional fetch.
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
    expect(screen.getByText("— structuring an argument")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("(7) #2227 Esc toggles — second Esc on collapsed card re-expands", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "Toggle", bullets: ["a"] },
      }),
    );
    render(<PinnedCardSlot callId="call-8" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );

    // Esc 1 — collapse.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
    expect(screen.getByTestId("pinned-card-restore-chip")).toBeInTheDocument();

    // Esc 2 — expand.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument();
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
  });
});
