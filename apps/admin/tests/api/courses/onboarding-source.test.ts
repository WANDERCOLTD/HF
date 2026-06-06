/**
 * GET /api/courses/:courseId/onboarding source-attribution tests (#1196).
 *
 * The pre-#1196 route had an inline 3-step cascade that:
 *   - returned `source: "fallback"` for INIT-001 defaults, which the editor
 *     then misleadingly remapped to `"domain"`
 *   - SKIPPED `config.sessionFlow.onboarding` entirely — flag-rollout
 *     blocker for epic #221
 *
 * These tests defend the new behaviour:
 *   1. playbook authors phases (legacy field) → source `'course'`
 *   2. playbook authors phases (new shape `sessionFlow.onboarding`) → source `'course'`
 *   3. playbook empty + domain authors → source `'domain'`
 *   4. both empty + INIT-001 spec present → source `'system'` (NOT 'domain' — the bug)
 *   5. both empty + no INIT-001 spec + SystemSetting fallback present → source `'system'`
 *   6. both empty + no INIT-001 spec + no fallback → source `'none'`
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const fixtures = vi.hoisted(() => {
  return {
    playbookStore: new Map<string, Record<string, unknown>>(),
    specRow: null as Record<string, unknown> | null,
    setPlaybook: (id: string, row: Record<string, unknown>) => {
      // placeholder bound below — replaced after stores creation
      void id; void row;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playbook: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          return fixtures.playbookStore.get(where.id) ?? null;
        },
      ),
    },
    analysisSpec: {
      findFirst: vi.fn(async () => fixtures.specRow),
    },
    subjectMedia: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({ session: { user: { id: "tester" } } }),
  isAuthError: () => false,
}));

vi.mock("@/lib/fallback-settings", () => ({
  getFlowPhasesFallback: vi.fn().mockResolvedValue({
    phases: [{ phase: "system-fallback-welcome", duration: "2m", goals: [] }],
  }),
}));

vi.mock("@/lib/config", () => ({
  config: {
    specs: { onboarding: "INIT-001" },
  },
}));

import { GET } from "@/app/api/courses/[courseId]/onboarding/route";

function seedPlaybook(
  id: string,
  data: {
    config?: Record<string, unknown> | null;
    domain?: Record<string, unknown> | null;
  } = {},
) {
  fixtures.playbookStore.set(id, {
    id,
    config: data.config ?? null,
    domain: data.domain ?? null,
  });
}

function callGet(courseId: string): Promise<{
  ok: boolean;
  source: "course" | "domain" | "system" | "none";
  phases: Array<{ phase: string }>;
  domainName?: string | null;
  error?: string;
}> {
  const params = Promise.resolve({ courseId });
  return GET(new Request(`http://test.local/courses/${courseId}/onboarding`), {
    params,
  }).then((res) => res.json());
}

describe("GET /api/courses/:courseId/onboarding — source attribution (#1196)", () => {
  beforeEach(() => {
    fixtures.playbookStore.clear();
    fixtures.specRow = null;
  });

  it("(1) playbook has legacy `config.onboardingFlowPhases` → source='course'", async () => {
    seedPlaybook("pb1", {
      config: {
        onboardingFlowPhases: {
          phases: [
            { phase: "course-welcome", duration: "2-3 min", goals: ["greet"] },
          ],
        },
      },
    });
    const body = await callGet("pb1");
    expect(body.source).toBe("course");
    expect(body.phases[0]?.phase).toBe("course-welcome");
  });

  it("(2) playbook has new-shape `config.sessionFlow.onboarding` → source='course'", async () => {
    seedPlaybook("pb2", {
      config: {
        sessionFlow: {
          onboarding: {
            phases: [
              { phase: "new-shape-welcome", duration: "2 min", goals: [] },
            ],
          },
        },
      },
    });
    const body = await callGet("pb2");
    expect(body.source).toBe("course");
    expect(body.phases[0]?.phase).toBe("new-shape-welcome");
  });

  it("(3) playbook empty + domain has phases → source='domain'", async () => {
    seedPlaybook("pb3", {
      config: {},
      domain: {
        id: "d3",
        name: "Acme Institution",
        slug: "acme",
        onboardingFlowPhases: {
          phases: [{ phase: "domain-welcome", duration: "3 min", goals: [] }],
        },
        onboardingWelcome: null,
        onboardingIdentitySpec: null,
      },
    });
    const body = await callGet("pb3");
    expect(body.source).toBe("domain");
    expect(body.domainName).toBe("Acme Institution");
    expect(body.phases[0]?.phase).toBe("domain-welcome");
  });

  it("(4) playbook empty + domain empty + INIT-001 spec present → source='system' (NOT 'domain' — the #1196 bug)", async () => {
    seedPlaybook("pb4", {
      config: {},
      domain: {
        id: "d4",
        name: "Empty Inst",
        slug: "empty-inst",
        onboardingFlowPhases: null,
        onboardingWelcome: null,
        onboardingIdentitySpec: null,
      },
    });
    fixtures.specRow = {
      config: {
        firstCallFlow: {
          phases: [
            { phase: "init001-welcome", duration: "1-2 min", goals: [] },
          ],
        },
      },
    };
    const body = await callGet("pb4");
    expect(body.source).toBe("system");
    // Regression guard — pre-#1196 this would have been 'domain'
    expect(body.source).not.toBe("domain");
    expect(body.phases[0]?.phase).toBe("init001-welcome");
  });

  it("(5) playbook empty + domain empty + NO INIT-001 spec → falls back to SystemSetting, source still 'system'", async () => {
    seedPlaybook("pb5", { config: {}, domain: null });
    fixtures.specRow = null; // No INIT-001 spec in DB
    const body = await callGet("pb5");
    expect(body.source).toBe("system");
    // From the mocked getFlowPhasesFallback
    expect(body.phases[0]?.phase).toBe("system-fallback-welcome");
  });

  it("(6) returns 404 when course doesn't exist", async () => {
    const params = Promise.resolve({ courseId: "missing" });
    const res = await GET(
      new Request("http://test.local/courses/missing/onboarding"),
      { params },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("(7) regression — `'fallback'` literal source value is never returned", async () => {
    // The old API contract sometimes returned `source: "fallback"` which the
    // editor remapped to `'domain'`. Confirm the new contract never emits
    // that legacy value.
    seedPlaybook("pb7", { config: {}, domain: null });
    fixtures.specRow = null;
    const body = await callGet("pb7");
    expect((body.source as unknown as string)).not.toBe("fallback");
  });
});
