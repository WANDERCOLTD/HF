/**
 * Tests for `lib/compose/bump-timestamp.ts` — #830 Story 6.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbook: { update: vi.fn() },
  caller: { update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("bumpPlaybookComposeTimestamp / bumpCallerComposeTimestamp — #830", () => {
  let bumpPlaybookComposeTimestamp: typeof import("@/lib/compose/bump-timestamp").bumpPlaybookComposeTimestamp;
  let bumpCallerComposeTimestamp: typeof import("@/lib/compose/bump-timestamp").bumpCallerComposeTimestamp;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/compose/bump-timestamp");
    bumpPlaybookComposeTimestamp = mod.bumpPlaybookComposeTimestamp;
    bumpCallerComposeTimestamp = mod.bumpCallerComposeTimestamp;
    mockPrisma.playbook.update.mockResolvedValue({});
    mockPrisma.caller.update.mockResolvedValue({});
  });

  it("bumpPlaybookComposeTimestamp stamps composeInputsUpdatedAt", async () => {
    await bumpPlaybookComposeTimestamp("pb-1");
    expect(mockPrisma.playbook.update).toHaveBeenCalledWith({
      where: { id: "pb-1" },
      data: { composeInputsUpdatedAt: expect.any(Date) },
    });
  });

  it("bumpCallerComposeTimestamp stamps composeInputsUpdatedAt", async () => {
    await bumpCallerComposeTimestamp("c-1");
    expect(mockPrisma.caller.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { composeInputsUpdatedAt: expect.any(Date) },
    });
  });

  it("playbook bump no-ops on empty id", async () => {
    await bumpPlaybookComposeTimestamp("");
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });

  it("caller bump no-ops on empty id", async () => {
    await bumpCallerComposeTimestamp("");
    expect(mockPrisma.caller.update).not.toHaveBeenCalled();
  });

  it("playbook bump swallows P2025 (row not found)", async () => {
    mockPrisma.playbook.update.mockRejectedValue({ code: "P2025" });
    await expect(bumpPlaybookComposeTimestamp("pb-missing")).resolves.toBeUndefined();
  });

  it("caller bump swallows P2025 (row not found)", async () => {
    mockPrisma.caller.update.mockRejectedValue({ code: "P2025" });
    await expect(bumpCallerComposeTimestamp("c-missing")).resolves.toBeUndefined();
  });

  it("playbook bump swallows + logs non-P2025 errors (best-effort)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.playbook.update.mockRejectedValue(new Error("boom"));
    await expect(bumpPlaybookComposeTimestamp("pb-1")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("bumpPlaybookComposeTimestamp"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("caller bump swallows + logs non-P2025 errors (best-effort)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.caller.update.mockRejectedValue(new Error("boom"));
    await expect(bumpCallerComposeTimestamp("c-1")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("bumpCallerComposeTimestamp"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
