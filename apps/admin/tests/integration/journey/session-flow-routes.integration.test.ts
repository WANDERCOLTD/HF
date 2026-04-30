/**
 * Session Flow Route Integration Test
 *
 * Validates that the journey-position route produces correct responses
 * with both legacy (flag OFF) and resolver (flag ON) code paths, against
 * a real Postgres database. No mocking of Prisma — only the auth helper
 * is stubbed so we can exercise downstream route logic without juggling
 * NextAuth session cookies.
 *
 * Coverage:
 *   - Continuous-mode pre-test redirect (legacy ↔ resolver byte-equal)
 *   - Continuous-mode NPS redirect (legacy ↔ resolver byte-equal)
 *   - Structured-mode NPS gap closure (flag-off → no NPS; flag-on → NPS)
 *   - Knowledge Check delivery mode split (mcq → pre-test; socratic → no pre-test)
 *
 * @see app/api/student/journey-position/route.ts
 * @see GitHub issues #218, #222
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

// Stub auth so we can drive the route with a known callerId.
// The resolver / runner / evaluator code paths are NOT stubbed.
let TEST_CALLER_ID: string | null = null;
vi.mock("@/lib/student-access", () => ({
  isStudentAuthError: (r: unknown) => r !== null && typeof r === "object" && r !== null && "error" in r,
  requireStudentOrAdmin: async () => {
    if (!TEST_CALLER_ID) throw new Error("TEST_CALLER_ID not set");
    return {
      session: { user: { id: "test-user", role: "LEARNER" } } as unknown,
      callerId: TEST_CALLER_ID,
      cohortGroupId: "test-cohort",
      cohortGroupIds: ["test-cohort"],
      institutionId: null,
    };
  },
}));

import { GET } from "@/app/api/student/journey-position/route";
import { NextRequest } from "next/server";

const prisma = new PrismaClient();
const TAG = "session-flow-routes-test";

interface TestSetup {
  callerId: string;
  playbookId: string;
  domainId: string;
  curriculumId: string;
}

/**
 * Seed a single fixture: domain, playbook, curriculum, caller, enrolment.
 * Idempotent. Cleanup runs in afterAll.
 */
async function seedFixture(opts: {
  lessonPlanMode: "continuous" | "structured";
  config: Record<string, unknown>;
  totalCalls?: number;
  surveysSubmitted?: ("PRE" | "POST" | "PRE_TEST")[];
  modulesMastered?: number;
  totalModules?: number;
  onboardingComplete?: boolean;
}): Promise<TestSetup> {
  // Domain
  const domain = await prisma.domain.create({
    data: {
      slug: `${TAG}-domain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${TAG} domain`,
      kind: "INSTITUTION",
    },
  });

  // Playbook with the test config
  const playbook = await prisma.playbook.create({
    data: {
      name: `${TAG} playbook`,
      domainId: domain.id,
      status: "PUBLISHED",
      config: {
        lessonPlanMode: opts.lessonPlanMode,
        ...opts.config,
      },
    },
  });

  // Curriculum + module + TPs (enough to compute progress)
  const curriculum = await prisma.curriculum.create({
    data: {
      slug: `${TAG}-cur-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: "Test curriculum",
      playbookId: playbook.id,
      deliveryConfig: { sessionCount: 5 } as object,
    },
  });

  const totalModules = opts.totalModules ?? 1;
  const masteredModules = opts.modulesMastered ?? 0;

  for (let i = 0; i < totalModules; i++) {
    await prisma.curriculumModule.create({
      data: {
        slug: `${TAG}-mod-${i}-${Date.now()}`,
        title: `Module ${i}`,
        curriculumId: curriculum.id,
        sortOrder: i,
      },
    });
  }

  // Caller
  const caller = await prisma.caller.create({
    data: {
      name: `${TAG} caller`,
      role: "LEARNER",
      domainId: domain.id,
    },
  });

  // Enrolment
  await prisma.callerPlaybook.create({
    data: {
      callerId: caller.id,
      playbookId: playbook.id,
      status: "ACTIVE",
    },
  });

  // Onboarding session
  await prisma.onboardingSession.create({
    data: {
      callerId: caller.id,
      domainId: domain.id,
      isComplete: opts.onboardingComplete ?? true,
    },
  });

  // Synthesise calls so callCount matches (Call.endedAt drives callCount)
  for (let i = 0; i < (opts.totalCalls ?? 0); i++) {
    await prisma.call.create({
      data: {
        callerId: caller.id,
        source: "test",
        transcript: "",
        endedAt: new Date(Date.now() - 60000 * i),
      },
    });
  }

  // Synthesise survey attribute records
  for (const scope of opts.surveysSubmitted ?? []) {
    await prisma.callerAttribute.create({
      data: {
        callerId: caller.id,
        scope,
        key: "submitted_at",
        valueType: "STRING",
        stringValue: new Date().toISOString(),
      },
    });
  }

  return {
    callerId: caller.id,
    playbookId: playbook.id,
    domainId: domain.id,
    curriculumId: curriculum.id,
  };
}

async function cleanup(): Promise<void> {
  // Order matters — child rows first
  await prisma.callerAttribute.deleteMany({ where: { caller: { name: { contains: TAG } } } });
  await prisma.call.deleteMany({ where: { caller: { name: { contains: TAG } } } });
  await prisma.onboardingSession.deleteMany({ where: { caller: { name: { contains: TAG } } } });
  await prisma.callerPlaybook.deleteMany({ where: { caller: { name: { contains: TAG } } } });
  await prisma.caller.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.curriculumModule.deleteMany({ where: { slug: { contains: TAG } } });
  await prisma.curriculum.deleteMany({ where: { slug: { contains: TAG } } });
  await prisma.playbook.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.domain.deleteMany({ where: { slug: { contains: TAG } } });
}

async function callRoute(): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new NextRequest("http://localhost:3000/api/student/journey-position");
  const res = await GET(req);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(() => {
  delete process.env.SESSION_FLOW_RESOLVER_ENABLED;
});

afterEach(() => {
  delete process.env.SESSION_FLOW_RESOLVER_ENABLED;
});

describe("journey-position — continuous mode byte-equal", () => {
  it("pre-test redirect identical between flag states", async () => {
    const setup = await seedFixture({
      lessonPlanMode: "continuous",
      config: {
        welcome: {
          goals: { enabled: false },
          aboutYou: { enabled: false },
          knowledgeCheck: { enabled: true },
          aiIntroCall: { enabled: false },
        },
        nps: { enabled: false, trigger: "mastery", threshold: 80 },
      },
      totalCalls: 1,
      onboardingComplete: true,
    });
    TEST_CALLER_ID = setup.callerId;

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "false";
    const off = await callRoute();

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "true";
    const on = await callRoute();

    expect(on.status).toBe(off.status);
    expect((on.body.nextStop as { type: string })?.type).toBe(
      (off.body.nextStop as { type: string })?.type,
    );
    expect((on.body.nextStop as { redirect: string })?.redirect).toBe(
      (off.body.nextStop as { redirect: string })?.redirect,
    );
    expect((on.body.nextStop as { type: string })?.type).toBe("pre_survey");
  });

  it("NPS redirect identical between flag states (continuous)", async () => {
    const setup = await seedFixture({
      lessonPlanMode: "continuous",
      config: {
        welcome: {
          goals: { enabled: false },
          aboutYou: { enabled: false },
          knowledgeCheck: { enabled: false },
          aiIntroCall: { enabled: false },
        },
        nps: { enabled: true, trigger: "session_count", threshold: 1 },
      },
      totalCalls: 5,
      onboardingComplete: true,
    });
    TEST_CALLER_ID = setup.callerId;

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "false";
    const off = await callRoute();

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "true";
    const on = await callRoute();

    expect((on.body.nextStop as { type: string })?.type).toBe(
      (off.body.nextStop as { type: string })?.type,
    );
    expect((on.body.nextStop as { type: string })?.type).toBe("post_survey");
  });
});

describe("journey-position — structured-mode NPS gap closure (#218)", () => {
  it("flag OFF: structured course never delivers NPS", async () => {
    const setup = await seedFixture({
      lessonPlanMode: "structured",
      config: {
        nps: { enabled: true, trigger: "session_count", threshold: 1 },
      },
      totalCalls: 5,
      onboardingComplete: true,
    });
    TEST_CALLER_ID = setup.callerId;

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "false";
    const { body } = await callRoute();
    expect((body.nextStop as { type: string })?.type).toBe("teaching");
  });

  it("flag ON: structured course now fires NPS at threshold", async () => {
    const setup = await seedFixture({
      lessonPlanMode: "structured",
      config: {
        nps: { enabled: true, trigger: "session_count", threshold: 1 },
      },
      totalCalls: 5,
      onboardingComplete: true,
    });
    TEST_CALLER_ID = setup.callerId;

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "true";
    const { body } = await callRoute();
    expect((body.nextStop as { type: string })?.type).toBe("post_survey");
  });
});

describe("journey-position — Knowledge Check deliveryMode (#222)", () => {
  it("MCQ delivery: pre-test stop fires", async () => {
    const setup = await seedFixture({
      lessonPlanMode: "continuous",
      config: {
        sessionFlow: {
          intake: {
            goals: { enabled: false },
            aboutYou: { enabled: false },
            knowledgeCheck: { enabled: true, deliveryMode: "mcq" },
            aiIntroCall: { enabled: false },
          },
        },
        nps: { enabled: false, trigger: "mastery", threshold: 80 },
      },
      totalCalls: 1,
      onboardingComplete: true,
    });
    TEST_CALLER_ID = setup.callerId;

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "true";
    const { body } = await callRoute();
    expect((body.nextStop as { type: string })?.type).toBe("pre_survey");
  });

  it("Socratic delivery: NO pre-test stop", async () => {
    const setup = await seedFixture({
      lessonPlanMode: "continuous",
      config: {
        sessionFlow: {
          intake: {
            goals: { enabled: false },
            aboutYou: { enabled: false },
            knowledgeCheck: { enabled: true, deliveryMode: "socratic" },
            aiIntroCall: { enabled: false },
          },
        },
        nps: { enabled: false, trigger: "mastery", threshold: 80 },
      },
      totalCalls: 1,
      onboardingComplete: true,
    });
    TEST_CALLER_ID = setup.callerId;

    process.env.SESSION_FLOW_RESOLVER_ENABLED = "true";
    const { body } = await callRoute();
    // No pre-test stop, no NPS, no curriculum mastery → falls through to "continuous"
    expect((body.nextStop as { type: string })?.type).toBe("continuous");
  });
});
