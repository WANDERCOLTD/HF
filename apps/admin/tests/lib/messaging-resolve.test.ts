/**
 * Tests for lib/messaging/resolve.ts (#1141).
 *
 * Cascade is:
 *   1. caller.domain.institution → institution-scoped row for the channel
 *   2. SYSTEM default (institutionId IS NULL, isDefault TRUE)
 *
 * Properties under test:
 *   - returns null when channel has no candidate adapters (impossible
 *     today but defensive)
 *   - caller with no domain falls straight to SYSTEM
 *   - caller with domain but domain has no institutionId falls to SYSTEM
 *   - caller with institutionId returns the institution-scoped row first
 *   - SYSTEM default returned when no institution match
 *   - returns null when nothing matches
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  messagingProvider: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("resolveMessagingProvider", () => {
  let resolveMessagingProvider: typeof import("@/lib/messaging/resolve").resolveMessagingProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/messaging/resolve");
    resolveMessagingProvider = mod.resolveMessagingProvider;
  });

  it("returns the SYSTEM default when caller has no domain", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ domain: null });
    const systemRow = {
      id: "sys-1",
      adapterKey: "email-resend",
      institutionId: null,
      isDefault: true,
    };
    mockPrisma.messagingProvider.findFirst.mockResolvedValueOnce(systemRow);

    const result = await resolveMessagingProvider({
      callerId: "c-1",
      channel: "email",
    });

    expect(result).toBe(systemRow);
    // institution-scoped query NOT issued (no institutionId)
    expect(mockPrisma.messagingProvider.findFirst).toHaveBeenCalledTimes(1);
    const call = mockPrisma.messagingProvider.findFirst.mock.calls[0][0];
    expect(call.where.institutionId).toBeNull();
    expect(call.where.isDefault).toBe(true);
  });

  it("returns the institution-scoped row when caller belongs to one", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      domain: { institutionId: "inst-1" },
    });
    const instRow = {
      id: "inst-row",
      adapterKey: "email-resend",
      institutionId: "inst-1",
      isDefault: false,
    };
    mockPrisma.messagingProvider.findFirst.mockResolvedValueOnce(instRow);

    const result = await resolveMessagingProvider({
      callerId: "c-1",
      channel: "email",
    });

    expect(result).toBe(instRow);
    // Only the institution-scoped query issued; SYSTEM fallback skipped
    expect(mockPrisma.messagingProvider.findFirst).toHaveBeenCalledTimes(1);
    const call = mockPrisma.messagingProvider.findFirst.mock.calls[0][0];
    expect(call.where.institutionId).toBe("inst-1");
  });

  it("falls back to SYSTEM when caller has institution but no institution-scoped row exists", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      domain: { institutionId: "inst-1" },
    });
    const systemRow = {
      id: "sys-1",
      adapterKey: "email-resend",
      institutionId: null,
      isDefault: true,
    };
    mockPrisma.messagingProvider.findFirst
      .mockResolvedValueOnce(null) // institution query → no row
      .mockResolvedValueOnce(systemRow); // SYSTEM query → seed row

    const result = await resolveMessagingProvider({
      callerId: "c-1",
      channel: "email",
    });

    expect(result).toBe(systemRow);
    expect(mockPrisma.messagingProvider.findFirst).toHaveBeenCalledTimes(2);
  });

  it("returns null when no SYSTEM default exists", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ domain: null });
    mockPrisma.messagingProvider.findFirst.mockResolvedValueOnce(null);

    const result = await resolveMessagingProvider({
      callerId: "c-missing",
      channel: "email",
    });

    expect(result).toBeNull();
  });

  it("sms channel queries against sms-capable adapter keys", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ domain: null });
    mockPrisma.messagingProvider.findFirst.mockResolvedValueOnce(null);

    await resolveMessagingProvider({
      callerId: "c-1",
      channel: "sms",
    });

    const call = mockPrisma.messagingProvider.findFirst.mock.calls[0][0];
    expect(call.where.adapterKey.in).toEqual(
      expect.arrayContaining(["noop-sms"]),
    );
  });
});
