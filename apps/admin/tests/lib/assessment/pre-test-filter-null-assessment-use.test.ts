/**
 * #1167 — pre-test filter must include NULL assessmentUse rows.
 *
 * Live incident (2026-06-06): 250 CIO/CTO Standard MCQs landed with
 * `assessmentUse: NULL` because XAMS XLSX import doesn't carry the field.
 * The original Prisma filter `assessmentUse: { notIn: ['POST_TEST',
 * 'TUTOR_ONLY'] }` followed SQL three-valued logic and silently excluded
 * every NULL row → pre-test returned `no_questions`.
 *
 * Fix at `lib/assessment/pre-test-builder.ts::fetchQuestions`: replace with
 *   OR: [ { assessmentUse: null }, { assessmentUse: { notIn: [...] } } ]
 *
 * This test pins the WHERE shape so a future refactor can't quietly
 * regress the NULL admission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callerPlaybook: { findFirst: vi.fn() },
  contentQuestion: { findMany: vi.fn() },
  curriculum: { findUnique: vi.fn() },
  contentSource: { findMany: vi.fn() },
  playbookSource: { findMany: vi.fn() },
  playbookSubject: { findMany: vi.fn() },
  subjectSource: { findMany: vi.fn() },
  domain: { findUnique: vi.fn() },
  callerAttribute: { findUnique: vi.fn() },
  callerModuleProgress: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: { getEnum: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/lib/config", () => ({
  config: { specs: {} },
}));
vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSourceIdsForPlaybook: vi.fn().mockResolvedValue(["src-1"]),
}));

describe("pre-test fetchQuestions — #1167 NULL assessmentUse admission", () => {
  let buildPreTest: typeof import("@/lib/assessment/pre-test-builder").buildPreTest;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.contentSource.findMany.mockResolvedValue([{ id: "src-1" }]);
    mockPrisma.playbookSource.findMany.mockResolvedValue([{ sourceId: "src-1" }]);
    mockPrisma.contentQuestion.findMany.mockResolvedValue([]);
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: "cur-1",
      primarySourceId: "src-1",
      playbookId: "pb-1",
      subjectId: null,
    });
    const mod = await import("@/lib/assessment/pre-test-builder");
    buildPreTest = mod.buildPreTest;
  });

  it("emits a WHERE that admits NULL assessmentUse via OR (not the old notIn-only shape)", async () => {
    await buildPreTest("cur-1");

    // Find the fetchQuestions Prisma call — distinguished by the
    // `assessmentUse` OR/notIn shape on the where clause.
    const fetchCall = mockPrisma.contentQuestion.findMany.mock.calls.find(
      (call) => {
        const where = call?.[0]?.where ?? {};
        return Array.isArray(where.OR);
      },
    );
    expect(fetchCall, "expected fetchQuestions to issue a Prisma findMany with an OR clause").toBeDefined();
    const where = fetchCall![0].where;

    // Pin the exact shape: OR of (null, notIn excluding POST_TEST + TUTOR_ONLY).
    expect(where.OR).toContainEqual({ assessmentUse: null });
    expect(where.OR).toContainEqual({
      assessmentUse: { notIn: ["POST_TEST", "TUTOR_ONLY"] },
    });

    // The OLD shape MUST NOT be present at the top level — that's the bug we
    // just fixed.
    expect(where.assessmentUse).toBeUndefined();
  });
});
