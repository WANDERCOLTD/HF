/**
 * Tests for Domain Readiness checks (lib/domain/readiness.ts)
 *
 * Key behavior:
 *   - playbook_spec_role checks BOTH PlaybookItems AND system spec toggles
 *   - Checks are loaded from DOMAIN-READY-001 spec (spec-driven, not hardcoded)
 *   - All checks run in parallel for performance
 *   - Spec-file validation: every query type in DOMAIN-READY-001 has a matching executor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =====================================================
// MOCK SETUP (vi.hoisted so vi.mock factory can reference it)
// =====================================================

const mockPrisma = vi.hoisted(() => ({
  domain: {
    findUnique: vi.fn(),
  },
  analysisSpec: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  playbook: {
    findFirst: vi.fn(),
  },
  caller: {
    count: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// =====================================================
// IMPORT AFTER MOCKING
// =====================================================

import { checkDomainReadiness } from "@/lib/domain/readiness";

// =====================================================
// HELPERS
// =====================================================

const DOMAIN_ID = "domain-test-123";

function setupDomain(name = "Test Domain") {
  mockPrisma.domain.findUnique.mockResolvedValue({
    id: DOMAIN_ID,
    name,
  });
}

/** Make loadReadinessChecks return fallback (no DOMAIN-READY-001 spec in DB) */
function useDefaultChecks() {
  mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);
}

// =====================================================
// TESTS: playbook_spec_role — system spec toggles
// =====================================================

describe("playbook_spec_role executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDomain("Why Nations Fail - Tutor");
    useDefaultChecks();
    // Default: AI keys present
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_HF_MVP_KEY = "test-key";
  });

  it("passes when IDENTITY specs exist as system spec toggles (not PlaybookItems)", async () => {
    // Published playbook with NO domain IDENTITY items,
    // but system spec toggles that include IDENTITY specs
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "WNF Playbook v1",
      config: {
        systemSpecToggles: {
          "spec-id-tut": { isEnabled: true },
          "spec-id-coach": { isEnabled: true },
          "spec-id-voice": { isEnabled: true },
        },
      },
      items: [], // No domain PlaybookItems with IDENTITY role
    });

    // When readiness queries for system specs matching the enabled IDs + IDENTITY role
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      { name: "Generic Tutor Identity" },
      { name: "Strategic Coach Identity" },
      { name: "Voice AI Guidance" },
    ]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const identityCheck = result.checks.find((c) => c.id === "identity_spec");

    expect(identityCheck).toBeDefined();
    expect(identityCheck!.passed).toBe(true);
    expect(identityCheck!.detail).toContain("3 tutor personality configuration(s) active");
  });

  it("fails when system spec toggles exist but are disabled", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "WNF Playbook v1",
      config: {
        systemSpecToggles: {
          "spec-id-tut": { isEnabled: false },
        },
      },
      items: [],
    });

    // No enabled IDs → findMany should not be called, or return empty
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const identityCheck = result.checks.find((c) => c.id === "identity_spec");

    expect(identityCheck!.passed).toBe(false);
    expect(identityCheck!.detail).toContain("No tutor personality configuration in the learning programme");
  });

  it("passes when IDENTITY specs exist as domain PlaybookItems", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [{ spec: { slug: "spec-tut-001", name: "Tutor Identity" } }],
    });

    const result = await checkDomainReadiness(DOMAIN_ID);
    const identityCheck = result.checks.find((c) => c.id === "identity_spec");

    expect(identityCheck!.passed).toBe(true);
    expect(identityCheck!.detail).toContain("1 tutor personality configuration(s) active");
  });

  it("combines domain PlaybookItems and system spec toggles", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {
        systemSpecToggles: {
          "spec-id-voice": { isEnabled: true },
        },
      },
      items: [{ spec: { slug: "spec-tut-001", name: "Tutor Identity" } }],
    });

    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      { name: "Voice AI Guidance" },
    ]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const identityCheck = result.checks.find((c) => c.id === "identity_spec");

    expect(identityCheck!.passed).toBe(true);
    expect(identityCheck!.detail).toContain("2 tutor personality configuration(s) active");
  });

  it("fails when no published playbook exists", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue(null);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const identityCheck = result.checks.find((c) => c.id === "identity_spec");

    expect(identityCheck!.passed).toBe(false);
    expect(identityCheck!.detail).toContain("No tutor personality configuration in the learning programme");
  });
});

// =====================================================
// TESTS: Overall readiness scoring
// =====================================================

describe("checkDomainReadiness scoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDomain();
    useDefaultChecks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_HF_MVP_KEY = "test-key";
  });

  it("returns ready=false when critical checks fail", async () => {
    // No playbook at all → playbook + identity checks fail
    mockPrisma.playbook.findFirst.mockResolvedValue(null);

    const result = await checkDomainReadiness(DOMAIN_ID);

    expect(result.ready).toBe(false);
    expect(result.level).toBe("incomplete");
    expect(result.criticalPassed).toBeLessThan(result.criticalTotal);
  });

  it("returns ready=true when all critical checks pass", async () => {
    // Published playbook with identity spec via system toggles
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {
        systemSpecToggles: {
          "spec-id-tut": { isEnabled: true },
        },
      },
      items: [],
    });

    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      { name: "Tutor Identity" },
    ]);

    const result = await checkDomainReadiness(DOMAIN_ID);

    expect(result.ready).toBe(true);
    expect(result.criticalPassed).toBe(result.criticalTotal);
  });

  it("throws when domain not found", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue(null);

    await expect(checkDomainReadiness("nonexistent")).rejects.toThrow(
      "Domain not found"
    );
  });
});

// =====================================================
// TESTS: Spec-driven check loading
// =====================================================

describe("loadReadinessChecks (spec-driven)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDomain();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("loads checks from DOMAIN-READY-001 spec when available", async () => {
    // Return a spec with custom checks
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      config: {
        parameters: [
          {
            id: "readiness_checks",
            config: {
              checks: [
                {
                  id: "custom_check",
                  name: "Custom Check",
                  description: "A custom check from the spec",
                  severity: "critical",
                  query: "ai_keys",
                },
              ],
            },
          },
        ],
      },
    });

    // Provide mocks for the custom check
    mockPrisma.playbook.findFirst.mockResolvedValue(null);

    const result = await checkDomainReadiness(DOMAIN_ID);

    // Should have only the custom check from the spec, not the hardcoded fallbacks
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].id).toBe("custom_check");
  });

  it("falls back to default checks when spec not found", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);
    mockPrisma.playbook.findFirst.mockResolvedValue(null);

    const result = await checkDomainReadiness(DOMAIN_ID);

    // Fallback has 4 checks: playbook, identity_spec, ai_keys, content_curriculum_valid
    expect(result.checks).toHaveLength(4);
    expect(result.checks.map((c) => c.id)).toEqual([
      "playbook_published",
      "identity_spec",
      "ai_keys",
      "content_curriculum_valid",
    ]);
  });
});

// =====================================================
// TESTS: Spec file ↔ executor coverage (no hardcoding)
// =====================================================

describe("DOMAIN-READY-001 spec ↔ executor coverage", () => {
  // Load the actual spec file at test time — if someone adds a check
  // with a new query type but forgets the executor, this test fails.
  const specPath = path.resolve(
    __dirname,
    "../../docs-archive/bdd-specs/DOMAIN-READY-001-domain-readiness.spec.json",
  );

  // Known executor query types from readiness.ts (source of truth for runtime)
  const KNOWN_EXECUTORS = [
    "playbook",
    "playbook_spec_role",
    "content_sources",
    "assertions",
    "onboarding",
    "system_spec",
    "ai_keys",
    "test_caller",
    "content_spec_curriculum",
  ];

  it("spec file exists and is valid JSON", () => {
    expect(fs.existsSync(specPath)).toBe(true);
    const raw = fs.readFileSync(specPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("every check in the spec has a query type with a matching executor", () => {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
    const checksParam = spec.parameters?.find(
      (p: any) => p.id === "readiness_checks",
    );
    expect(checksParam).toBeDefined();

    const checks = checksParam.config.checks as Array<{
      id: string;
      query: string;
    }>;
    expect(checks.length).toBeGreaterThan(0);

    const missing = checks.filter((c) => !KNOWN_EXECUTORS.includes(c.query));
    expect(missing).toEqual([]);
  });

  it("every check has required fields (id, name, severity, query)", () => {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
    const checks = spec.parameters.find(
      (p: any) => p.id === "readiness_checks",
    ).config.checks;

    for (const check of checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("severity");
      expect(check).toHaveProperty("query");
      expect(["critical", "recommended", "optional"]).toContain(check.severity);
    }
  });

  it("check IDs are unique", () => {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
    const checks = spec.parameters.find(
      (p: any) => p.id === "readiness_checks",
    ).config.checks;
    const ids = checks.map((c: any) => c.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});

// =====================================================
// TESTS: content_spec_curriculum executor
// =====================================================

describe("content_spec_curriculum executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDomain("Food Safety Domain");
    useDefaultChecks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_HF_MVP_KEY = "test-key";
  });

  it("passes when no CONTENT spec exists (curriculum not required)", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [
        { spec: { slug: "tut-001", name: "Tutor Identity", config: {}, specRole: "IDENTITY", isActive: true } },
      ],
    });
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const currCheck = result.checks.find((c) => c.id === "content_curriculum_valid");

    expect(currCheck).toBeDefined();
    expect(currCheck!.passed).toBe(true);
    expect(currCheck!.detail).toContain("No curriculum structure required");
  });

  it("fails when CONTENT spec is missing metadata.curriculum", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [
        {
          spec: {
            slug: "curr-fs-l2-001",
            name: "Food Safety L2",
            config: { parameters: [] },
            specRole: "CONTENT",
            isActive: true,
          },
        },
      ],
    });
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const currCheck = result.checks.find((c) => c.id === "content_curriculum_valid");

    expect(currCheck!.passed).toBe(false);
    expect(currCheck!.detail).toContain("needs curriculum topics and objectives configured");
  });

  it("fails when curriculum metadata has missing required fields", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [
        {
          spec: {
            slug: "curr-fs-l2-001",
            name: "Food Safety L2",
            config: {
              metadata: {
                curriculum: {
                  type: "sequential",
                  // Missing: trackingMode, moduleSelector, moduleOrder, progressKey, masteryThreshold
                },
              },
              parameters: [],
            },
            specRole: "CONTENT",
            isActive: true,
          },
        },
      ],
    });
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const currCheck = result.checks.find((c) => c.id === "content_curriculum_valid");

    expect(currCheck!.passed).toBe(false);
    expect(currCheck!.detail).toContain("missing");
    expect(currCheck!.detail).toContain("trackingMode");
  });

  it("fails when no parameters match moduleSelector", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [
        {
          spec: {
            slug: "curr-fs-l2-001",
            name: "Food Safety L2",
            config: {
              metadata: {
                curriculum: {
                  type: "sequential",
                  trackingMode: "module-based",
                  moduleSelector: "section=content",
                  moduleOrder: "sortBySequence",
                  progressKey: "current_module",
                  masteryThreshold: 0.7,
                },
              },
              parameters: [
                { id: "MOD-1", section: "scoring", name: "Wrong section" },
              ],
            },
            specRole: "CONTENT",
            isActive: true,
          },
        },
      ],
    });
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const currCheck = result.checks.find((c) => c.id === "content_curriculum_valid");

    expect(currCheck!.passed).toBe(false);
    expect(currCheck!.detail).toContain("No curriculum topics found");
  });

  it("passes with warning when modules have no learningOutcomes", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [
        {
          spec: {
            slug: "curr-fs-l2-001",
            name: "Food Safety L2",
            config: {
              metadata: {
                curriculum: {
                  type: "sequential",
                  trackingMode: "module-based",
                  moduleSelector: "section=content",
                  moduleOrder: "sortBySequence",
                  progressKey: "current_module",
                  masteryThreshold: 0.7,
                },
              },
              parameters: [
                { id: "MOD-1", section: "content", name: "Module 1" },
                { id: "MOD-2", section: "content", name: "Module 2" },
              ],
            },
            specRole: "CONTENT",
            isActive: true,
          },
        },
      ],
    });
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const currCheck = result.checks.find((c) => c.id === "content_curriculum_valid");

    expect(currCheck!.passed).toBe(true);
    expect(currCheck!.detail).toContain("2 topic(s) linked");
  });

  it("passes fully when modules have learningOutcomes", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue({
      id: "pb-1",
      name: "Test Playbook",
      config: {},
      items: [
        {
          spec: {
            slug: "curr-fs-l2-001",
            name: "Food Safety L2",
            config: {
              metadata: {
                curriculum: {
                  type: "sequential",
                  trackingMode: "module-based",
                  moduleSelector: "section=content",
                  moduleOrder: "sortBySequence",
                  progressKey: "current_module",
                  masteryThreshold: 0.7,
                },
              },
              parameters: [
                { id: "MOD-1", section: "content", name: "Module 1", learningOutcomes: ["LO1", "LO2"] },
                { id: "MOD-2", section: "content", name: "Module 2", learningOutcomes: ["LO3"] },
                { id: "SCORING-1", section: "scoring", name: "Score Param" },
              ],
            },
            specRole: "CONTENT",
            isActive: true,
          },
        },
      ],
    });
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const result = await checkDomainReadiness(DOMAIN_ID);
    const currCheck = result.checks.find((c) => c.id === "content_curriculum_valid");

    expect(currCheck!.passed).toBe(true);
    expect(currCheck!.detail).toContain("2 topic(s), 2 with learning outcomes");
  });

  it("uses CURRICULUM_REQUIRED_FIELDS from shared constants (not hardcoded)", () => {
    const readinessSource = fs.readFileSync(
      path.resolve(__dirname, "../../lib/domain/readiness.ts"),
      "utf-8",
    );
    // Should import from shared constants
    expect(readinessSource).toContain("CURRICULUM_REQUIRED_FIELDS");
    // Should NOT have a local hardcoded array of these fields
    expect(readinessSource).not.toMatch(
      /const required\s*=\s*\[.*"type".*"trackingMode"/,
    );
  });
});
