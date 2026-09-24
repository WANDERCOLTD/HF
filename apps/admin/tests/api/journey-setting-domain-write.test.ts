/**
 * Domain-rooted journey-setting PATCH — A4 of epic #2225.
 *
 * Pins the `intakeSpecId` write path (storagePath
 * `domain.onboardingIdentitySpecId`) end-to-end:
 *   - 200 + updated effective value
 *   - routes through `updateDomainConfig` (the canonical Domain writer)
 *   - fans out section-staleness to dependent Playbooks via
 *     `bumpDomainSectionStaleness`
 *   - 403 for non-OPERATOR roles
 *   - 400 on malformed body
 *
 * Scope: 1 contract (G1_INTAKE_SPEC_ID). Other "domain-rooted" contracts
 * the original audit flagged carry domain-only `cascadeSources[]` but a
 * Playbook-rooted PRIMARY storagePath — they don't reach this branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findFirst: vi.fn(), findMany: vi.fn() },
    domain: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: (v: unknown) =>
    typeof v === "object" && v !== null && "error" in v,
}));

vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: vi.fn(async () => ({
    playbook: {},
    composeAffectingChanged: true,
    timestampBumped: true,
    fanoutScope: "none",
  })),
}));

vi.mock("@/lib/domain/update-domain-config", () => ({
  updateDomainConfig: vi.fn(async () => ({
    domain: { id: "domain-1" },
    composeAffectingChanged: true,
    timestampBumped: true,
    fanoutScope: "none",
  })),
}));

vi.mock("@/lib/compose/bump-domain-staleness", () => ({
  bumpDomainSectionStaleness: vi.fn(async () => ["course-1", "course-2"]),
}));

vi.mock("@/lib/compose/section-staleness", () => ({
  bumpSectionHash: vi.fn(async () => ({ changed: false, sectionHash: "" })),
}));

const PARAMS = { params: Promise.resolve({ courseId: "course-1" }) };

async function loadRoute() {
  return import("@/app/api/courses/[courseId]/journey-setting/route");
}

function makeReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://x", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/courses/[courseId]/journey-setting — A4 #2225 domain-rooted writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "course-1",
      domainId: "domain-1",
    });
  });

  it("happy path: writes intakeSpecId via updateDomainConfig, returns updated value", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-onboarding-v2" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.effectiveValue).toBe("spec-onboarding-v2");

    // updateDomainConfig is the canonical writer — must be called.
    const { updateDomainConfig } = await import(
      "@/lib/domain/update-domain-config"
    );
    expect(updateDomainConfig).toHaveBeenCalledTimes(1);
    const [domainIdArg, transformer, opts] = vi.mocked(updateDomainConfig).mock
      .calls[0];
    expect(domainIdArg).toBe("domain-1");
    // The transformer applies the new value onto a clone of the current
    // Domain row — exercise it and confirm the right field flips.
    const before = {
      onboardingFlowPhases: null,
      onboardingDefaultTargets: null,
      onboardingWelcome: null,
      onboardingIdentitySpecId: "spec-old",
    };
    const after = transformer(before);
    expect(after).toMatchObject({
      onboardingIdentitySpecId: "spec-onboarding-v2",
      // other fields preserved
      onboardingFlowPhases: null,
      onboardingDefaultTargets: null,
      onboardingWelcome: null,
    });
    expect(opts?.reason).toContain("journey-setting:intakeSpecId");
  });

  it("fans out section-staleness to every dependent Playbook in the Domain", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-x" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);

    const { bumpDomainSectionStaleness } = await import(
      "@/lib/compose/bump-domain-staleness"
    );
    expect(bumpDomainSectionStaleness).toHaveBeenCalledTimes(1);
    const [domainIdArg, sections] = vi.mocked(bumpDomainSectionStaleness).mock
      .calls[0];
    expect(domainIdArg).toBe("domain-1");
    // intakeSpecId's composeImpact.sections is ["intake"]
    expect(Array.from(sections)).toContain("intake");

    const body = await res.json();
    expect(body.bumpedSections).toContain("intake");
  });

  it("403s for non-OPERATOR sessions (requireAuth gate)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-x" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(403);

    // Domain writer must NOT have been called when auth failed.
    const { updateDomainConfig } = await import(
      "@/lib/domain/update-domain-config"
    );
    expect(updateDomainConfig).not.toHaveBeenCalled();
  });

  it("400s on malformed body (zod validation)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ value: "spec-x" /* missing settingId */ }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("BAD_BODY");
  });

  it("404s when the course's Playbook row doesn't exist", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValueOnce(null);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-x" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(404);

    const { updateDomainConfig } = await import(
      "@/lib/domain/update-domain-config"
    );
    expect(updateDomainConfig).not.toHaveBeenCalled();
  });

  it("rejects pipeline-actor headers for operator-only contracts", async () => {
    // intakeSpecId is operator-only (writeGate). Pipeline-service tokens
    // must be rejected explicitly via the x-pipeline-actor header check.
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq(
        { settingId: "intakeSpecId", value: "spec-x" },
        { "x-pipeline-actor": "EXTRACT" },
      ) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("OPERATOR_ONLY");

    const { updateDomainConfig } = await import(
      "@/lib/domain/update-domain-config"
    );
    expect(updateDomainConfig).not.toHaveBeenCalled();
  });

  it("returns autoEnabled: [] for domain-rooted writes (no fan-out today)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-x" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoEnabled).toEqual([]);
  });
});
