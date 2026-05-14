/**
 * Admin Tool Handlers Tests
 *
 * Tests the tool handlers used by the Cmd+K AI assistant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma — factory must be inline (vi.mock is hoisted)
vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    analysisSpec: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    caller: {
      findMany: vi.fn(),
    },
    domain: {
      findFirst: vi.fn(),
    },
    // Curriculum building mocks
    subject: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    contentSource: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    subjectSource: {
      create: vi.fn(),
      count: vi.fn(),
    },
    subjectDomain: {
      create: vi.fn(),
    },
    contentAssertion: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/jobs/curriculum-runner", () => ({
  startCurriculumGeneration: vi.fn().mockResolvedValue("task-123"),
}));

vi.mock("@/lib/system-ini", () => ({
  runIniChecks: vi.fn().mockResolvedValue({
    ok: true,
    status: "green",
    summary: { pass: 10, warn: 0, fail: 0, total: 10 },
    checks: {
      env_vars: { status: "pass", label: "Environment Variables", severity: "critical", message: "All set" },
      database: { status: "pass", label: "Database", severity: "critical", message: "Connected" },
      canonical_specs: { status: "pass", label: "Canonical Specs", severity: "critical", message: "All present" },
      domains: { status: "pass", label: "Domains", severity: "recommended", message: "2 domains" },
      contracts: { status: "pass", label: "Contracts", severity: "recommended", message: "All loaded" },
      admin_user: { status: "pass", label: "Admin User", severity: "critical", message: "1 admin" },
      parameters: { status: "pass", label: "Parameters", severity: "critical", message: "200 params" },
      ai_services: { status: "pass", label: "AI Services", severity: "recommended", message: "OpenAI configured" },
      vapi: { status: "warn", label: "VAPI", severity: "optional", message: "Not configured" },
      storage: { status: "pass", label: "Storage", severity: "optional", message: "Local backend" },
    },
    timestamp: "2026-02-16T00:00:00.000Z",
  }),
}));

import { executeAdminTool } from "@/lib/chat/admin-tool-handlers";
import { prisma } from "@/lib/prisma";

const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executeAdminTool", () => {
  it("returns error for unknown tool", async () => {
    const result = await executeAdminTool("nonexistent_tool", {});
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Unknown tool");
  });

  it("handles execution errors gracefully", async () => {
    mockPrisma.analysisSpec.findMany.mockRejectedValue(new Error("DB connection failed"));
    const result = await executeAdminTool("query_specs", {});
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Tool execution failed");
  });
});

describe("query_specs", () => {
  it("returns specs matching filters", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      {
        id: "spec-1",
        name: "Test Tutor Identity",
        slug: "test-tutor-identity",
        specRole: "IDENTITY",
        outputType: "COMPOSE",
        scope: "DOMAIN",
        extendsAgent: "TUT-001",
        isActive: true,
        description: "A test tutor",
      },
    ] as any);

    const result = await executeAdminTool("query_specs", { spec_role: "IDENTITY" });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.specs[0].name).toBe("Test Tutor Identity");
    expect(parsed.specs[0].specRole).toBe("IDENTITY");
    expect(mockPrisma.analysisSpec.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ specRole: "IDENTITY", isActive: true }),
      })
    );
  });

  it("limits results to max 25", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([] as any);
    await executeAdminTool("query_specs", { limit: 100 });
    expect(mockPrisma.analysisSpec.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 })
    );
  });

  it("searches by name case-insensitively", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([] as any);
    await executeAdminTool("query_specs", { name: "creative" });
    expect(mockPrisma.analysisSpec.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: "creative", mode: "insensitive" },
        }),
      })
    );
  });
});

describe("get_spec_config", () => {
  it("returns full config for a spec", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      name: "Test Spec",
      slug: "test-spec",
      specRole: "IDENTITY",
      extendsAgent: "TUT-001",
      config: { roleStatement: "You are a tutor", styleGuidelines: ["Be friendly"] },
      description: "A test spec",
      isActive: true,
    } as any);

    const result = await executeAdminTool("get_spec_config", { spec_id: "spec-1" });
    const parsed = JSON.parse(result);

    expect(parsed.config.roleStatement).toBe("You are a tutor");
    expect(parsed.config.styleGuidelines).toEqual(["Be friendly"]);
    expect(parsed.extendsAgent).toBe("TUT-001");
  });

  it("returns error for missing spec", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);
    const result = await executeAdminTool("get_spec_config", { spec_id: "nonexistent" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Spec not found");
  });
});

describe("update_spec_config", () => {
  it("merges updates into existing config", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      name: "Test Spec",
      config: { roleStatement: "Old role", warmth: "high" },
      isLocked: false,
    } as any);
    mockPrisma.analysisSpec.update.mockResolvedValue({} as any);

    const result = await executeAdminTool("update_spec_config", {
      spec_id: "spec-1",
      config_updates: { roleStatement: "New role", styleGuidelines: ["Be warm"] },
      reason: "Improve tone",
    });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.fieldsUpdated).toContain("roleStatement");
    expect(parsed.fieldsUpdated).toContain("styleGuidelines");

    expect(mockPrisma.analysisSpec.update).toHaveBeenCalledWith({
      where: { id: "spec-1" },
      data: {
        config: {
          roleStatement: "New role",
          warmth: "high",
          styleGuidelines: ["Be warm"],
        },
      },
    });
  });

  it("refuses to update locked specs", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      name: "Locked Spec",
      config: {},
      isLocked: true,
    } as any);

    const result = await executeAdminTool("update_spec_config", {
      spec_id: "spec-1",
      config_updates: { roleStatement: "New" },
      reason: "Test",
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain("locked");
    expect(mockPrisma.analysisSpec.update).not.toHaveBeenCalled();
  });

  it("returns error for missing spec", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);
    const result = await executeAdminTool("update_spec_config", {
      spec_id: "nonexistent",
      config_updates: { roleStatement: "New" },
      reason: "Test",
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Spec not found");
  });
});

describe("query_callers", () => {
  it("returns callers with personality summary", async () => {
    mockPrisma.caller.findMany.mockResolvedValue([
      {
        id: "caller-1",
        name: "Alice",
        email: "alice@test.com",
        domain: { name: "Creative Comprehension" },
        personality: {
          openness: 0.8,
          conscientiousness: 0.6,
          extraversion: 0.4,
          agreeableness: 0.7,
          neuroticism: 0.3,
        },
        _count: { calls: 5 },
      },
    ] as any);

    const result = await executeAdminTool("query_callers", { name: "alice" });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.callers[0].name).toBe("Alice");
    expect(parsed.callers[0].personality.O).toBe(80);
    expect(parsed.callers[0].totalCalls).toBe(5);
  });
});

describe("get_domain_info", () => {
  it("returns domain with specs and config", async () => {
    mockPrisma.domain.findFirst.mockResolvedValue({
      id: "domain-1",
      name: "Creative Comprehension",
      slug: "creative-comprehension",
      description: "11+ exam prep",
      playbooks: [
        {
          id: "pb-1",
          name: "CC Playbook",
          status: "PUBLISHED",
          items: [
            {
              spec: {
                id: "spec-1",
                name: "CC Identity",
                slug: "cc-identity",
                specRole: "IDENTITY",
                config: { roleStatement: "You are a tutor" },
                extendsAgent: "TUT-001",
              },
            },
          ],
        },
      ],
      _count: { callers: 12 },
    } as any);

    const result = await executeAdminTool("get_domain_info", { domain_name: "Creative" });
    const parsed = JSON.parse(result);

    expect(parsed.name).toBe("Creative Comprehension");
    expect(parsed.callerCount).toBe(12);
    expect(parsed.publishedPlaybook.status).toBe("PUBLISHED");
    expect(parsed.identitySpecConfig.roleStatement).toBe("You are a tutor");
  });

  it("returns error when neither id nor name provided", async () => {
    const result = await executeAdminTool("get_domain_info", {});
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("domain_id or domain_name");
  });
});

describe("RBAC enforcement", () => {
  it("blocks low-role users from write tools", async () => {
    const result = await executeAdminTool("update_spec_config", {
      spec_id: "spec-1",
      config_updates: { roleStatement: "Hacked" },
      reason: "Test",
    }, "TESTER" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Insufficient permissions");
    expect(parsed.error).toContain("OPERATOR");
    expect(mockPrisma.analysisSpec.findUnique).not.toHaveBeenCalled();
  });

  it("blocks low-role users from read tools", async () => {
    const result = await executeAdminTool("query_specs", {}, "DEMO" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Insufficient permissions");
    expect(mockPrisma.analysisSpec.findMany).not.toHaveBeenCalled();
  });

  it("allows OPERATOR to use all current tools", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([] as any);
    const result = await executeAdminTool("query_specs", {}, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeUndefined();
    expect(parsed.count).toBe(0);
  });

  it("allows ADMIN to use write tools", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      name: "Test Spec",
      config: { roleStatement: "Old" },
      isLocked: false,
    } as any);
    mockPrisma.analysisSpec.update.mockResolvedValue({} as any);

    const result = await executeAdminTool("update_spec_config", {
      spec_id: "spec-1",
      config_updates: { roleStatement: "New" },
      reason: "Admin update",
    }, "ADMIN" as any);
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });

  it("still works without userRole (backwards compatible)", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([] as any);
    const result = await executeAdminTool("query_specs", {});
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeUndefined();
  });
});

describe("result truncation", () => {
  it("truncates large results", async () => {
    const largeConfig: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      largeConfig[`field_${i}`] = "x".repeat(50);
    }

    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      name: "Big Spec",
      slug: "big-spec",
      specRole: "IDENTITY",
      extendsAgent: null,
      config: largeConfig,
      description: "Has a huge config",
      isActive: true,
    } as any);

    const result = await executeAdminTool("get_spec_config", { spec_id: "spec-1" });
    expect(result.length).toBeLessThanOrEqual(3100);
    expect(result).toContain("truncated");
  });
});

// ============================================================
// Curriculum Building Tools
// ============================================================

describe("create_subject_with_source", () => {
  it("creates subject + source + junction in a transaction", async () => {
    (mockPrisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback({
        subject: {
          create: vi.fn().mockResolvedValue({
            id: "subj-1", name: "Krebs Cycle", slug: "krebs-cycle",
          }),
        },
        contentSource: {
          create: vi.fn().mockResolvedValue({
            id: "src-1", name: "AI Krebs Content", slug: "krebs-ai",
          }),
        },
        subjectSource: {
          create: vi.fn().mockResolvedValue({}),
        },
      });
    });

    const result = await executeAdminTool("create_subject_with_source", {
      subject_slug: "krebs-cycle",
      subject_name: "Krebs Cycle",
      source_slug: "krebs-ai",
      source_name: "AI Krebs Content",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.subject_id).toBe("subj-1");
    expect(parsed.source_id).toBe("src-1");
    expect(parsed.subject_slug).toBe("krebs-cycle");
  });

  it("returns error when required fields are missing", async () => {
    const result = await executeAdminTool("create_subject_with_source", {
      subject_slug: "test",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("subject_name");
  });

  it("returns friendly error for duplicate slugs", async () => {
    (mockPrisma.$transaction as any).mockRejectedValue({ code: "P2002" });

    const result = await executeAdminTool("create_subject_with_source", {
      subject_slug: "existing",
      subject_name: "Existing",
      source_slug: "existing-src",
      source_name: "Existing Src",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("already exists");
  });

  it("blocks TESTER role", async () => {
    const result = await executeAdminTool("create_subject_with_source", {
      subject_slug: "test",
      subject_name: "Test",
      source_slug: "test-src",
      source_name: "Test Src",
    }, "TESTER" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Insufficient permissions");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("add_content_assertions", () => {
  it("creates assertions and returns count", async () => {
    mockPrisma.contentSource.findUnique.mockResolvedValue({
      id: "src-1", name: "Test Source",
    } as any);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.createMany.mockResolvedValue({ count: 2 } as any);

    const result = await executeAdminTool("add_content_assertions", {
      source_id: "src-1",
      assertions: [
        { assertion: "The Krebs cycle produces 2 ATP per glucose", category: "fact" },
        { assertion: "Acetyl-CoA enters the cycle by combining with oxaloacetate", category: "process" },
      ],
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.created).toBe(2);
    expect(parsed.duplicates_skipped).toBe(0);
  });

  it("returns error for missing source", async () => {
    mockPrisma.contentSource.findUnique.mockResolvedValue(null);

    const result = await executeAdminTool("add_content_assertions", {
      source_id: "nonexistent",
      assertions: [{ assertion: "test", category: "fact" }],
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Source not found");
  });

  it("deduplicates assertions by content hash", async () => {
    mockPrisma.contentSource.findUnique.mockResolvedValue({
      id: "src-1", name: "Test Source",
    } as any);
    // Simulate an existing assertion with a matching hash
    const { createHash } = await import("crypto");
    const existingHash = createHash("sha256")
      .update("existing assertion text")
      .digest("hex")
      .substring(0, 16);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([
      { contentHash: existingHash },
    ] as any);
    mockPrisma.contentAssertion.createMany.mockResolvedValue({ count: 1 } as any);

    const result = await executeAdminTool("add_content_assertions", {
      source_id: "src-1",
      assertions: [
        { assertion: "Existing assertion text", category: "fact" },
        { assertion: "New assertion text", category: "definition" },
      ],
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.created).toBe(1);
    expect(parsed.duplicates_skipped).toBe(1);
  });

  it("returns error for empty assertions array", async () => {
    const result = await executeAdminTool("add_content_assertions", {
      source_id: "src-1",
      assertions: [],
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("must not be empty");
  });

  it("caps at 50 assertions", async () => {
    mockPrisma.contentSource.findUnique.mockResolvedValue({
      id: "src-1", name: "Test Source",
    } as any);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.createMany.mockResolvedValue({ count: 50 } as any);

    const bigArray = Array.from({ length: 60 }, (_, i) => ({
      assertion: `Assertion ${i}`,
      category: "fact",
    }));

    const result = await executeAdminTool("add_content_assertions", {
      source_id: "src-1",
      assertions: bigArray,
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.total_submitted).toBe(50); // Capped
  });
});

describe("link_subject_to_domain", () => {
  it("creates link and returns names", async () => {
    mockPrisma.subjectDomain.create.mockResolvedValue({
      subject: { name: "Krebs Cycle" },
      domain: { name: "Biology" },
    } as any);

    const result = await executeAdminTool("link_subject_to_domain", {
      subject_id: "subj-1",
      domain_id: "domain-1",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.message).toContain("Krebs Cycle");
    expect(parsed.message).toContain("Biology");
  });

  it("treats already-linked as success (idempotent)", async () => {
    mockPrisma.subjectDomain.create.mockRejectedValue({ code: "P2002" });

    const result = await executeAdminTool("link_subject_to_domain", {
      subject_id: "subj-1",
      domain_id: "domain-1",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.message).toContain("already linked");
  });

  it("returns error for invalid IDs", async () => {
    mockPrisma.subjectDomain.create.mockRejectedValue({ code: "P2003" });

    const result = await executeAdminTool("link_subject_to_domain", {
      subject_id: "bad-id",
      domain_id: "bad-id",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain("not found");
  });

  it("returns error for missing fields", async () => {
    const result = await executeAdminTool("link_subject_to_domain", {
      subject_id: "subj-1",
    }, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("domain_id is required");
  });
});

describe("generate_curriculum", () => {
  it("starts generation and returns taskId", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({
      id: "subj-1", name: "Krebs Cycle",
    } as any);
    mockPrisma.subjectSource.count.mockResolvedValue(1);
    mockPrisma.contentAssertion.count.mockResolvedValue(20);

    const result = await executeAdminTool("generate_curriculum", {
      subject_id: "subj-1",
    }, "OPERATOR" as any, { userId: "user-1" });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.task_id).toBe("task-123");
    expect(parsed.assertion_count).toBe(20);
  });

  it("returns error for missing subject", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue(null);

    const result = await executeAdminTool("generate_curriculum", {
      subject_id: "nonexistent",
    }, "OPERATOR" as any, { userId: "user-1" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Subject not found");
  });

  it("returns error when no sources attached", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({
      id: "subj-1", name: "Empty Subject",
    } as any);
    mockPrisma.subjectSource.count.mockResolvedValue(0);

    const result = await executeAdminTool("generate_curriculum", {
      subject_id: "subj-1",
    }, "OPERATOR" as any, { userId: "user-1" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("No sources attached");
  });

  it("returns error when no assertions exist", async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({
      id: "subj-1", name: "No Assertions Subject",
    } as any);
    mockPrisma.subjectSource.count.mockResolvedValue(1);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);

    const result = await executeAdminTool("generate_curriculum", {
      subject_id: "subj-1",
    }, "OPERATOR" as any, { userId: "user-1" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("No assertions found");
  });

  it("blocks DEMO role", async () => {
    const result = await executeAdminTool("generate_curriculum", {
      subject_id: "subj-1",
    }, "DEMO" as any, { userId: "user-1" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Insufficient permissions");
    expect(mockPrisma.subject.findUnique).not.toHaveBeenCalled();
  });
});

// ============================================================
// System Initialization Check
// ============================================================

describe("system_ini_check", () => {
  it("requires SUPERADMIN role", async () => {
    const result = await executeAdminTool("system_ini_check", {}, "ADMIN" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Insufficient permissions");
    expect(parsed.error).toContain("SUPERADMIN");
  });

  it("blocks OPERATOR role", async () => {
    const result = await executeAdminTool("system_ini_check", {}, "OPERATOR" as any);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Insufficient permissions");
  });

  it("returns structured results for SUPERADMIN", async () => {
    const result = await executeAdminTool("system_ini_check", {}, "SUPERADMIN" as any);
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(true);
    expect(parsed.summary.total).toBe(10);
    expect(parsed.status).toBe("green");
    expect(parsed.checks.database.status).toBe("pass");
    expect(parsed.checks.parameters.status).toBe("pass");
    expect(parsed.timestamp).toBeDefined();
  });
});
