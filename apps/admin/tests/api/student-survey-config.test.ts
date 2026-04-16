import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──
vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerPlaybook: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/student-access", () => ({
  requireStudentOrAdmin: vi.fn(),
  isStudentAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/learner/survey-config", () => ({
  DEFAULT_ONBOARDING_SURVEY: [{ id: "default_pre", type: "text", prompt: "Default pre" }],
  DEFAULT_OFFBOARDING_SURVEY: [{ id: "default_post", type: "text", prompt: "Default post" }],
  DEFAULT_OFFBOARDING_TRIGGER: 5,
  getSurveyTemplateConfig: vi.fn().mockResolvedValue({
    templates: {
      pre_survey: { questions: [{ id: "contract_pre", type: "stars", prompt: "Contract pre" }], endAction: { type: "next_stop" } },
      post_survey: { questions: [{ id: "contract_post", type: "stars", prompt: "Contract post" }], endAction: { type: "next_stop" } },
    },
  }),
}));

vi.mock("@/lib/assessment/personality-defaults", () => ({
  DEFAULT_PERSONALITY_QUESTIONS: [{ id: "default_personality", type: "stars", prompt: "Default personality" }],
}));

import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin } from "@/lib/student-access";
import { GET } from "@/app/api/student/survey-config/route";
import { NextRequest } from "next/server";

const mocks = {
  findFirst: (prisma.callerPlaybook.findFirst as ReturnType<typeof vi.fn>),
  auth: (requireStudentOrAdmin as ReturnType<typeof vi.fn>),
};

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/student/survey-config");
}

describe("GET /api/student/survey-config — resolution chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ callerId: "caller-1", userId: "user-1" });
  });

  it("returns 404 when no active enrollment", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it("uses contract defaults when no overrides", async () => {
    mocks.findFirst.mockResolvedValue({
      playbook: { config: {}, name: "Test Course", domain: { name: "Maths" } },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.subject).toBe("Maths");
    // Pre-survey: contract defaults (no playbook override, no legacy)
    expect(data.onboarding.surveySteps[0].id).toBe("contract_pre");
    // Post-survey: contract defaults
    expect(data.offboarding.surveySteps[0].id).toBe("contract_post");
  });

  it("prefers playbook config.surveys over contract defaults", async () => {
    mocks.findFirst.mockResolvedValue({
      playbook: {
        config: {
          surveys: {
            pre: { enabled: true, questions: [{ id: "custom_pre", type: "text", prompt: "Custom pre" }] },
            post: { enabled: true, questions: [{ id: "custom_post", type: "text", prompt: "Custom post" }] },
          },
        },
        name: "Test Course",
        domain: { name: "Science" },
      },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.onboarding.surveySteps[0].id).toBe("custom_pre");
    expect(data.offboarding.surveySteps[0].id).toBe("custom_post");
  });

  it("falls back to legacy onboardingFlowPhases for pre-survey", async () => {
    mocks.findFirst.mockResolvedValue({
      playbook: {
        config: {
          onboardingFlowPhases: {
            phases: [{ phase: "survey", surveySteps: [{ id: "legacy_pre", type: "text", prompt: "Legacy pre" }] }],
          },
        },
        name: "Test Course",
        domain: { name: "English" },
      },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    // Pre: legacy fallback
    expect(data.onboarding.surveySteps[0].id).toBe("legacy_pre");
  });

  it("returns assessment config with personality defaults", async () => {
    mocks.findFirst.mockResolvedValue({
      playbook: { config: {}, name: "Test Course", domain: { name: "Physics" } },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.assessment.personality.enabled).toBe(true);
    expect(data.assessment.personality.questions[0].id).toBe("default_personality");
    expect(data.assessment.preTest.enabled).toBe(true);
    expect(data.assessment.preTest.questionCount).toBe(5);
    expect(data.assessment.postTest.enabled).toBe(true);
  });

  it("returns playbook personality override when set", async () => {
    mocks.findFirst.mockResolvedValue({
      playbook: {
        config: {
          assessment: {
            personality: { enabled: true, questions: [{ id: "custom_pers", type: "options", prompt: "Custom" }] },
          },
        },
        name: "Test Course",
        domain: { name: "Bio" },
      },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.assessment.personality.questions[0].id).toBe("custom_pers");
  });
});
