import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────

const mockRequireAuth = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  isAuthError: (result: any) => !!result.error,
}));

const mockPrisma = {
  curriculum: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  contentAssertion: {
    groupBy: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

const mockAICompletion = vi.fn();
vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) => mockAICompletion(...args),
}));

vi.mock("@/lib/ai/assistant-wrapper", () => ({
  logAssistantCall: vi.fn(),
}));

const mockStartTaskTracking = vi.fn();
const mockUpdateTaskProgress = vi.fn();
const mockCompleteTask = vi.fn();
const mockFailTask = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ai/task-guidance", () => ({
  startTaskTracking: (...args: any[]) => mockStartTaskTracking(...args),
  updateTaskProgress: (...args: any[]) => mockUpdateTaskProgress(...args),
  completeTask: (...args: any[]) => mockCompleteTask(...args),
  failTask: (...args: any[]) => mockFailTask(...args),
  backgroundRun: (taskId: string, fn: () => Promise<void>) => {
    fn().catch(async (err: any) => {
      mockFailTask(taskId, err instanceof Error ? err.message : String(err));
    });
  },
}));

// ── Helpers ────────────────────────────────────────────

function mockAuth(role = "OPERATOR", userId = "user-1") {
  mockRequireAuth.mockResolvedValue({
    session: { user: { id: userId, role } },
  });
}

function mockAuthFail() {
  mockRequireAuth.mockResolvedValue({
    error: new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  });
}

const CURRICULUM_ID = "curr-1";
const PARAMS = Promise.resolve({ curriculumId: CURRICULUM_ID });

function makeRequest(method: string, body?: any) {
  const url = `http://localhost/api/curricula/${CURRICULUM_ID}/lesson-plan`;
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

// ── Tests: GET lesson plan ─────────────────────────────

describe("GET /api/curricula/:curriculumId/lesson-plan", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/curricula/[curriculumId]/lesson-plan/route");
    GET = mod.GET;
  });

  it("returns lesson plan when it exists", async () => {
    mockAuth("VIEWER");
    const plan = {
      estimatedSessions: 3,
      entries: [
        { session: 1, type: "onboarding", moduleId: null, moduleLabel: "", label: "Welcome" },
        { session: 2, type: "introduce", moduleId: "MOD-1", moduleLabel: "Module 1", label: "Intro M1" },
        { session: 3, type: "assess", moduleId: null, moduleLabel: "", label: "Final Quiz" },
      ],
    };
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      deliveryConfig: { sessionStructure: ["Review", "New content"], lessonPlan: plan },
    });

    const res = await GET(makeRequest("GET"), { params: PARAMS });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.plan.estimatedSessions).toBe(3);
    expect(data.plan.entries).toHaveLength(3);
  });

  it("returns null when no lesson plan exists", async () => {
    mockAuth("VIEWER");
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      deliveryConfig: { sessionStructure: ["Review"] },
    });

    const res = await GET(makeRequest("GET"), { params: PARAMS });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.plan).toBeNull();
  });

  it("returns null when deliveryConfig is null", async () => {
    mockAuth("VIEWER");
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      deliveryConfig: null,
    });

    const res = await GET(makeRequest("GET"), { params: PARAMS });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.plan).toBeNull();
  });

  it("returns 404 for non-existent curriculum", async () => {
    mockAuth("VIEWER");
    mockPrisma.curriculum.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest("GET"), { params: PARAMS });
    expect(res.status).toBe(404);
  });
});

// ── Tests: PUT lesson plan ─────────────────────────────

describe("PUT /api/curricula/:curriculumId/lesson-plan", () => {
  let PUT: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/curricula/[curriculumId]/lesson-plan/route");
    PUT = mod.PUT;
  });

  it("saves a valid lesson plan", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      deliveryConfig: { sessionStructure: ["Review"] },
    });
    mockPrisma.curriculum.update.mockResolvedValue({ id: CURRICULUM_ID });

    const entries = [
      { session: 1, type: "onboarding", label: "Welcome", moduleId: null, moduleLabel: "" },
      { session: 2, type: "introduce", label: "Module 1 Intro", moduleId: "MOD-1", moduleLabel: "Module 1" },
    ];

    const res = await PUT(makeRequest("PUT", { entries }), { params: PARAMS });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.plan.estimatedSessions).toBe(2);
    expect(data.plan.entries).toHaveLength(2);
    expect(data.plan.generatedFrom).toBe("manual");

    // Verify DB update preserves existing deliveryConfig keys
    expect(mockPrisma.curriculum.update).toHaveBeenCalledWith({
      where: { id: CURRICULUM_ID },
      data: {
        deliveryConfig: {
          sessionStructure: ["Review"],
          lessonPlan: expect.objectContaining({
            estimatedSessions: 2,
            entries: expect.any(Array),
          }),
        },
      },
    });
  });

  it("rejects empty entries", async () => {
    mockAuth();
    const res = await PUT(makeRequest("PUT", { entries: [] }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("rejects non-sequential session numbers", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      deliveryConfig: null,
    });

    const entries = [
      { session: 1, type: "onboarding", label: "Welcome" },
      { session: 3, type: "introduce", label: "Skipped 2" }, // gap!
    ];

    const res = await PUT(makeRequest("PUT", { entries }), { params: PARAMS });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("sequential");
  });

  it("rejects invalid session type", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      deliveryConfig: null,
    });

    const entries = [
      { session: 1, type: "invalid_type", label: "Bad session" },
    ];

    const res = await PUT(makeRequest("PUT", { entries }), { params: PARAMS });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid session type");
  });

  it("rejects more than 100 sessions", async () => {
    mockAuth();
    const entries = Array.from({ length: 101 }, (_, i) => ({
      session: i + 1,
      type: "introduce",
      label: `Session ${i + 1}`,
    }));

    const res = await PUT(makeRequest("PUT", { entries }), { params: PARAMS });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("100");
  });

  it("returns 404 for non-existent curriculum", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue(null);

    const entries = [{ session: 1, type: "onboarding", label: "Welcome" }];
    const res = await PUT(makeRequest("PUT", { entries }), { params: PARAMS });
    expect(res.status).toBe(404);
  });
});

// ── Tests: POST generate lesson plan ───────────────────

describe("POST /api/curricula/:curriculumId/lesson-plan (generate)", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStartTaskTracking.mockResolvedValue("task-1");
    mockUpdateTaskProgress.mockResolvedValue(undefined);
    mockCompleteTask.mockResolvedValue(undefined);
    const mod = await import("@/app/api/curricula/[curriculumId]/lesson-plan/route");
    POST = mod.POST;
  });

  it("returns 202 with taskId for async generation", async () => {
    mockAuth();
    // First call: POST handler checks existence with select { id, notableInfo }
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: {
        modules: [
          { id: "MOD-1", title: "State Pension", learningOutcomes: ["LO1", "LO2"] },
          { id: "MOD-2", title: "Occupational Pensions", learningOutcomes: ["LO3"] },
        ],
      },
    });

    const res = await POST(makeRequest("POST", {}), { params: PARAMS });
    const data = await res.json();

    expect(res.status).toBe(202);
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe("task-1");

    // Verify task tracking was started
    expect(mockStartTaskTracking).toHaveBeenCalledWith(
      "user-1",
      "lesson_plan",
      expect.objectContaining({ curriculumId: CURRICULUM_ID }),
    );
  });

  it("returns 400 when curriculum has no modules", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: { modules: [] },
    });

    const res = await POST(makeRequest("POST"), { params: PARAMS });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("no modules");
  });

  it("returns 404 for non-existent curriculum", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest("POST"), { params: PARAMS });
    expect(res.status).toBe(404);
  });

  it("returns 202 for async generation (previously tested sync markdown-wrapped JSON)", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: { modules: [{ id: "M1", title: "Topic", learningOutcomes: ["LO1"] }] },
    });

    const res = await POST(makeRequest("POST"), { params: PARAMS });
    const data = await res.json();
    expect(res.status).toBe(202);
    expect(data.ok).toBe(true);
    expect(data.taskId).toBe("task-1");
  });

  it("passes totalSessionTarget via task context", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: { modules: [{ id: "M1", title: "Topic", learningOutcomes: [] }] },
    });

    const res = await POST(makeRequest("POST", { totalSessionTarget: 10 }), { params: PARAMS });
    expect(res.status).toBe(202);

    // Task tracking receives the parameters
    expect(mockStartTaskTracking).toHaveBeenCalledWith(
      "user-1",
      "lesson_plan",
      expect.objectContaining({ totalSessionTarget: 10 }),
    );
  });

  it("passes durationMins via task context", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: { modules: [{ id: "M1", title: "Topic", learningOutcomes: [] }] },
    });

    const res = await POST(makeRequest("POST", { durationMins: 45 }), { params: PARAMS });
    expect(res.status).toBe(202);

    expect(mockStartTaskTracking).toHaveBeenCalledWith(
      "user-1",
      "lesson_plan",
      expect.objectContaining({ durationMins: 45 }),
    );
  });

  it("passes emphasis via task context", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: { modules: [{ id: "M1", title: "Topic", learningOutcomes: [] }] },
    });

    const res = await POST(makeRequest("POST", { emphasis: "depth" }), { params: PARAMS });
    expect(res.status).toBe(202);

    expect(mockStartTaskTracking).toHaveBeenCalledWith(
      "user-1",
      "lesson_plan",
      expect.objectContaining({ emphasis: "depth" }),
    );
  });

  it("passes includeAssessments via task context", async () => {
    mockAuth();
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: CURRICULUM_ID,
      notableInfo: { modules: [{ id: "M1", title: "Topic", learningOutcomes: [] }] },
    });

    const res = await POST(makeRequest("POST", { includeAssessments: "none" }), { params: PARAMS });
    expect(res.status).toBe(202);

    expect(mockStartTaskTracking).toHaveBeenCalledWith(
      "user-1",
      "lesson_plan",
      expect.objectContaining({ includeAssessments: "none" }),
    );
  });
});
