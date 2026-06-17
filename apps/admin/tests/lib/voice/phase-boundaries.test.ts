/**
 * Tests for lib/voice/phase-boundaries.ts (#1762 Story C).
 *
 * Pinned acceptance:
 *   1. Empty metadata + first append → one open boundary {phase, startSec, endSec=startSec}
 *   2. Second append (different phase) → previous closed (endSec = new startSec) + new appended
 *   3. Sibling keys (e.g. pinnedCard) on existing metadata are preserved
 *   4. Same-phase re-append is a no-op (idempotence)
 *   5. Invalid inputs (empty sessionId / phase / negative startSec / endSec < startSec) return false
 *   6. Session not found returns false + logs
 *   7. prisma.session.update throws → helper catches, logs, returns false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockLog } = vi.hoisted(() => ({
  mockPrisma: {
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ log: mockLog }));

import { appendPhaseTransition } from "@/lib/voice/phase-boundaries";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.session.findUnique.mockReset();
  mockPrisma.session.update.mockReset();
  mockLog.mockReset();
});

describe("appendPhaseTransition", () => {
  it("writes the first boundary as an open boundary on empty metadata", async () => {
    mockPrisma.session.findUnique.mockResolvedValue({ metadata: null });
    mockPrisma.session.update.mockResolvedValue({});

    const ok = await appendPhaseTransition("sess-1", {
      phase: "p1",
      startSec: 0,
      endSec: 0,
    });

    expect(ok).toBe(true);
    expect(mockPrisma.session.update).toHaveBeenCalledTimes(1);
    const callArgs = mockPrisma.session.update.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "sess-1" });
    expect(callArgs.data.metadata.phaseBoundaries).toEqual([
      { phase: "p1", startSec: 0, endSec: 0 },
    ]);
  });

  it("closes the previous boundary and appends the new one", async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      metadata: {
        phaseBoundaries: [{ phase: "p1", startSec: 0, endSec: 0 }],
      },
    });
    mockPrisma.session.update.mockResolvedValue({});

    const ok = await appendPhaseTransition("sess-1", {
      phase: "p2_prep",
      startSec: 240,
      endSec: 240,
    });

    expect(ok).toBe(true);
    const written = mockPrisma.session.update.mock.calls[0][0].data.metadata.phaseBoundaries;
    expect(written).toEqual([
      { phase: "p1", startSec: 0, endSec: 240 },
      { phase: "p2_prep", startSec: 240, endSec: 240 },
    ]);
  });

  it("preserves sibling metadata keys through the round-trip", async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      metadata: {
        pinnedCard: { kind: "cueCard", topic: "your hometown", bullets: ["a", "b"] },
        overallBand: 6.5,
        phaseBoundaries: [{ phase: "p1", startSec: 0, endSec: 0 }],
      },
    });
    mockPrisma.session.update.mockResolvedValue({});

    const ok = await appendPhaseTransition("sess-1", {
      phase: "p2_prep",
      startSec: 240,
      endSec: 240,
    });

    expect(ok).toBe(true);
    const written = mockPrisma.session.update.mock.calls[0][0].data.metadata;
    expect(written.pinnedCard).toEqual({
      kind: "cueCard",
      topic: "your hometown",
      bullets: ["a", "b"],
    });
    expect(written.overallBand).toBe(6.5);
    expect(written.phaseBoundaries).toHaveLength(2);
  });

  it("is idempotent — same phase re-append does not double-close or duplicate", async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      metadata: {
        phaseBoundaries: [
          { phase: "p1", startSec: 0, endSec: 240 },
          { phase: "p2_prep", startSec: 240, endSec: 240 },
        ],
      },
    });

    const ok = await appendPhaseTransition("sess-1", {
      phase: "p2_prep",
      startSec: 245,
      endSec: 245,
    });

    expect(ok).toBe(true);
    // Idempotence: no update should be issued — the metadata is
    // unchanged because the last boundary is already the same phase.
    expect(mockPrisma.session.update).not.toHaveBeenCalled();
  });

  it("returns false on invalid sessionId", async () => {
    const ok = await appendPhaseTransition("", { phase: "p1", startSec: 0, endSec: 0 });
    expect(ok).toBe(false);
    expect(mockPrisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns false on empty phase name", async () => {
    const ok = await appendPhaseTransition("sess-1", {
      phase: "   ",
      startSec: 0,
      endSec: 0,
    });
    expect(ok).toBe(false);
    expect(mockPrisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns false on negative startSec", async () => {
    const ok = await appendPhaseTransition("sess-1", {
      phase: "p1",
      startSec: -5,
      endSec: 0,
    });
    expect(ok).toBe(false);
  });

  it("returns false when endSec < startSec", async () => {
    const ok = await appendPhaseTransition("sess-1", {
      phase: "p1",
      startSec: 100,
      endSec: 50,
    });
    expect(ok).toBe(false);
  });

  it("returns false + logs when session row is missing", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);

    const ok = await appendPhaseTransition("sess-missing", {
      phase: "p1",
      startSec: 0,
      endSec: 0,
    });

    expect(ok).toBe(false);
    expect(mockPrisma.session.update).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(
      "system",
      "voice.cue.phase_boundary_persist_failed",
      expect.objectContaining({ sessionId: "sess-missing", reason: "session_not_found" }),
    );
  });

  it("catches prisma.session.update errors, logs, and returns false", async () => {
    mockPrisma.session.findUnique.mockResolvedValue({ metadata: null });
    mockPrisma.session.update.mockRejectedValue(new Error("db down"));

    const ok = await appendPhaseTransition("sess-1", {
      phase: "p1",
      startSec: 0,
      endSec: 0,
    });

    expect(ok).toBe(false);
    expect(mockLog).toHaveBeenCalledWith(
      "system",
      "voice.cue.phase_boundary_persist_failed",
      expect.objectContaining({
        sessionId: "sess-1",
        phase: "p1",
        error: "db down",
      }),
    );
  });
});
