import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  mediaAsset: {
    findUnique: vi.fn(),
  },
  callMessage: {
    create: vi.fn(),
  },
  subjectMedia: {
    findMany: vi.fn(),
  },
  caller: {
    findUnique: vi.fn(),
  },
  onboardingSession: {
    findUnique: vi.fn(),
  },
  callerPlaybook: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  playbookSubject: {
    findMany: vi.fn(),
  },
  assertionMedia: {
    groupBy: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@test.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

describe("chat tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // resolvePlaybookId calls callerPlaybook.findFirst + findMany — must return non-undefined
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
    // buildContentCatalog calls assertionMedia.groupBy for assertion context
    mockPrisma.assertionMedia.groupBy.mockResolvedValue([]);
  });

  describe("executeToolCall — share_content", () => {
    it("creates a media CallMessage for valid media", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "passage.png",
        mimeType: "image/png",
        title: "Passage Image",
      });
      mockPrisma.callMessage.create.mockResolvedValue({
        id: "msg-1",
        callId: "call-1",
        role: "assistant",
        content: "Here is the passage",
        mediaId: "media-1",
      });

      const { executeToolCall } = await import("@/app/api/chat/tools");

      const result = await executeToolCall(
        { id: "tu-1", name: "share_content", input: { media_id: "media-1", context: "Here is the passage" } },
        { callerId: "caller-1", callId: "call-1" }
      );

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("shared");
      expect(mockPrisma.callMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          callId: "call-1",
          role: "assistant",
          mediaId: "media-1",
        }),
      });
    });

    it("returns error when media not found", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue(null);

      const { executeToolCall } = await import("@/app/api/chat/tools");

      const result = await executeToolCall(
        { id: "tu-2", name: "share_content", input: { media_id: "nonexistent" } },
        { callerId: "caller-1", callId: "call-1" }
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("not found");
      expect(mockPrisma.callMessage.create).not.toHaveBeenCalled();
    });

    it("returns error for unknown tool", async () => {
      const { executeToolCall } = await import("@/app/api/chat/tools");

      const result = await executeToolCall(
        { id: "tu-3", name: "unknown_tool", input: {} },
        { callerId: "caller-1", callId: "call-1" }
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Unknown tool");
    });
  });

  describe("buildContentCatalog", () => {
    it("builds catalog from caller domain subjects", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: {
          onboardingFlowPhases: null,
          subjects: [{ subjectId: "sub-1" }],
        },
      });
      mockPrisma.onboardingSession.findUnique.mockResolvedValue({ isComplete: true });

      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-1",
            fileName: "passage.pdf",
            mimeType: "application/pdf",
            title: "Chapter 1 Passage",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toContain("Chapter 1 Passage");
      expect(catalog).toContain("media-1");
      expect(catalog).toContain("Available Teaching Materials");
    });

    it("returns null when caller not found", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue(null);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toBeNull();
    });

    it("returns null when no subjects linked", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [] },
      });

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toBeNull();
    });

    it("returns null when no media linked to subjects", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });
      mockPrisma.onboardingSession.findUnique.mockResolvedValue({ isComplete: true });
      mockPrisma.subjectMedia.findMany.mockResolvedValue([]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toBeNull();
    });

    it("annotates media with phase hints for first-call callers", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: {
          onboardingFlowPhases: {
            phases: [
              { phase: "welcome", duration: "2min", goals: ["Greet"] },
              { phase: "first-topic", duration: "5min", goals: ["Teach"], content: [
                { mediaId: "media-1", instruction: "Share the passage for reading" },
              ]},
            ],
          },
          subjects: [{ subjectId: "sub-1" }],
        },
      });
      // No onboarding session = first call in domain
      mockPrisma.onboardingSession.findUnique.mockResolvedValue(null);

      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-1",
            fileName: "black-death.pdf",
            mimeType: "application/pdf",
            title: "Black Death Passage",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
        {
          media: {
            id: "media-2",
            fileName: "quiz.png",
            mimeType: "image/png",
            title: "Quiz Image",
            description: null,
            tags: [],
            source: { documentType: "REFERENCE" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      // Phase-linked media should have annotation
      expect(catalog).toContain('SHARE DURING: "first-topic" phase');
      expect(catalog).toContain("Share the passage for reading");
      // Non-phase media should NOT have annotation
      expect(catalog).toContain("Quiz Image");
      expect(catalog).not.toContain('Quiz Image.*SHARE DURING');
      // Should include the phase instruction note
      expect(catalog).toContain("Items marked with");
    });

    it("does not annotate phase content for returning callers", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: {
          onboardingFlowPhases: {
            phases: [
              { phase: "first-topic", duration: "5min", goals: ["Teach"], content: [
                { mediaId: "media-1", instruction: "Share passage" },
              ]},
            ],
          },
          subjects: [{ subjectId: "sub-1" }],
        },
      });
      // Completed onboarding = returning caller
      mockPrisma.onboardingSession.findUnique.mockResolvedValue({ isComplete: true });

      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-1",
            fileName: "passage.pdf",
            mimeType: "application/pdf",
            title: "Passage",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toContain("Passage");
      expect(catalog).not.toContain("SHARE DURING");
    });

    it("auto-annotates student-visible media for first calls without explicit phase wiring", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: {
          // Flow phases exist but have NO content[] refs (wizard-created course)
          onboardingFlowPhases: {
            phases: [
              { phase: "welcome", duration: "2min", goals: ["Greet"] },
              { phase: "first-topic", duration: "8min", goals: ["Introduce topic"] },
              { phase: "wrap-up", duration: "2min", goals: ["Summarise"] },
            ],
          },
          subjects: [{ subjectId: "sub-1" }],
        },
      });
      // No onboarding session = first call
      mockPrisma.onboardingSession.findUnique.mockResolvedValue(null);

      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-passage",
            fileName: "passage.pdf",
            mimeType: "application/pdf",
            title: "Reading Passage",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
        {
          media: {
            id: "media-worksheet",
            fileName: "worksheet.pdf",
            mimeType: "application/pdf",
            title: "Practice Worksheet",
            description: null,
            tags: [],
            source: { documentType: "WORKSHEET" },
          },
        },
        {
          media: {
            id: "media-lessonplan",
            fileName: "lesson-plan.pdf",
            mimeType: "application/pdf",
            title: "Teacher Lesson Plan",
            description: null,
            tags: [],
            source: { documentType: "LESSON_PLAN" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      // Student-visible types (READING_PASSAGE, WORKSHEET) should get auto-annotated
      expect(catalog).toContain('SHARE DURING: "first-topic" phase');
      expect(catalog).toContain("Reading Passage");
      expect(catalog).toContain("Practice Worksheet");

      // Teacher-only type (LESSON_PLAN) should NOT get SHARE DURING
      expect(catalog).toContain("Teacher Lesson Plan");
      // Count occurrences — lesson plan should not have SHARE DURING
      const lines = catalog!.split("\n").filter((l) => l.startsWith("- "));
      const lessonPlanLine = lines.find((l) => l.includes("Teacher Lesson Plan"));
      expect(lessonPlanLine).not.toContain("SHARE DURING");
    });

    it("skips auto-annotation when explicit phase wiring exists", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: {
          // Flow phases WITH explicit content[] ref (seeded/manually wired)
          onboardingFlowPhases: {
            phases: [
              { phase: "welcome", duration: "2min", goals: ["Greet"] },
              { phase: "first-topic", duration: "8min", goals: ["Teach"], content: [
                { mediaId: "media-passage", instruction: "Share the passage" },
              ]},
            ],
          },
          subjects: [{ subjectId: "sub-1" }],
        },
      });
      mockPrisma.onboardingSession.findUnique.mockResolvedValue(null);

      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-passage",
            fileName: "passage.pdf",
            mimeType: "application/pdf",
            title: "Passage",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
        {
          media: {
            id: "media-worksheet",
            fileName: "worksheet.pdf",
            mimeType: "application/pdf",
            title: "Worksheet",
            description: null,
            tags: [],
            source: { documentType: "WORKSHEET" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      // Explicit wiring should be used (not auto-annotation)
      expect(catalog).toContain("Share the passage");
      // Worksheet should NOT be auto-annotated (explicit wiring exists, so auto-annotation is skipped)
      const lines = catalog!.split("\n").filter((l) => l.startsWith("- "));
      const worksheetLine = lines.find((l) => l.includes("Worksheet"));
      expect(worksheetLine).not.toContain("SHARE DURING");
    });
  });
});
