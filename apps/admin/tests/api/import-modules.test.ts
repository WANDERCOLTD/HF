/**
 * Tests for POST /api/courses/[courseId]/import-modules
 *
 * Covers:
 * - 401 when unauthenticated
 * - 400 when body is malformed
 * - 404 when course (Playbook) not found
 * - 200 + persistence when markdown contains an authored Module Catalogue
 * - 200 + no persistence when markdown has no Modules signal
 * - 200 + persistence + hasErrors=true when invalid module ID present
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────
// vi.mock() is hoisted above all imports and `const` declarations.
// Use vi.hoisted() so the mock instances exist by the time vi.mock factories run.

const { mockPrisma, mockRequireAuth, mockIsAuthError, mockSyncAuthored } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    // #245 + #318 follow-up: import-modules POST now delegates to the shared
    // importAuthoredModulesIntoPlaybook helper, which itself calls
    // tx.playbook.findUnique + tx.playbook.update. The mock proxies BOTH so
    // existing assertions (on playbook.update + mockSyncAuthored) still pass.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        playbook: {
          findUnique: mockPrisma.playbook.findUnique,
          update: mockPrisma.playbook.update,
        },
      };
      return fn(tx);
    }),
  },
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockSyncAuthored: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

// #245: sync helper mocked so route tests stay focused on routing/persistence.
// The helper has its own dedicated unit test file.
vi.mock("@/lib/wizard/sync-authored-modules-to-curriculum", () => ({
  syncAuthoredModulesToCurriculum: (...args: unknown[]) => mockSyncAuthored(...args),
}));

// Import AFTER mocks
import { GET, POST } from "@/app/api/courses/[courseId]/import-modules/route";

// ── Helpers ──────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/courses/c1/import-modules", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = Promise.resolve({ courseId: "playbook-1" });

const passingAuth = { session: { user: { id: "u1", role: "OPERATOR" } } };

const SMALL_AUTHORED_DOC = `# Course

**Modules authored:** Yes

## Modules

### Module Catalogue

| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |
|---|---|---|---|---|---|---|---|
| \`m1\` | Module One | tutor | Student-led | LR + GRA only | No | No | repeatable |
| \`m2\` | Module Two | examiner | 20 min fixed | All four | Yes | Yes | once |
`;

const INVALID_ID_DOC = `## Modules

### Module Catalogue

| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |
|---|---|---|---|---|---|---|---|
| \`Bad-ID!\` | Bad | tutor | 10 min | LR | No | No | repeatable |
`;

const NO_MODULES_DOC = `# Generic Course

## Course Configuration

**Course name:** Whatever
`;

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockIsAuthError.mockReset();
  mockPrisma.playbook.findUnique.mockReset();
  mockPrisma.playbook.update.mockReset();
  mockSyncAuthored.mockReset();

  mockRequireAuth.mockResolvedValue(passingAuth);
  mockIsAuthError.mockReturnValue(false);
  mockSyncAuthored.mockResolvedValue({
    curriculumId: "curr-1",
    created: 0,
    updated: 0,
    orphaned: 0,
  });
});

// ── Auth ─────────────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/import-modules — auth", () => {
  it("returns the auth error when requireAuth fails", async () => {
    const errorResponse = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockResolvedValue({ error: errorResponse });
    mockIsAuthError.mockReturnValue(true);

    const res = await POST(makeReq({ markdown: SMALL_AUTHORED_DOC }), { params });
    expect(res.status).toBe(401);
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });
});

// ── Validation ───────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/import-modules — body validation", () => {
  it("returns 400 when markdown is missing", async () => {
    const res = await POST(makeReq({}), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid body");
    expect(body.issues).toBeDefined();
  });

  it("returns 400 when markdown is empty string", async () => {
    const res = await POST(makeReq({ markdown: "" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when sourceRef shape is wrong", async () => {
    const res = await POST(
      makeReq({ markdown: SMALL_AUTHORED_DOC, sourceRef: { docId: "x" } }), // missing version
      { params },
    );
    expect(res.status).toBe(400);
  });
});

// ── Course lookup ────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/import-modules — course lookup", () => {
  it("returns 404 when the playbook does not exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq({ markdown: SMALL_AUTHORED_DOC }), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Course not found");
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });
});

// ── Happy paths ──────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/import-modules — persistence", () => {
  it("parses authored modules, persists them, returns 200", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: { lessonPlanMode: "continuous" },
    });
    mockPrisma.playbook.update.mockResolvedValue({});

    const res = await POST(makeReq({ markdown: SMALL_AUTHORED_DOC }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.modulesAuthored).toBe(true);
    expect(body.modules).toHaveLength(2);
    expect(body.modules[0].id).toBe("m1");
    expect(body.modules[1].id).toBe("m2");
    expect(body.persisted).toBe(true);
    expect(body.hasErrors).toBe(false);

    expect(mockPrisma.playbook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "playbook-1" },
        data: expect.objectContaining({
          config: expect.objectContaining({
            modulesAuthored: true,
            moduleSource: "authored",
            modules: expect.any(Array),
            // Existing config preserved
            lessonPlanMode: "continuous",
          }),
        }),
      }),
    );
  });

  it("records sourceRef when provided", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "playbook-1", config: {} });
    mockPrisma.playbook.update.mockResolvedValue({});

    await POST(
      makeReq({
        markdown: SMALL_AUTHORED_DOC,
        sourceRef: { docId: "doc-7", version: "2.2" },
      }),
      { params },
    );

    expect(mockPrisma.playbook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          config: expect.objectContaining({
            moduleSourceRef: { docId: "doc-7", version: "2.2" },
          }),
        }),
      }),
    );
  });

  it("returns persisted=false when markdown has no Modules signal at all", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: { lessonPlanMode: "continuous" },
    });

    const res = await POST(makeReq({ markdown: NO_MODULES_DOC }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.modulesAuthored).toBeNull();
    expect(body.persisted).toBe(false);
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });

  it("returns hasErrors=true and still 200 when invalid module ID present", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "playbook-1", config: {} });
    mockPrisma.playbook.update.mockResolvedValue({});

    const res = await POST(makeReq({ markdown: INVALID_ID_DOC }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.modulesAuthored).toBe(true);
    expect(body.hasErrors).toBe(true);
    expect(body.modules).toHaveLength(0); // Bad ID rejected
    const idError = body.validationWarnings.find(
      (w: { code: string }) => w.code === "MODULE_ID_INVALID",
    );
    expect(idError).toBeDefined();
    // Still persisted — caller decides whether to surface as blocker
    expect(body.persisted).toBe(true);
    // No modules to sync (all rejected as invalid)
    expect(mockSyncAuthored).not.toHaveBeenCalled();
  });

  // ── #245 sync ─────────────────────────────────────────────────────

  it("calls syncAuthoredModulesToCurriculum when modules are persisted", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "playbook-1", config: {} });
    mockPrisma.playbook.update.mockResolvedValue({});
    mockSyncAuthored.mockResolvedValue({
      curriculumId: "curr-1",
      created: 2,
      updated: 0,
      orphaned: 0,
    });

    const res = await POST(makeReq({ markdown: SMALL_AUTHORED_DOC }), { params });
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(mockSyncAuthored).toHaveBeenCalledOnce();
    const call = mockSyncAuthored.mock.calls[0];
    expect(call[1]).toBe("playbook-1");
    expect(call[2]).toHaveLength(2);
    expect(body.curriculumSync).toEqual({
      curriculumId: "curr-1",
      created: 2,
      updated: 0,
      orphaned: 0,
    });
  });

  it("skips sync when markdown opts out of authored modules (modulesAuthored=false)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "playbook-1", config: {} });
    mockPrisma.playbook.update.mockResolvedValue({});

    const NO_DOC = `## Modules\n\n**Modules authored:** No\n`;
    const res = await POST(makeReq({ markdown: NO_DOC }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modulesAuthored).toBe(false);
    expect(body.persisted).toBe(true);
    // Decision is recorded, but no modules to sync
    expect(mockSyncAuthored).not.toHaveBeenCalled();
  });
});

// ── GET handler ─────────────────────────────────────────────────

function makeGetReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/courses/c1/import-modules");
}

describe("GET /api/courses/[courseId]/import-modules", () => {
  it("returns the auth error when requireAuth fails", async () => {
    const errorResponse = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockResolvedValue({ error: errorResponse });
    mockIsAuthError.mockReturnValue(true);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(401);
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the playbook does not exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Course not found");
  });

  it("returns empty state when no authored modules persisted yet", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: { lessonPlanMode: "continuous" },
    });
    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modulesAuthored).toBeNull();
    expect(body.modules).toEqual([]);
    expect(body.moduleDefaults).toEqual({});
    expect(body.moduleSource).toBeNull();
    expect(body.moduleSourceRef).toBeNull();
    expect(body.hasErrors).toBe(false);
    // PR4: lessonPlanMode surfaced for the learner-picker preview
    expect(body.lessonPlanMode).toBe("continuous");
  });

  it("returns persisted modules + warnings + hasErrors", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: {
        modulesAuthored: true,
        moduleSource: "authored",
        moduleSourceRef: { docId: "doc-9", version: "2.2" },
        modules: [
          { id: "m1", label: "Module One", learnerSelectable: true, mode: "tutor",
            duration: "Student-led", scoringFired: "LR + GRA only", voiceBandReadout: false,
            sessionTerminal: false, frequency: "repeatable", outcomesPrimary: [],
            prerequisites: [] },
        ],
        moduleDefaults: { mode: "tutor" },
        validationWarnings: [
          { code: "MODULE_FIELD_DEFAULTED", message: "x", severity: "warning" },
          { code: "MODULE_ID_INVALID", message: "y", severity: "error" },
        ],
      },
    });
    const res = await GET(makeGetReq(), { params });
    const body = await res.json();
    expect(body.modulesAuthored).toBe(true);
    expect(body.modules).toHaveLength(1);
    expect(body.moduleSource).toBe("authored");
    expect(body.moduleSourceRef).toEqual({ docId: "doc-9", version: "2.2" });
    expect(body.validationWarnings).toHaveLength(2);
    expect(body.hasErrors).toBe(true);
  });
});
