/**
 * Tests for goal CRUD operations:
 * - POST /api/goals (create)
 * - GET /api/goals/:goalId (read)
 * - PATCH /api/goals/:goalId (update)
 * - DELETE /api/goals/:goalId (delete)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  goal: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...actual,
    GoalType: {
      LEARN: "LEARN",
      ACHIEVE: "ACHIEVE",
      CHANGE: "CHANGE",
      CONNECT: "CONNECT",
      SUPPORT: "SUPPORT",
      CREATE: "CREATE",
    },
    GoalStatus: {
      ACTIVE: "ACTIVE",
      COMPLETED: "COMPLETED",
      PAUSED: "PAUSED",
      ARCHIVED: "ARCHIVED",
    },
  };
});

// =====================================================
// HELPERS
// =====================================================

function makeRequest(url: string, options?: RequestInit) {
  return new Request(url, options) as any;
}

function jsonBody(data: any) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function patchBody(data: any) {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

const mockGoal = {
  id: "goal-1",
  callerId: "caller-1",
  name: "Learn fractions",
  description: null,
  type: "LEARN",
  status: "ACTIVE",
  progress: 0,
  priority: 5,
  startedAt: null,
  completedAt: null,
  targetDate: null,
  createdAt: new Date("2026-02-01"),
  updatedAt: new Date("2026-02-01"),
  caller: {
    id: "caller-1",
    name: "Alice",
    domain: { id: "d1", slug: "math", name: "Math Tutor" },
  },
  playbook: null,
  contentSpec: null,
};

// =====================================================
// TESTS
// =====================================================

describe("/api/goals — POST (create)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should create a goal with defaults", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
    mockPrisma.goal.create.mockResolvedValue(mockGoal);

    const { POST } = await import("../../app/api/goals/route");
    const response = await POST(
      makeRequest("http://localhost/api/goals", jsonBody({
        callerId: "caller-1",
        name: "Learn fractions",
      })),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.goal).toBeDefined();
    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          callerId: "caller-1",
          name: "Learn fractions",
          type: "LEARN",
          status: "ACTIVE",
          priority: 5,
          progress: 0,
        }),
      }),
    );
  });

  it("should create a goal with custom type", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
    mockPrisma.goal.create.mockResolvedValue({ ...mockGoal, type: "ACHIEVE" });

    const { POST } = await import("../../app/api/goals/route");
    const response = await POST(
      makeRequest("http://localhost/api/goals", jsonBody({
        callerId: "caller-1",
        name: "Pass the exam",
        type: "ACHIEVE",
      })),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "ACHIEVE" }),
      }),
    );
  });

  it("should return 400 when callerId is missing", async () => {
    const { POST } = await import("../../app/api/goals/route");
    const response = await POST(
      makeRequest("http://localhost/api/goals", jsonBody({ name: "Test" })),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("callerId");
  });

  it("should return 400 when name is empty", async () => {
    const { POST } = await import("../../app/api/goals/route");
    const response = await POST(
      makeRequest("http://localhost/api/goals", jsonBody({
        callerId: "caller-1",
        name: "  ",
      })),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("name");
  });

  it("should return 404 when caller not found", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);

    const { POST } = await import("../../app/api/goals/route");
    const response = await POST(
      makeRequest("http://localhost/api/goals", jsonBody({
        callerId: "nonexistent",
        name: "Test goal",
      })),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Caller not found");
  });

  it("should default invalid type to LEARN", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "caller-1" });
    mockPrisma.goal.create.mockResolvedValue(mockGoal);

    const { POST } = await import("../../app/api/goals/route");
    await POST(
      makeRequest("http://localhost/api/goals", jsonBody({
        callerId: "caller-1",
        name: "Test",
        type: "INVALID_TYPE",
      })),
    );

    expect(mockPrisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "LEARN" }),
      }),
    );
  });
});

describe("/api/goals/:goalId — GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should return a goal by ID", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);

    const { GET } = await import("../../app/api/goals/[goalId]/route");
    const response = await GET(
      makeRequest("http://localhost/api/goals/goal-1"),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.goal.id).toBe("goal-1");
  });

  it("should return 404 for missing goal", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(null);

    const { GET } = await import("../../app/api/goals/[goalId]/route");
    const response = await GET(
      makeRequest("http://localhost/api/goals/nope"),
      { params: Promise.resolve({ goalId: "nope" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.ok).toBe(false);
  });
});

describe("/api/goals/:goalId — PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should update goal name", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);
    mockPrisma.goal.update.mockResolvedValue({ ...mockGoal, name: "Updated" });

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    const response = await PATCH(
      makeRequest("http://localhost/api/goals/goal-1", patchBody({ name: "Updated" })),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(mockPrisma.goal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Updated" }),
      }),
    );
  });

  it("should auto-set completedAt when status → COMPLETED", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);
    mockPrisma.goal.update.mockResolvedValue({ ...mockGoal, status: "COMPLETED", completedAt: new Date() });

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    await PATCH(
      makeRequest("http://localhost/api/goals/goal-1", patchBody({ status: "COMPLETED" })),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );

    const updateData = mockPrisma.goal.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("COMPLETED");
    expect(updateData.completedAt).toBeInstanceOf(Date);
  });

  it("should clear completedAt when status → ACTIVE from non-ACTIVE", async () => {
    const completedGoal = { ...mockGoal, status: "COMPLETED", completedAt: new Date() };
    mockPrisma.goal.findUnique.mockResolvedValue(completedGoal);
    mockPrisma.goal.update.mockResolvedValue({ ...completedGoal, status: "ACTIVE", completedAt: null });

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    await PATCH(
      makeRequest("http://localhost/api/goals/goal-1", patchBody({ status: "ACTIVE" })),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );

    const updateData = mockPrisma.goal.update.mock.calls[0][0].data;
    expect(updateData.status).toBe("ACTIVE");
    expect(updateData.completedAt).toBeNull();
  });

  it("should return 404 for missing goal", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(null);

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    const response = await PATCH(
      makeRequest("http://localhost/api/goals/nope", patchBody({ name: "X" })),
      { params: Promise.resolve({ goalId: "nope" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.ok).toBe(false);
  });

  it("should return 400 for empty name", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    const response = await PATCH(
      makeRequest("http://localhost/api/goals/goal-1", patchBody({ name: "  " })),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("empty");
  });

  it("should return 400 for invalid type", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    const response = await PATCH(
      makeRequest("http://localhost/api/goals/goal-1", patchBody({ type: "INVALID" })),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Invalid type");
  });

  it("should return 400 for invalid priority", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);

    const { PATCH } = await import("../../app/api/goals/[goalId]/route");
    const response = await PATCH(
      makeRequest("http://localhost/api/goals/goal-1", patchBody({ priority: 99 })),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Priority");
  });
});

describe("/api/goals/:goalId — DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should delete a goal", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(mockGoal);
    mockPrisma.goal.delete.mockResolvedValue(mockGoal);

    const { DELETE } = await import("../../app/api/goals/[goalId]/route");
    const response = await DELETE(
      makeRequest("http://localhost/api/goals/goal-1", { method: "DELETE" }),
      { params: Promise.resolve({ goalId: "goal-1" }) },
    );
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(mockPrisma.goal.delete).toHaveBeenCalledWith({ where: { id: "goal-1" } });
  });

  it("should return 404 for missing goal", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue(null);

    const { DELETE } = await import("../../app/api/goals/[goalId]/route");
    const response = await DELETE(
      makeRequest("http://localhost/api/goals/nope", { method: "DELETE" }),
      { params: Promise.resolve({ goalId: "nope" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.ok).toBe(false);
  });
});
