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
  playbook: {
    findUnique: vi.fn(),
  },
  playbookSubject: {
    findMany: vi.fn(),
  },
  assertionMedia: {
    groupBy: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx: unknown) => tx ?? mockPrisma }));

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
    // #234: shareMaterials check defaults to allowing
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
  });

  describe("executeToolCall — share_content", () => {
    it("returns media metadata without creating a DB message", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "passage.png",
        mimeType: "image/png",
        title: "Passage Image",
      });

      const { executeToolCall } = await import("@/app/api/chat/tools");

      const result = await executeToolCall(
        { id: "tu-1", name: "share_content", input: { media_id: "media-1", context: "Here is the passage" } },
        { callerId: "caller-1", callId: "call-1" }
      );

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("shared");
      // Should return media metadata for the route to pass via header
      expect(result.sharedMedia).toEqual({
        id: "media-1",
        fileName: "passage.png",
        mimeType: "image/png",
        title: "Passage Image",
      });
      // Should NOT create a CallMessage (client handles persistence via observer relay)
      expect(mockPrisma.callMessage.create).not.toHaveBeenCalled();
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

    // ── #234: shareMaterials course-intent flag ─────────────────────────
    it("returns null when playbook has shareMaterials: false (voice-only course)", async () => {
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-voice" });
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { shareMaterials: false },
      });
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toBeNull();
      // Should NOT have queried subjectMedia — the gate fired first
      expect(mockPrisma.subjectMedia.findMany).not.toHaveBeenCalled();
    });

    it("builds catalog normally when shareMaterials is undefined (default)", async () => {
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
      mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
      mockPrisma.playbookSubject.findMany.mockResolvedValue([{ subjectId: "sub-1" }]);
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });
      mockPrisma.onboardingSession.findUnique.mockResolvedValue({ isComplete: true });
      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-1",
            fileName: "passage.pdf",
            mimeType: "application/pdf",
            title: "Chapter 1",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toContain("Chapter 1");
    });

    it("builds catalog when shareMaterials is explicitly true", async () => {
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { shareMaterials: true },
      });
      mockPrisma.playbookSubject.findMany.mockResolvedValue([{ subjectId: "sub-1" }]);
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });
      mockPrisma.onboardingSession.findUnique.mockResolvedValue({ isComplete: true });
      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "media-1",
            fileName: "passage.pdf",
            mimeType: "application/pdf",
            title: "Chapter 1",
            description: null,
            tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1");

      expect(catalog).toContain("Chapter 1");
    });
  });

  // #235: channel-capability gate (compose with #234 course-intent gate)
  describe("buildContentCatalog — channel capability (#235)", () => {
    it("returns null when channel is voice (cannot render rich media)", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1", undefined, undefined, "voice");

      expect(catalog).toBeNull();
      // Channel gate fires before any DB lookup
      expect(mockPrisma.caller.findUnique).not.toHaveBeenCalled();
    });

    it("returns null when channel is sms (no rich media)", async () => {
      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1", undefined, undefined, "sms");
      expect(catalog).toBeNull();
    });

    it("proceeds when channel is web-chat (rich media supported)", async () => {
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
      mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
      mockPrisma.playbookSubject.findMany.mockResolvedValue([{ subjectId: "sub-1" }]);
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });
      mockPrisma.onboardingSession.findUnique.mockResolvedValue({ isComplete: true });
      mockPrisma.subjectMedia.findMany.mockResolvedValue([
        {
          media: {
            id: "m1", fileName: "a.png", mimeType: "image/png", title: "A",
            description: null, tags: [],
            source: { documentType: "READING_PASSAGE" },
          },
        },
      ]);

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1", undefined, undefined, "web-chat");
      expect(catalog).toContain("A");
    });

    it("channel layer wins over course-intent: voice + shareMaterials=true → still blocked", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { shareMaterials: true },
      });

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1", undefined, undefined, "voice");

      expect(catalog).toBeNull();
    });

    it("course-intent layer wins over channel: web-chat + shareMaterials=false → blocked", async () => {
      mockPrisma.caller.findUnique.mockResolvedValue({
        id: "caller-1",
        domainId: "domain-1",
        domain: { onboardingFlowPhases: null, subjects: [{ subjectId: "sub-1" }] },
      });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-voice" });
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { shareMaterials: false },
      });

      const { buildContentCatalog } = await import("@/app/api/chat/tools");
      const catalog = await buildContentCatalog("caller-1", undefined, undefined, "web-chat");

      expect(catalog).toBeNull();
    });
  });

  describe("handleShareContent — channel capability (#235)", () => {
    it("rejects share_content when channel is voice", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        title: "Doc",
        source: { documentType: "REFERENCE" },
      });
      mockPrisma.caller.findUnique.mockResolvedValue({ role: "LEARNER" });

      const { executeToolCall } = await import("@/app/api/chat/tools");
      const result = await executeToolCall(
        { id: "tu", name: "share_content", input: { media_id: "media-1" } },
        { callerId: "caller-1", callId: "call-1", channel: "voice" }
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toMatch(/voice channel|does not support rich/i);
    });

    it("rejects share_content when channel is sms", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        title: "Doc",
        source: { documentType: "READING_PASSAGE" },
      });
      mockPrisma.caller.findUnique.mockResolvedValue({ role: "LEARNER" });

      const { executeToolCall } = await import("@/app/api/chat/tools");
      const result = await executeToolCall(
        { id: "tu", name: "share_content", input: { media_id: "media-1" } },
        { callerId: "caller-1", callId: "call-1", channel: "sms" }
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toMatch(/sms channel|does not support rich/i);
    });

    it("allows share_content on web-chat with default config", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "passage.png",
        mimeType: "image/png",
        title: "Passage",
        source: { documentType: "READING_PASSAGE" },
      });
      mockPrisma.caller.findUnique.mockResolvedValue({ role: "LEARNER" });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
      mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });

      const { executeToolCall } = await import("@/app/api/chat/tools");
      const result = await executeToolCall(
        { id: "tu", name: "share_content", input: { media_id: "media-1" } },
        { callerId: "caller-1", callId: "call-1", channel: "web-chat" }
      );

      expect(result.is_error).toBeFalsy();
      expect(result.sharedMedia?.id).toBe("media-1");
    });
  });

  // #234: defence-in-depth at the execution site
  describe("handleShareContent — shareMaterials gate", () => {
    it("rejects share_content when playbook has shareMaterials: false", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "band-descriptors.pdf",
        mimeType: "application/pdf",
        title: "IELTS Band Descriptors",
        source: { documentType: "REFERENCE" },
      });
      mockPrisma.caller.findUnique.mockResolvedValue({ role: "LEARNER" });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-voice" });
      mockPrisma.playbook.findUnique.mockResolvedValue({
        config: { shareMaterials: false },
      });

      const { executeToolCall } = await import("@/app/api/chat/tools");
      const result = await executeToolCall(
        { id: "tu-1", name: "share_content", input: { media_id: "media-1" } },
        { callerId: "caller-1", callId: "call-1" }
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toMatch(/voice-only|no document delivery|cannot share/i);
      expect(result.sharedMedia).toBeUndefined();
    });

    it("allows share_content when playbook config has no shareMaterials key (default)", async () => {
      mockPrisma.mediaAsset.findUnique.mockResolvedValue({
        id: "media-1",
        fileName: "passage.png",
        mimeType: "image/png",
        title: "Reading Passage",
        source: { documentType: "READING_PASSAGE" },
      });
      mockPrisma.caller.findUnique.mockResolvedValue({ role: "LEARNER" });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb-1" });
      mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });

      const { executeToolCall } = await import("@/app/api/chat/tools");
      const result = await executeToolCall(
        { id: "tu-2", name: "share_content", input: { media_id: "media-1" } },
        { callerId: "caller-1", callId: "call-1" }
      );

      expect(result.is_error).toBeFalsy();
      expect(result.sharedMedia?.id).toBe("media-1");
    });
  });
});
