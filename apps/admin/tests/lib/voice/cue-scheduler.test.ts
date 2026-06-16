/**
 * Tests for lib/voice/cue-scheduler.ts (#1742 Theme 2a).
 *
 * Pinned acceptance:
 *   1. `scheduleCue` rejects empty externalCallId / empty content
 *   2. `scheduleCue` creates a pending row with the supplied scheduledFor
 *   3. `cancelCuesForCall` flips every pending row for the call to cancelled
 *   4. `drainDueCues` ignores future cues (scheduledFor > now)
 *   5. `drainDueCues` fires due cues via the resolved provider's sayMessage,
 *      stamps `firedAt`, status="fired"
 *   6. Capability-flag-off provider → status="skipped" + no fetch call
 *   7. Provider returns `{status:"failed"}` → row stamped status="failed"
 *   8. Cue with no resolvable Call.source → status="skipped" + provider not
 *      consulted
 *   9. Batch limit honoured — drain returns at most `batchLimit` per call
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    cueScheduleEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    call: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/voice/provider-factory", () => ({
  getVoiceProvider: vi.fn(),
}));

import {
  scheduleCue,
  cancelCuesForCall,
  drainDueCues,
} from "@/lib/voice/cue-scheduler";

const NOW = new Date("2026-06-16T12:00:00Z");

function makeProvider({
  supports,
  sayResult,
}: {
  supports: boolean;
  sayResult?: { status: "spoken" | "queued" | "skipped" | "failed" };
}) {
  return {
    slug: "vapi",
    getCapabilities: () => ({ supportsProactiveSpeech: supports }),
    sayMessage: sayResult
      ? vi.fn(async () => sayResult)
      : undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.cueScheduleEntry.create.mockReset();
  mockPrisma.cueScheduleEntry.findMany.mockReset();
  mockPrisma.cueScheduleEntry.update.mockReset();
  mockPrisma.cueScheduleEntry.updateMany.mockReset();
  mockPrisma.call.findFirst.mockReset();
});

describe("scheduleCue", () => {
  it("throws on empty externalCallId", async () => {
    await expect(
      scheduleCue({
        externalCallId: "",
        scheduledFor: NOW,
        content: "hi",
      }),
    ).rejects.toThrow(/externalCallId/);
  });

  it("throws on empty content", async () => {
    await expect(
      scheduleCue({
        externalCallId: "ext-1",
        scheduledFor: NOW,
        content: "",
      }),
    ).rejects.toThrow(/content/);
  });

  it("persists with status='pending' and serialised options", async () => {
    mockPrisma.cueScheduleEntry.create.mockResolvedValue({
      id: "cue-1",
      externalCallId: "ext-1",
      callId: null,
      scheduledFor: NOW,
      content: "fifteen seconds left",
      status: "pending",
    });
    await scheduleCue({
      externalCallId: "ext-1",
      scheduledFor: NOW,
      content: "fifteen seconds left",
      noInterruption: true,
      traceId: "tr-1",
    });
    const args = mockPrisma.cueScheduleEntry.create.mock.calls[0][0] as {
      data: { status: string; options: { noInterruption: boolean; traceId: string } };
    };
    expect(args.data.status).toBe("pending");
    expect(args.data.options).toEqual({ noInterruption: true, traceId: "tr-1" });
  });
});

describe("cancelCuesForCall", () => {
  it("flips pending rows to cancelled and returns the count", async () => {
    mockPrisma.cueScheduleEntry.updateMany.mockResolvedValue({ count: 3 });
    const n = await cancelCuesForCall("ext-1");
    expect(n).toBe(3);
    const args = mockPrisma.cueScheduleEntry.updateMany.mock.calls[0][0] as {
      where: { externalCallId: string; status: string };
      data: { status: string };
    };
    expect(args.where).toEqual({ externalCallId: "ext-1", status: "pending" });
    expect(args.data.status).toBe("cancelled");
  });

  it("returns 0 (idempotent) when no pending cues match", async () => {
    mockPrisma.cueScheduleEntry.updateMany.mockResolvedValue({ count: 0 });
    expect(await cancelCuesForCall("ext-unknown")).toBe(0);
  });
});

describe("drainDueCues", () => {
  it("ignores future cues by passing scheduledFor: { lte: now }", async () => {
    mockPrisma.cueScheduleEntry.findMany.mockResolvedValue([]);
    await drainDueCues({ now: () => NOW });
    const args = mockPrisma.cueScheduleEntry.findMany.mock.calls[0][0] as {
      where: { scheduledFor: { lte: Date } };
    };
    expect(args.where.scheduledFor.lte).toEqual(NOW);
  });

  it("fires a due cue via provider.sayMessage and stamps status='fired'", async () => {
    mockPrisma.cueScheduleEntry.findMany.mockResolvedValue([
      {
        id: "cue-1",
        externalCallId: "ext-1",
        content: "fifteen seconds left",
        scheduledFor: new Date(NOW.getTime() - 1000),
        options: { noInterruption: true },
        traceId: "tr-1",
      },
    ]);
    const provider = makeProvider({
      supports: true,
      sayResult: { status: "spoken" },
    });
    mockPrisma.cueScheduleEntry.update.mockResolvedValue({});

    const result = await drainDueCues({
      now: () => NOW,
      getProvider: async () => provider,
      resolveSlug: async () => "vapi",
    });

    expect(result.fired).toBe(1);
    expect(provider.sayMessage).toHaveBeenCalledWith("ext-1", {
      content: "fifteen seconds left",
      noInterruption: true,
      queueOnly: undefined,
      traceId: "tr-1",
    });
    const updateArgs = mockPrisma.cueScheduleEntry.update.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; firedAt: Date };
    };
    expect(updateArgs.where).toEqual({ id: "cue-1" });
    expect(updateArgs.data.status).toBe("fired");
    expect(updateArgs.data.firedAt).toBeInstanceOf(Date);
  });

  it("skips when provider declares supportsProactiveSpeech: false", async () => {
    mockPrisma.cueScheduleEntry.findMany.mockResolvedValue([
      {
        id: "cue-1",
        externalCallId: "ext-1",
        content: "hi",
        scheduledFor: new Date(NOW.getTime() - 1000),
        options: {},
        traceId: null,
      },
    ]);
    const provider = makeProvider({
      supports: false,
      sayResult: { status: "spoken" }, // would fire if asked, but capability gate stops it
    });
    mockPrisma.cueScheduleEntry.update.mockResolvedValue({});

    const result = await drainDueCues({
      now: () => NOW,
      getProvider: async () => provider,
      resolveSlug: async () => "retell",
    });

    expect(result.skipped).toBe(1);
    expect(result.fired).toBe(0);
    expect(provider.sayMessage).not.toHaveBeenCalled();
    expect(mockPrisma.cueScheduleEntry.update).toHaveBeenCalled();
  });

  it("stamps status='failed' when provider returns {status:'failed'}", async () => {
    mockPrisma.cueScheduleEntry.findMany.mockResolvedValue([
      {
        id: "cue-1",
        externalCallId: "ext-1",
        content: "hi",
        scheduledFor: new Date(NOW.getTime() - 1000),
        options: {},
        traceId: null,
      },
    ]);
    const provider = makeProvider({
      supports: true,
      sayResult: { status: "failed" },
    });
    mockPrisma.cueScheduleEntry.update.mockResolvedValue({});

    const result = await drainDueCues({
      now: () => NOW,
      getProvider: async () => provider,
      resolveSlug: async () => "vapi",
    });

    expect(result.failed).toBe(1);
    const updateArgs = mockPrisma.cueScheduleEntry.update.mock.calls[0][0] as {
      data: { status: string };
    };
    expect(updateArgs.data.status).toBe("failed");
  });

  it("skips cue when externalCallId can't be resolved to a Call.source", async () => {
    mockPrisma.cueScheduleEntry.findMany.mockResolvedValue([
      {
        id: "cue-1",
        externalCallId: "ext-orphan",
        content: "hi",
        scheduledFor: new Date(NOW.getTime() - 1000),
        options: {},
        traceId: null,
      },
    ]);
    mockPrisma.cueScheduleEntry.update.mockResolvedValue({});
    const getProvider = vi.fn();

    const result = await drainDueCues({
      now: () => NOW,
      getProvider,
      resolveSlug: async () => null,
    });

    expect(result.skipped).toBe(1);
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("honours batchLimit (passed via Prisma findMany.take)", async () => {
    mockPrisma.cueScheduleEntry.findMany.mockResolvedValue([]);
    await drainDueCues({ now: () => NOW, batchLimit: 8 });
    const args = mockPrisma.cueScheduleEntry.findMany.mock.calls[0][0] as { take: number };
    expect(args.take).toBe(8);
  });
});
