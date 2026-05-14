import { describe, it, expect, vi, beforeEach } from "vitest";
import { courseSetup } from "@/lib/domain/course-setup";
import type { CourseSetupInput } from "@/lib/domain/course-setup";

const mockPrisma = vi.hoisted(() => ({
  domain: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  subject: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  subjectDomain: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  analysisSpec: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  invite: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  playbook: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/domain/scaffold", () => ({
  scaffoldDomain: vi.fn().mockResolvedValue({
    identitySpec: { id: "spec-1", slug: "test-identity", name: "Test Identity" },
    playbook: { id: "playbook-1", name: "Test Playbook" },
    published: true,
    onboardingConfigured: true,
    skipped: [],
  }),
}));

vi.mock("@/lib/domain/generate-content-spec", () => ({
  generateContentSpec: vi.fn().mockResolvedValue({
    contentSpec: { id: "content-1", slug: "test-content", name: "Content" },
    moduleCount: 5,
  }),
}));

vi.mock("@/lib/content-trust/extract-curriculum", () => ({
  generateCurriculumFromGoals: vi.fn().mockResolvedValue({
    ok: true,
    modules: [{ id: "m1", title: "Module 1" }],
    description: "Generated curriculum",
  }),
}));

vi.mock("@/lib/domain/quick-launch", () => ({
  loadPersonaFlowPhases: vi.fn().mockResolvedValue({ phases: [] }),
}));

vi.mock("@/lib/ai/task-guidance", () => ({
  updateTaskProgress: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock("@/lib/enrollment", () => ({
  enrollCaller: vi.fn(),
  enrollCallerInDomainPlaybooks: vi.fn(),
}));

/**
 * Mock COURSE-SETUP-001 spec with wizard_steps parameter.
 * The "done" step maps to the "create_course" operation internally.
 */
const MOCK_COURSE_SETUP_SPEC = {
  slug: "course-setup-001",
  config: {
    parameters: [
      {
        id: "wizard_steps",
        config: {
          steps: [
            { id: "intent", label: "Intent", activeLabel: "Setting up...", order: 1 },
            { id: "content", label: "Content", activeLabel: "Processing content...", order: 2 },
            { id: "done", label: "Create Course", activeLabel: "Creating course...", order: 3 },
          ],
        },
      },
    ],
  },
};

describe("courseSetup executor", () => {
  const mockInput: CourseSetupInput = {
    courseName: "Test Course",
    learningOutcomes: ["Outcome 1", "Outcome 2"],
    teachingStyle: "tutor",
    sessionCount: 12,
    durationMins: 45,
    emphasis: "balanced",
    welcomeMessage: "Welcome to the course!",
    studentEmails: ["student@example.com"],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Return COURSE-SETUP-001 spec for loadCourseSetupSteps()
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(MOCK_COURSE_SETUP_SPEC);

    // Default mock implementations
    mockPrisma.domain.findFirst.mockResolvedValue(null);
    mockPrisma.domain.create.mockResolvedValue({
      id: "domain-1",
      slug: "test-course",
      name: "Test Course",
    });
    mockPrisma.subject.findFirst.mockResolvedValue(null);
    mockPrisma.subject.create.mockResolvedValue({
      id: "subject-1",
      slug: "test-course",
      name: "Test Course",
    });
    mockPrisma.subjectDomain.findFirst.mockResolvedValue(null);
    mockPrisma.subjectDomain.create.mockResolvedValue({});
    mockPrisma.invite.findFirst.mockResolvedValue(null);
    mockPrisma.invite.create.mockResolvedValue({
      id: "invite-1",
      email: "student@example.com",
    });
  });

  it("creates domain and subject when not provided", async () => {
    const progressUpdates: any[] = [];

    await courseSetup(mockInput, "user-1", "task-1", (event) => {
      progressUpdates.push(event);
    });

    // Should create domain
    expect(mockPrisma.domain.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Test Course",
        }),
      })
    );

    // Should create subject
    expect(mockPrisma.subject.create).toHaveBeenCalled();

    // Should link subject to domain
    expect(mockPrisma.subjectDomain.create).toHaveBeenCalled();
  });

  it("does not create invitations during wizard execution (students step is UI-only)", async () => {
    const emailsToInvite = ["student1@example.com", "student2@example.com"];
    const inputWithEmails = { ...mockInput, studentEmails: emailsToInvite };

    await courseSetup(inputWithEmails, "user-1", "task-1", vi.fn());

    // The "students" step maps to "noop" — invitations are handled by the UI separately
    expect(mockPrisma.invite.create).not.toHaveBeenCalled();
  });

  it("handles empty student list gracefully", async () => {
    const inputNoStudents = { ...mockInput, studentEmails: [] };

    const result = await courseSetup(inputNoStudents, "user-1", "task-1", vi.fn());

    expect(result.invitationCount).toBe(0);
    expect(mockPrisma.invite.create).not.toHaveBeenCalled();
  });

  it("tracks progress through executor steps", async () => {
    const progressUpdates: any[] = [];

    await courseSetup(mockInput, "user-1", "task-1", (event) => {
      progressUpdates.push(event);
    });

    // Should start with "init" phase
    expect(progressUpdates[0].phase).toBe("init");

    // Should end with "ready" phase
    expect(progressUpdates[progressUpdates.length - 1].phase).toBe("ready");

    // Should have multiple progress updates
    expect(progressUpdates.length).toBeGreaterThan(2);
  });

  it("returns CourseSetupResult with required fields", async () => {
    const result = await courseSetup(mockInput, "user-1", "task-1", vi.fn());

    expect(result).toHaveProperty("domainId");
    expect(result).toHaveProperty("playbookId");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
