/**
 * Tests for curriculum-runner.ts
 *
 * Verifies that startCurriculumGeneration:
 *   - Creates a UserTask and returns taskId immediately
 *   - Loads assertions and calls AI in the background
 *   - Abandons task when subject not found
 *   - Abandons task when no sources attached
 *   - Abandons task when no assertions found
 *   - Abandons task when AI call fails
 *   - Stores preview in task context on success
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup (vi.hoisted to avoid TDZ in mock factories) ──

const mockPrisma = vi.hoisted(() => ({
  subject: {
    findUnique: vi.fn(),
  },
  subjectSource: {
    findMany: vi.fn(),
  },
  contentAssertion: {
    findMany: vi.fn(),
  },
  userTask: {
    update: vi.fn(),
  },
}));

const mockStartTaskTracking = vi.hoisted(() =>
  vi.fn().mockResolvedValue("task-123")
);
const mockUpdateTaskProgress = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCompleteTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFailTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockExtractCurriculum = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

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

vi.mock("@/lib/content-trust/extract-curriculum", () => ({
  extractCurriculumFromAssertions: (...args: any[]) => mockExtractCurriculum(...args),
}));

import { startCurriculumGeneration } from "@/lib/jobs/curriculum-runner";

// ── Helpers ──

/** Wait for fire-and-forget background work to settle */
async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 50));
}

function setupHappyPath() {
  mockPrisma.subject.findUnique.mockResolvedValue({
    id: "sub-1",
    slug: "food-safety-l2",
    qualificationRef: "FS-L2",
  });
  mockPrisma.subjectSource.findMany.mockResolvedValue([
    { sourceId: "src-1" },
  ]);
  mockPrisma.contentAssertion.findMany.mockResolvedValue([
    { assertion: "Wash hands before cooking", category: "hygiene", chapter: "1", section: "1.1", tags: [] },
    { assertion: "Cook chicken to 75°C", category: "temperature", chapter: "2", section: "2.1", tags: [] },
  ]);
  mockExtractCurriculum.mockResolvedValue({
    ok: true,
    modules: [{ title: "Introduction" }],
    warnings: [],
  });
}

// ── Tests ──

describe("startCurriculumGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a task and returns taskId immediately", async () => {
    setupHappyPath();

    const taskId = await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");

    expect(taskId).toBe("task-123");
    expect(mockStartTaskTracking).toHaveBeenCalledWith("user-1", "curriculum_generation", {
      subjectId: "sub-1",
      subjectName: "Food Safety L2",
    });
  });

  it("completes task with preview on success", async () => {
    setupHappyPath();

    await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");
    await flushMicrotasks();

    expect(mockExtractCurriculum).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ assertion: "Wash hands before cooking" }),
      ]),
      "Food Safety L2",
      "FS-L2",
    );
    expect(mockCompleteTask).toHaveBeenCalledWith("task-123");
    // Should store preview in step 3
    expect(mockUpdateTaskProgress).toHaveBeenCalledWith("task-123", {
      currentStep: 3,
      context: {
        preview: expect.objectContaining({ ok: true }),
        moduleCount: 1,
        warnings: [],
        summary: {
          subject: { id: "sub-1", name: "Food Safety L2" },
          counts: { modules: 1, assertions: 2 },
        },
      },
    });
  });

  it("abandons task when subject not found", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue(null);

    await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");
    await flushMicrotasks();

    expect(mockFailTask).toHaveBeenCalledWith("task-123", "Subject not found");
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it("abandons task when no sources attached", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1", qualificationRef: null });
    mockPrisma.subjectSource.findMany.mockResolvedValue([]);

    await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");
    await flushMicrotasks();

    expect(mockFailTask).toHaveBeenCalledWith("task-123", "No sources attached to this subject");
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it("abandons task when no assertions found", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1", qualificationRef: null });
    mockPrisma.subjectSource.findMany.mockResolvedValue([{ sourceId: "src-1" }]);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);

    await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");
    await flushMicrotasks();

    expect(mockFailTask).toHaveBeenCalledWith("task-123", "No assertions found. Extract documents first.");
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it("abandons task when AI extraction fails", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1", qualificationRef: null });
    mockPrisma.subjectSource.findMany.mockResolvedValue([{ sourceId: "src-1" }]);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([
      { assertion: "Test", category: "test", chapter: "1", section: "1.1", tags: [] },
    ]);
    mockExtractCurriculum.mockResolvedValue({
      ok: false,
      error: "AI model error",
      warnings: ["Rate limited"],
    });

    await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");
    await flushMicrotasks();

    expect(mockFailTask).toHaveBeenCalledWith("task-123", "AI model error");
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it("prefers syllabus-tagged sources", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({ id: "sub-1", qualificationRef: null });
    // First call with syllabus tag returns results
    mockPrisma.subjectSource.findMany.mockResolvedValueOnce([
      { sourceId: "syllabus-src" },
    ]);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([
      { assertion: "From syllabus", category: "core", chapter: "1", section: "1.1", tags: [] },
    ]);
    mockExtractCurriculum.mockResolvedValue({
      ok: true,
      modules: [{ title: "Module 1" }],
      warnings: [],
    });

    await startCurriculumGeneration("sub-1", "Food Safety L2", "user-1");
    await flushMicrotasks();

    // Should query assertions with the syllabus source
    expect(mockPrisma.contentAssertion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId: { in: ["syllabus-src"] } },
      }),
    );
  });
});
