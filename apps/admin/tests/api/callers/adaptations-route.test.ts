/**
 * Tests for `GET /api/callers/[callerId]/adaptations` — Sprint 5 SP5-A
 * shell. Pins:
 *
 *   1. OPERATOR+ only — STUDENT/VIEWER refused at the auth gate.
 *   2. 404 when caller missing.
 *   3. Empty enrolment response when caller has no playbook.
 *   4. Empty shell when caller is enrolled but has zero CallerTarget
 *      overrides (empty=true so the UI can render the right copy).
 *   5. empty=false when ≥1 override exists (SP5-B will fill the array).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerPlaybook: { findFirst: vi.fn() },
    callerTarget: { count: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Default mock — OPERATOR session passes. Per-test overrides simulate
// STUDENT/VIEWER refusal at the auth gate.
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: (v: unknown) =>
    typeof v === "object" && v !== null && "error" in v,
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/adaptations/route");
}

describe("GET /api/callers/[callerId]/adaptations — SP5-A shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for STUDENT (refused at requireAuth OPERATOR gate)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when caller missing", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns shell with empty=true and null playbook when caller has no enrolment", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.playbookId).toBeNull();
    expect(body.playbookName).toBeNull();
    expect(body.empty).toBe(true);
    expect(body.whatWasAdapted).toEqual([]);
    expect(body.why).toEqual([]);
    expect(body.nextAdaptation).toBeNull();
  });

  it("returns shell with empty=true when enrolled but zero overrides", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    mockPrisma.callerTarget.count.mockResolvedValue(0);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.playbookId).toBe("pb1");
    expect(body.playbookName).toBe("IELTS Speaking");
    expect(body.empty).toBe(true);
  });

  it("returns shell with empty=false when ≥1 override exists", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    mockPrisma.callerTarget.count.mockResolvedValue(3);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.empty).toBe(false);
    // SP5-A shell — sections are still empty arrays. SP5-B fills them.
    expect(body.whatWasAdapted).toEqual([]);
    expect(body.why).toEqual([]);
  });
});
