/**
 * System Initialization Check Tests
 *
 * Tests the shared check logic in lib/system-ini.ts
 * and the API endpoint at GET /api/system/ini.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    $queryRaw: vi.fn(),
    analysisSpec: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    domain: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    systemSetting: {
      findMany: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
    parameter: {
      count: vi.fn(),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

// Mock config — provide defaults matching real config structure
vi.mock("@/lib/config", () => ({
  config: {
    specs: {
      onboarding: "INIT-001",
      pipeline: "PIPELINE-001",
      pipelineFallback: "GUARD-001",
      compose: "system-compose-next-prompt",
      contentExtract: "CONTENT-EXTRACT-001",
      voicePattern: "voice",
    },
    ai: {
      openai: { isConfigured: true, model: "gpt-4o" },
      claude: { isConfigured: false, model: "claude-sonnet-4-5-20250929" },
    },
    vapi: {
      apiKey: undefined,
      webhookSecret: undefined,
    },
    storage: {
      backend: "local",
      gcsBucket: "hf-admin-prod-media",
      localPath: "./storage/media",
    },
  },
}));

import { runIniChecks } from "@/lib/system-ini";
import { prisma } from "@/lib/prisma";

const mockPrisma = vi.mocked(prisma, { deep: true });

beforeEach(() => {
  vi.clearAllMocks();
  // Reset env stubs
  vi.unstubAllEnvs();
});

/** Set up all mocks for a "healthy" system */
function mockHealthySystem() {
  mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  mockPrisma.analysisSpec.findMany.mockResolvedValue([
    { slug: "INIT-001", isActive: true },
    { slug: "PIPELINE-001", isActive: true },
    { slug: "GUARD-001", isActive: true },
    { slug: "system-compose-next-prompt", isActive: true },
    { slug: "CONTENT-EXTRACT-001", isActive: true },
  ] as any);
  mockPrisma.analysisSpec.findFirst.mockResolvedValue({ slug: "VOICE-001" } as any);
  mockPrisma.domain.count.mockResolvedValue(2);
  mockPrisma.domain.findFirst.mockResolvedValue({ name: "Test", slug: "test" } as any);
  mockPrisma.systemSetting.findMany.mockResolvedValue([
    { key: "contract:CURRICULUM_PROGRESS_V1" },
    { key: "contract:LEARNER_PROFILE_V1" },
    { key: "contract:CONTENT_TRUST_V1" },
  ] as any);
  mockPrisma.user.count.mockResolvedValue(1);
  mockPrisma.parameter.count.mockResolvedValue(200);
}

describe("runIniChecks", () => {
  it("returns structured results with 10 checks", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    const result = await runIniChecks();

    expect(result.ok).toBe(true);
    expect(result.summary.total).toBe(10);
    expect(result.timestamp).toBeDefined();
    expect(result.status).toBeDefined();
    expect(Object.keys(result.checks)).toHaveLength(10);
  });

  it("returns green when all checks pass", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    const result = await runIniChecks();

    expect(result.checks.database.status).toBe("pass");
    expect(result.checks.canonical_specs.status).toBe("pass");
    expect(result.checks.domains.status).toBe("pass");
    expect(result.checks.contracts.status).toBe("pass");
    expect(result.checks.admin_user.status).toBe("pass");
    expect(result.checks.parameters.status).toBe("pass");
    expect(result.checks.ai_services.status).toBe("pass");
    // VAPI and storage may warn depending on mock config
  });

  it("reports missing canonical specs as fail", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    // Override: no specs found
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const result = await runIniChecks();

    expect(result.checks.canonical_specs.status).toBe("fail");
    expect(result.checks.canonical_specs.message).toContain("spec issue");
    expect(result.checks.canonical_specs.remediation).toContain("db:seed");
  });

  it("reports no admin users as fail", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    mockPrisma.user.count.mockResolvedValue(0);

    const result = await runIniChecks();

    expect(result.checks.admin_user.status).toBe("fail");
    expect(result.checks.admin_user.remediation).toContain("user:create");
  });

  it("reports VAPI unconfigured as warn", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    const result = await runIniChecks();

    // Config mock has apiKey and webhookSecret as undefined
    expect(result.checks.vapi.status).toBe("warn");
  });

  it("handles DB connection failure gracefully", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    // All DB calls fail
    mockPrisma.$queryRaw.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.analysisSpec.findMany.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.analysisSpec.findFirst.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.domain.count.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.domain.findFirst.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.systemSetting.findMany.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.user.count.mockRejectedValue(new Error("Connection refused"));
    mockPrisma.parameter.count.mockRejectedValue(new Error("Connection refused"));

    const result = await runIniChecks();

    // Should still return all 10 checks (not crash)
    expect(result.summary.total).toBe(10);
    expect(result.checks.database.status).toBe("fail");
    expect(result.checks.database.message).toContain("Connection");
  });

  it("rollup: any fail results in red status", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    // Make one check fail
    mockPrisma.parameter.count.mockResolvedValue(0);

    const result = await runIniChecks();

    expect(result.status).toBe("red");
    expect(result.summary.fail).toBeGreaterThanOrEqual(1);
  });

  it("rollup: warns only results in amber status", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    // No fails, but domain has no default → warn
    mockPrisma.domain.findFirst.mockResolvedValue(null);

    const result = await runIniChecks();

    // Domain should warn, VAPI should warn (no keys), storage may pass
    expect(result.checks.domains.status).toBe("warn");
    // Overall should be amber (warns but no fails)
    expect(result.status).toBe("amber");
  });

  it("includes severity on each check", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    const result = await runIniChecks();

    // Critical checks
    expect(result.checks.env_vars.severity).toBe("critical");
    expect(result.checks.database.severity).toBe("critical");
    expect(result.checks.canonical_specs.severity).toBe("critical");
    expect(result.checks.admin_user.severity).toBe("critical");
    expect(result.checks.parameters.severity).toBe("critical");

    // Recommended checks
    expect(result.checks.domains.severity).toBe("recommended");
    expect(result.checks.contracts.severity).toBe("recommended");
    expect(result.checks.ai_services.severity).toBe("recommended");

    // Optional checks
    expect(result.checks.vapi.severity).toBe("optional");
    expect(result.checks.storage.severity).toBe("optional");
  });

  it("reports missing contracts as fail", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    mockPrisma.systemSetting.findMany.mockResolvedValue([]);

    const result = await runIniChecks();

    expect(result.checks.contracts.status).toBe("fail");
    expect(result.checks.contracts.message).toContain("Missing");
  });

  it("reports no domains as fail", async () => {
    mockHealthySystem();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "test-token");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    mockPrisma.domain.count.mockResolvedValue(0);
    mockPrisma.domain.findFirst.mockResolvedValue(null);

    const result = await runIniChecks();

    expect(result.checks.domains.status).toBe("fail");
    expect(result.checks.domains.message).toContain("No active domains");
  });
});
