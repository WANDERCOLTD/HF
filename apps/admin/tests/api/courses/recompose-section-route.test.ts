/**
 * Tests for `POST /api/courses/[courseId]/recompose-section` — #1558 S3b.
 *
 * Pins:
 *   - OPERATOR+ gate (STUDENT 403)
 *   - 404 missing course
 *   - 400 invalid body (unknown sectionKey)
 *   - dryRun shape: { previewDiff: { before, after, composedPromptId }, affectedCallerCount }
 *   - dryRun with zero callers — soft empty result, not an error
 *   - sync fanout when ≤ 20 callers: { fanoutMode: "sync", patched, skipped, failures }
 *   - async fanout when > 20 callers: { fanoutMode: "async", queued }
 *   - sync per-caller failure captured in `failures` (not aborted)
 *   - section hash refreshed via the helper (one bumpSectionHash per patched caller)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockRecompose } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
    callerPlaybook: { findMany: vi.fn() },
  },
  mockRecompose: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: (v: unknown) =>
    typeof v === "object" && v !== null && "error" in v,
}));
vi.mock("@/lib/compose/recompose-section", () => ({
  recomposeSectionForCaller: mockRecompose,
}));

const PARAMS = { params: Promise.resolve({ courseId: "course-1" }) };

async function loadRoute() {
  return import("@/app/api/courses/[courseId]/recompose-section/route");
}

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/courses/[courseId]/recompose-section — #1558 S3b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
  });

  it("returns 403 for STUDENT", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when course missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 400 on unknown sectionKey", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "not-a-section" }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({}), PARAMS);
    expect(res.status).toBe(400);
  });

  it("dryRun with zero callers — soft empty result, ok:true", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome", dryRun: true }), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      dryRun: true,
      sectionKey: "welcome",
      previewDiff: null,
      affectedCallerCount: 0,
    });
    expect(mockRecompose).not.toHaveBeenCalled();
  });

  it("dryRun returns previewDiff sourced from the FIRST active caller", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c-1" },
      { callerId: "c-2" },
      { callerId: "c-3" },
    ]);
    mockRecompose.mockResolvedValueOnce({
      dryRun: true,
      sectionKey: "welcome",
      before: { _quickStart: { first_line: "OLD" } },
      after: { _quickStart: { first_line: "NEW" } },
      composedPromptId: "cp-1",
    });

    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome", dryRun: true }), PARAMS);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.affectedCallerCount).toBe(3);
    expect(body.previewDiff).toEqual({
      before: { _quickStart: { first_line: "OLD" } },
      after: { _quickStart: { first_line: "NEW" } },
      composedPromptId: "cp-1",
    });
    // Single helper call against the first caller.
    expect(mockRecompose).toHaveBeenCalledTimes(1);
    expect(mockRecompose).toHaveBeenCalledWith("c-1", "course-1", "welcome", {
      dryRun: true,
    });
  });

  it("dryRun returns null previewDiff when first caller has no baseline (helper returns null)", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([{ callerId: "c-1" }]);
    mockRecompose.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome", dryRun: true }), PARAMS);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.previewDiff).toBeNull();
    expect(body.affectedCallerCount).toBe(1);
    expect(body.note).toContain("PATCH primitive");
  });

  it("live sync (≤20 callers) — patched + skipped + failures aggregated", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c-1" },
      { callerId: "c-2" },
      { callerId: "c-3" },
      { callerId: "c-4" },
    ]);
    mockRecompose.mockResolvedValueOnce({
      dryRun: false,
      sectionKey: "welcome",
      composedPromptId: "cp-1",
      patched: true,
    });
    mockRecompose.mockResolvedValueOnce({
      dryRun: false,
      sectionKey: "welcome",
      composedPromptId: "cp-2",
      patched: false, // same hash, no-op
    });
    mockRecompose.mockResolvedValueOnce(null); // no baseline → skipped
    mockRecompose.mockRejectedValueOnce(new Error("transient"));

    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome" }), PARAMS);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fanoutMode).toBe("sync");
    expect(body.affectedCallerCount).toBe(4);
    expect(body.patched).toBe(1);
    expect(body.skipped).toBe(2);
    expect(body.failures).toEqual(["c-4"]);
  });

  it("live async (>20 callers) — fire-and-forget, returns queued count", async () => {
    const callerIds = Array.from({ length: 25 }, (_, i) => ({
      callerId: `c-${i + 1}`,
    }));
    mockPrisma.callerPlaybook.findMany.mockResolvedValue(callerIds);
    mockRecompose.mockResolvedValue({
      dryRun: false,
      sectionKey: "welcome",
      composedPromptId: "cp-x",
      patched: true,
    });

    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome" }), PARAMS);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fanoutMode).toBe("async");
    expect(body.queued).toBe(25);
    // 25 fire-and-forget calls.
    expect(mockRecompose).toHaveBeenCalledTimes(25);
  });

  it("live with zero callers — clean empty success", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
    const { POST } = await loadRoute();
    const res = await POST(req({ sectionKey: "welcome" }), PARAMS);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      sectionKey: "welcome",
      fanoutMode: "sync",
      affectedCallerCount: 0,
      patched: 0,
      skipped: 0,
      failures: [],
    });
    expect(mockRecompose).not.toHaveBeenCalled();
  });
});
