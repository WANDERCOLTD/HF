/**
 * Tests for `GET /api/callers/[callerId]/prompt-staleness` — #831 Story 7.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  composedPrompt: { findFirst: vi.fn() },
  systemSetting: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({ ok: true, session: { user: { id: "u1" } } })),
  isAuthError: () => false,
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

describe("GET /api/callers/[callerId]/prompt-staleness — #831", () => {
  let GET: typeof import("@/app/api/callers/[callerId]/prompt-staleness/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/callers/[callerId]/prompt-staleness/route");
    GET = mod.GET;
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
  });

  it("returns isStale=true when no active prompt exists", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: "c1",
      composeInputsUpdatedAt: null,
      domainId: null,
      domain: null,
      enrollments: [],
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);

    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.isStale).toBe(true);
    expect(body.composedAt).toBeNull();
    expect(body.upstreamChanges).toEqual([]);
  });

  it("returns isStale=false when all upstreams are older than composedAt", async () => {
    const composedAt = new Date("2026-05-25T12:00:00Z");
    const old = new Date("2026-05-25T10:00:00Z");
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: "c1",
      composeInputsUpdatedAt: old,
      domainId: "d1",
      domain: { composeInputsUpdatedAt: old, name: "ESL" },
      enrollments: [
        { playbookId: "pb1", playbook: { composeInputsUpdatedAt: old, name: "Course A" } },
      ],
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({ composedAt });
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: old.toISOString() });

    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.isStale).toBe(false);
    expect(body.upstreamChanges).toEqual([]);
  });

  it("returns isStale=true with playbook change when playbook is newer", async () => {
    const composedAt = new Date("2026-05-25T10:00:00Z");
    const newer = new Date("2026-05-25T12:00:00Z");
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: "c1",
      composeInputsUpdatedAt: null,
      domainId: "d1",
      domain: { composeInputsUpdatedAt: null, name: "ESL" },
      enrollments: [
        { playbookId: "pb1", playbook: { composeInputsUpdatedAt: newer, name: "IELTS" } },
      ],
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({ composedAt });

    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.isStale).toBe(true);
    expect(body.upstreamChanges).toHaveLength(1);
    expect(body.upstreamChanges[0].source).toBe("playbook");
    expect(body.upstreamChanges[0].label).toContain("IELTS");
  });

  it("picks MAX across multi-playbook enrollments", async () => {
    const composedAt = new Date("2026-05-25T10:00:00Z");
    const oldPB = new Date("2026-05-25T09:00:00Z");
    const newPB = new Date("2026-05-25T13:00:00Z");
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: "c1",
      composeInputsUpdatedAt: null,
      domainId: null,
      domain: null,
      enrollments: [
        { playbookId: "pb1", playbook: { composeInputsUpdatedAt: oldPB, name: "A" } },
        { playbookId: "pb2", playbook: { composeInputsUpdatedAt: newPB, name: "B" } },
      ],
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({ composedAt });

    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.isStale).toBe(true);
    expect(body.upstreamChanges[0].label).toContain("B");
  });

  it("returns isStale=true with multiple upstreamChanges when several are newer", async () => {
    const composedAt = new Date("2026-05-25T10:00:00Z");
    const newer = new Date("2026-05-25T12:00:00Z");
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: "c1",
      composeInputsUpdatedAt: newer,
      domainId: "d1",
      domain: { composeInputsUpdatedAt: newer, name: "ESL" },
      enrollments: [],
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({ composedAt });
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: newer.toISOString(),
    });

    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.isStale).toBe(true);
    const sources = body.upstreamChanges.map((c: any) => c.source).sort();
    expect(sources).toEqual(["caller", "domain", "system"]);
  });

  it("returns 404 when caller not found", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(404);
  });
});
