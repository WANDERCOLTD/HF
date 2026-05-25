/**
 * Tests for `lib/compose/staleness.ts::isPromptStale` — #825 Story 1.
 *
 * Covers:
 *  - composedAt null → always stale (no cached prompt to serve)
 *  - all upstream timestamps null → not stale (epoch < any real composedAt)
 *  - each upstream source independently triggers stale when newer than composedAt:
 *      * Playbook.composeInputsUpdatedAt
 *      * Caller.composeInputsUpdatedAt
 *      * Domain.composeInputsUpdatedAt
 *      * SystemSetting "compose_inputs_updated_at"
 *  - domainId omitted → domain scope treated as epoch (no DB query)
 *  - malformed SystemSetting value → treated as epoch (fail-safe)
 *  - upstream timestamp exactly equal to composedAt → not stale (strict >)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  caller: { findUnique: vi.fn() },
  domain: { findUnique: vi.fn() },
  systemSetting: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("isPromptStale — #825 staleness foundation", () => {
  let isPromptStale: typeof import("@/lib/compose/staleness").isPromptStale;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({ composeInputsUpdatedAt: null });
    mockPrisma.caller.findUnique.mockResolvedValue({ composeInputsUpdatedAt: null });
    mockPrisma.domain.findUnique.mockResolvedValue({ composeInputsUpdatedAt: null });
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
    const mod = await import("@/lib/compose/staleness");
    isPromptStale = mod.isPromptStale;
  });

  it("composedAt null → stale (first-call / first-enrollment path)", async () => {
    const result = await isPromptStale({
      composedAt: null,
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(true);
    // Short-circuit — should not even query upstream tables
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });

  it("all upstream timestamps null + real composedAt → NOT stale (byte-identical pre-writer-migration)", async () => {
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(false);
  });

  it("Playbook timestamp newer than composedAt → stale", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      composeInputsUpdatedAt: new Date("2026-05-25T11:00:00Z"),
    });
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(true);
  });

  it("Caller timestamp newer than composedAt → stale", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      composeInputsUpdatedAt: new Date("2026-05-25T11:00:00Z"),
    });
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(true);
  });

  it("Domain timestamp newer than composedAt → stale", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      composeInputsUpdatedAt: new Date("2026-05-25T11:00:00Z"),
    });
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(true);
  });

  it("SystemSetting newer than composedAt → stale (system-wide change e.g. INIT-001)", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "2026-05-25T11:00:00.000Z",
    });
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(true);
  });

  it("Upstream timestamp exactly equal to composedAt → NOT stale (strict greater-than)", async () => {
    const t = new Date("2026-05-25T10:00:00Z");
    mockPrisma.playbook.findUnique.mockResolvedValue({ composeInputsUpdatedAt: t });
    const result = await isPromptStale({
      composedAt: t,
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(false);
  });

  it("domainId omitted → domain scope skipped, treated as epoch", async () => {
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      // no domainId
    });
    expect(result).toBe(false);
    // Did NOT query the domain table
    expect(mockPrisma.domain.findUnique).not.toHaveBeenCalled();
  });

  it("malformed SystemSetting value → treated as epoch (fail-safe, NOT stale-by-default)", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "not-a-date",
    });
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    // Malformed → epoch → epoch < real composedAt → not stale.
    // The fail-safe is "treat unknown as not-yet-set", not "treat unknown as
    // stale". This keeps a broken SystemSetting entry from forcing every
    // prompt in the system to recompose on every call.
    expect(result).toBe(false);
  });

  it("Multiple upstreams: max wins (Playbook old, Caller new → stale)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      composeInputsUpdatedAt: new Date("2026-05-25T09:00:00Z"),
    });
    mockPrisma.caller.findUnique.mockResolvedValue({
      composeInputsUpdatedAt: new Date("2026-05-25T11:00:00Z"),
    });
    const result = await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(result).toBe(true);
  });

  it("queries all four upstream sources in parallel (one round-trip)", async () => {
    await isPromptStale({
      composedAt: new Date("2026-05-25T10:00:00Z"),
      playbookId: "pb1",
      callerId: "c1",
      domainId: "d1",
    });
    expect(mockPrisma.playbook.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.caller.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.domain.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);
    // Each table is queried exactly once — staleness check is bounded.
  });
});
