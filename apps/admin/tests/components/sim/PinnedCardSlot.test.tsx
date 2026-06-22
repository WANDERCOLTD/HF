/**
 * #1744 (epic #1700 Theme 3) — PinnedCardSlot render contract.
 * #2227 (U8 of #2185) — collapse / restore round-trip.
 * UX-C polish (Findings 3 / 6 / 10) — sessionStorage persistence, fetch
 *   failure telemetry + fallback, phase-scope visibility.
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
 *   8. (UX-C/3) collapse state persists across remount with same callId
 *   9. (UX-C/3) fresh callId restores expanded state by default
 *  10. (UX-C/6) fetch failure logs `[pinned_card.fetch_failed]` console.warn
 *  11. (UX-C/6) showErrorFallback=true renders subtle fallback line on miss
 *  12. (UX-C/10) phaseScope set + current phase OUT of scope → null
 *  13. (UX-C/10) phaseScope unset → visible regardless of phase
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

function mockFetchReject(message = "Network down") {
  return vi.fn().mockRejectedValue(new Error(message));
}

beforeEach(() => {
  vi.restoreAllMocks();
  // sessionStorage isolation per test — JSDOM persists across tests.
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
  }
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

  // UX-C / Finding 3 — sessionStorage-backed collapse persistence.

  it("(8) UX-C/3 collapse state persists across remount with same callId", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "Persisted", bullets: ["x"] },
      }),
    );
    const { unmount } = render(
      <PinnedCardSlot callId="call-persist" phaseEnded={false} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    // Collapse via ✕.
    fireEvent.click(screen.getByLabelText("Collapse pinned card"));
    expect(screen.getByTestId("pinned-card-restore-chip")).toBeInTheDocument();
    unmount();

    // Remount with same callId — sessionStorage should restore collapsed.
    render(<PinnedCardSlot callId="call-persist" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-restore-chip")).toBeInTheDocument(),
    );
    // Full card is NOT rendered immediately on remount.
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
  });

  it("(9) UX-C/3 fresh callId defaults to expanded (no stored entry)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "Fresh", bullets: ["y"] },
      }),
    );
    // Pre-write a stale entry for a DIFFERENT callId.
    window.sessionStorage.setItem(
      "hf:sim:pin-collapsed:call-other",
      "true",
    );
    render(<PinnedCardSlot callId="call-fresh" phaseEnded={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
  });

  // UX-C / Finding 6 — fetch failure telemetry + optional fallback.

  it("(10) UX-C/6 fetch failure logs [pinned_card.fetch_failed]", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetchReject("HTTP 500"));
    render(<PinnedCardSlot callId="call-fail" phaseEnded={false} />);
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    // Verify the structured shape.
    const call = warnSpy.mock.calls.find(
      (args) => args[0] === "[pinned_card.fetch_failed]",
    );
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ callId: "call-fail" });
  });

  it("(11) UX-C/6 showErrorFallback renders subtle fallback on miss", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetchReject("net::ERR_FAILED"));
    render(
      <PinnedCardSlot
        callId="call-fallback"
        phaseEnded={false}
        showErrorFallback
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("pinned-card-fetch-fallback"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Card temporarily unavailable"),
    ).toBeInTheDocument();
    // Default (non-error) testids are not present.
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
  });

  it("(11b) UX-C/6 fetch failure WITHOUT showErrorFallback renders null", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetchReject("HTTP 500"));
    const { container } = render(
      <PinnedCardSlot callId="call-silent-fail" phaseEnded={false} />,
    );
    await waitFor(() => {
      // Catch the console.warn so we know the fetch resolved.
      expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    });
    // Nothing user-visible rendered.
    expect(container.firstChild).toBeNull();
  });

  // UX-C / Finding 10 — phase-scope.

  it("(12) UX-C/10 phaseScope set + current phase OUT of scope → null", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "Scoped", bullets: ["z"] },
      }),
    );
    const { rerender } = render(
      <PinnedCardSlot
        callId="call-scope-1"
        phaseEnded={false}
        currentPhase="p2_prep"
        phaseScope={["p2_prep", "p2_monologue"]}
      />,
    );
    // In-scope phase → card renders.
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
    // Flip to out-of-scope phase ("p3").
    rerender(
      <PinnedCardSlot
        callId="call-scope-1"
        phaseEnded={false}
        currentPhase="p3"
        phaseScope={["p2_prep", "p2_monologue"]}
      />,
    );
    expect(screen.queryByTestId("pinned-card-slot")).toBeNull();
    expect(screen.queryByTestId("pinned-card-restore-chip")).toBeNull();
  });

  it("(13) UX-C/10 phaseScope unset → visible regardless of phase", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        card: { kind: "cueCard", topic: "Unscoped", bullets: ["a"] },
      }),
    );
    render(
      <PinnedCardSlot
        callId="call-no-scope"
        phaseEnded={false}
        currentPhase="p3"
        // phaseScope intentionally undefined.
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("pinned-card-slot")).toBeInTheDocument(),
    );
  });
});
