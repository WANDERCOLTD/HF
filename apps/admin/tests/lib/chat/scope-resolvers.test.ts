/**
 * Name → id scope resolvers for Cmd+K scope prefixes (#1442 Slice 5).
 *
 * Pins:
 *   - exact-case-insensitive match wins over partial
 *   - unique partial returns ok:true
 *   - multiple partials → ambiguous with up to 5 candidates
 *   - no match → ok:false with descriptive reason
 *   - institution scope: where.domain.is.institutionId is threaded when
 *     opts.institutionId is provided; absent when undefined (SUPERADMIN)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: { findMany: vi.fn() },
    playbook: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { resolveCallerByName } from "@/lib/chat/scope-resolvers/caller-by-name";
import { resolvePlaybookByName } from "@/lib/chat/scope-resolvers/playbook-by-name";
import { resolveDomainByName } from "@/lib/chat/scope-resolvers/domain-by-name";

const callerFind = prisma.caller.findMany as ReturnType<typeof vi.fn>;
const playbookFind = prisma.playbook.findMany as ReturnType<typeof vi.fn>;
const domainFind = prisma.domain.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCallerByName", () => {
  it("exact unique match → ok with id and label", async () => {
    callerFind.mockResolvedValueOnce([
      { id: "c1", name: "Bertie Tallstaff", email: "bertie@example.com" },
    ]);
    const r = await resolveCallerByName("Bertie Tallstaff", {
      institutionId: "inst-1",
    });
    expect(r).toEqual({ ok: true, callerId: "c1", label: "Bertie Tallstaff" });
  });

  it("unique partial match → ok", async () => {
    callerFind
      .mockResolvedValueOnce([]) // exact pass — none
      .mockResolvedValueOnce([
        { id: "c1", name: "Bertie Tallstaff", email: null },
      ]);
    const r = await resolveCallerByName("bert");
    expect(r).toEqual({ ok: true, callerId: "c1", label: "Bertie Tallstaff" });
  });

  it("multiple partial matches → ambiguous with candidates", async () => {
    callerFind
      .mockResolvedValueOnce([]) // exact pass
      .mockResolvedValueOnce([
        { id: "c1", name: "Bertie Tallstaff", email: null },
        { id: "c2", name: "Berta Müller", email: "b@x" },
        { id: "c3", name: "Bertie Vance", email: null },
      ]);
    const r = await resolveCallerByName("bert");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Ambiguous/);
      expect(r.candidates).toHaveLength(3);
      expect(r.candidates![0].id).toBe("c1");
    }
  });

  it("no match → ok:false with no-candidates reason", async () => {
    callerFind.mockResolvedValue([]);
    const r = await resolveCallerByName("nonexistent");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/No caller found/);
      expect(r.candidates).toBeUndefined();
    }
  });

  it("institution-scope where: provided id threads into domain.is.institutionId", async () => {
    callerFind.mockResolvedValueOnce([
      { id: "c1", name: "Bertie", email: null },
    ]);
    await resolveCallerByName("bertie", { institutionId: "inst-1" });
    expect(callerFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          domain: { is: { institutionId: "inst-1" } },
        }),
      }),
    );
  });

  it("SUPERADMIN (no institutionId) does NOT thread the filter", async () => {
    callerFind.mockResolvedValueOnce([
      { id: "c1", name: "Bertie", email: null },
    ]);
    await resolveCallerByName("bertie", {});
    const call = callerFind.mock.calls[0][0];
    expect(call.where.domain).toBeUndefined();
  });

  it("empty name → ok:false (no DB call)", async () => {
    const r = await resolveCallerByName("");
    expect(r.ok).toBe(false);
    expect(callerFind).not.toHaveBeenCalled();
  });
});

describe("resolvePlaybookByName", () => {
  it("exact unique match → ok with playbookId + domainId + label", async () => {
    playbookFind.mockResolvedValueOnce([
      { id: "pb1", name: "OCEAN", domainId: "dom1" },
    ]);
    const r = await resolvePlaybookByName("OCEAN", { institutionId: "inst-1" });
    expect(r).toEqual({
      ok: true,
      playbookId: "pb1",
      domainId: "dom1",
      label: "OCEAN",
    });
  });

  it("ambiguous candidates carry id + title", async () => {
    playbookFind
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "pb1", name: "OCEAN", domainId: "dom1" },
        { id: "pb2", name: "OCEAN v2", domainId: "dom1" },
      ]);
    const r = await resolvePlaybookByName("ocean");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.candidates).toEqual([
        { id: "pb1", title: "OCEAN" },
        { id: "pb2", title: "OCEAN v2" },
      ]);
    }
  });

  it("institution-scope where: threaded via domain.is.institutionId", async () => {
    playbookFind.mockResolvedValueOnce([
      { id: "pb1", name: "OCEAN", domainId: "dom1" },
    ]);
    await resolvePlaybookByName("OCEAN", { institutionId: "inst-1" });
    expect(playbookFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          domain: { is: { institutionId: "inst-1" } },
        }),
      }),
    );
  });
});

describe("resolveDomainByName", () => {
  it("exact unique match → ok with domainId + label", async () => {
    domainFind.mockResolvedValueOnce([{ id: "dom1", name: "Education" }]);
    const r = await resolveDomainByName("Education", { institutionId: "inst-1" });
    expect(r).toEqual({ ok: true, domainId: "dom1", label: "Education" });
  });

  it("ambiguous candidates carry id + name", async () => {
    domainFind
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "dom1", name: "Education" },
        { id: "dom2", name: "Higher Education" },
      ]);
    const r = await resolveDomainByName("edu");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.candidates).toEqual([
        { id: "dom1", name: "Education" },
        { id: "dom2", name: "Higher Education" },
      ]);
    }
  });

  it("institution-scope threaded as bare institutionId (no relation hop)", async () => {
    domainFind.mockResolvedValueOnce([{ id: "dom1", name: "Education" }]);
    await resolveDomainByName("Education", { institutionId: "inst-1" });
    expect(domainFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ institutionId: "inst-1" }),
      }),
    );
  });

  it("no match → ok:false", async () => {
    domainFind.mockResolvedValue([]);
    const r = await resolveDomainByName("xyz");
    expect(r.ok).toBe(false);
  });
});
