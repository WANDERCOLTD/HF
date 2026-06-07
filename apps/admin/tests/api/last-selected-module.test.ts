/**
 * Tests for POST /api/callers/[callerId]/last-selected-module — the
 * picker-durability write surface from #1245.
 *
 * Security properties covered:
 *   - STUDENT can only write to own LEARNER caller (foreign callerId
 *     refused with 403 — same leak class as #977 but on the write path).
 *   - OPERATOR+ unrestricted (admin tools surface).
 *   - moduleId must reference a real CurriculumModule (or be null to
 *     clear).
 *   - Invalid body shape rejected.
 *   - Caller not found surfaces 404.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockCallerFindFirst = vi.fn();
const mockCallerUpdate = vi.fn();
const mockModuleFindUnique = vi.fn();
const mockRequireAuth = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: {
      findFirst: (...args: unknown[]) => mockCallerFindFirst(...args),
      update: (...args: unknown[]) => mockCallerUpdate(...args),
    },
    curriculumModule: {
      findUnique: (...args: unknown[]) => mockModuleFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

function makeSession(role: string, userId = "user-1") {
  return {
    session: {
      expires: new Date(Date.now() + 86400000).toISOString(),
      user: { id: userId, email: "u@example.com", name: "U", image: null, role },
    },
  };
}

async function callPost(callerId: string, body: unknown) {
  const mod = await import(
    "@/app/api/callers/[callerId]/last-selected-module/route"
  );
  const req = new Request(`http://test/api/callers/${callerId}/last-selected-module`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req, { params: Promise.resolve({ callerId }) });
  const json = await res.json();
  return { status: res.status, json };
}

describe("POST /api/callers/[callerId]/last-selected-module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("STUDENT scope (own-only)", () => {
    it("writes when callerId matches the session's own LEARNER caller", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("STUDENT"));
      mockCallerFindFirst.mockResolvedValue({ id: "own-caller" });
      mockModuleFindUnique.mockResolvedValue({ id: "mod-1" });
      mockCallerUpdate.mockResolvedValue({ id: "own-caller", lastSelectedModuleId: "mod-1" });

      const { status, json } = await callPost("own-caller", { moduleId: "mod-1" });

      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.lastSelectedModuleId).toBe("mod-1");
      expect(mockCallerUpdate).toHaveBeenCalledWith({
        where: { id: "own-caller" },
        data: { lastSelectedModuleId: "mod-1" },
        select: { id: true, lastSelectedModuleId: true },
      });
    });

    it("refuses 403 when callerId is a different caller (foreign-write leak)", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("STUDENT"));
      mockCallerFindFirst.mockResolvedValue({ id: "own-caller" });

      const { status, json } = await callPost("victim-caller", { moduleId: "mod-1" });

      expect(status).toBe(403);
      expect(json.error).toMatch(/STUDENT cannot write/);
      expect(mockCallerUpdate).not.toHaveBeenCalled();
    });

    it("refuses 403 when STUDENT has no LEARNER profile", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("STUDENT"));
      mockCallerFindFirst.mockResolvedValue(null);

      const { status } = await callPost("any-caller", { moduleId: "mod-1" });

      expect(status).toBe(403);
      expect(mockCallerUpdate).not.toHaveBeenCalled();
    });
  });

  describe("OPERATOR+ scope (unrestricted)", () => {
    it("writes to any caller without the STUDENT own-only check", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
      mockModuleFindUnique.mockResolvedValue({ id: "mod-1" });
      mockCallerUpdate.mockResolvedValue({ id: "any-caller", lastSelectedModuleId: "mod-1" });

      const { status } = await callPost("any-caller", { moduleId: "mod-1" });

      expect(status).toBe(200);
      // STUDENT-scope check is short-circuited
      expect(mockCallerFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("Body validation", () => {
    it("400 on missing moduleId", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
      const { status, json } = await callPost("c-1", { wrong: "shape" });
      expect(status).toBe(400);
      expect(json.error).toBe("invalid body");
    });

    it("accepts null moduleId (clears the persisted pick)", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
      mockCallerUpdate.mockResolvedValue({ id: "c-1", lastSelectedModuleId: null });

      const { status, json } = await callPost("c-1", { moduleId: null });

      expect(status).toBe(200);
      expect(json.lastSelectedModuleId).toBeNull();
      // No module lookup when clearing
      expect(mockModuleFindUnique).not.toHaveBeenCalled();
    });

    it("400 when moduleId references a non-existent module", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
      mockModuleFindUnique.mockResolvedValue(null);

      const { status, json } = await callPost("c-1", { moduleId: "ghost" });

      expect(status).toBe(400);
      expect(json.error).toBe("module not found");
      expect(mockCallerUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Caller not found", () => {
    it("404 when the target Caller doesn't exist (Prisma P2025)", async () => {
      mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
      mockModuleFindUnique.mockResolvedValue({ id: "mod-1" });
      mockCallerUpdate.mockRejectedValue({ code: "P2025" });

      const { status, json } = await callPost("ghost-caller", { moduleId: "mod-1" });

      expect(status).toBe(404);
      expect(json.error).toBe("Caller not found");
    });
  });
});
