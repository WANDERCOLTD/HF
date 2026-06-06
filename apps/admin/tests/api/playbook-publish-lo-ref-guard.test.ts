/**
 * #1117 follow-up — publish-time LO ref robustness guard.
 *
 * Hard gate: reject publish when the linked Curriculum has any
 *   (a) refs matching the placeholder pattern /^LO\d+$/, or
 *   (b) duplicate refs across modules within the same Curriculum.
 *
 * Both produce silent runtime failures (LO scoring rejected at write
 * boundary, readiness rollup merging unrelated LOs). The publish gate
 * forces operators to fix at authoring time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  playbook: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  playbookCurriculum: { findMany: vi.fn() },
  learningObjective: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "u-1", email: "op@test.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn(
    (result: Record<string, unknown>) => "error" in result,
  ),
}));

function makePlaybook(overrides: Record<string, unknown> = {}) {
  return {
    id: "pb-1",
    status: "DRAFT",
    domainId: "d-1",
    domain: { id: "d-1", slug: "d", name: "Domain" },
    items: [
      {
        id: "it-1",
        itemType: "PROMPT_TEMPLATE",
        promptTemplate: { id: "pt-1", name: "tmpl", isActive: true },
        spec: null,
      },
    ],
    ...overrides,
  };
}

function makePublishedShape() {
  // What the route's playbook.update() returns when publish succeeds — only
  // the fields the response body marshals are needed.
  return {
    id: "pb-1",
    status: "PUBLISHED",
    publishedAt: new Date(),
    domain: { id: "d-1", slug: "d", name: "Domain" },
    items: [],
  };
}

describe("POST /api/playbooks/:id/publish — #1117 LO ref guard", () => {
  let POST: typeof import("@/app/api/playbooks/[playbookId]/publish/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/playbooks/[playbookId]/publish/route");
    POST = mod.POST;
  });

  function buildReq() {
    return new NextRequest("http://localhost/api/playbooks/pb-1/publish", {
      method: "POST",
    });
  }
  function buildParams() {
    return { params: Promise.resolve({ playbookId: "pb-1" }) };
  }

  it("passes when LO refs are all unique and non-placeholder", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(makePlaybook());
    mockPrisma.playbookCurriculum.findMany.mockResolvedValue([{ curriculumId: "cur-1" }]);
    mockPrisma.learningObjective.findMany.mockResolvedValue([
      { ref: "STD-04-01" },
      { ref: "STD-04-02" },
      { ref: "STD-09-01" },
      { ref: "STD-09-02" },
    ]);
    mockPrisma.playbook.update.mockResolvedValue(makePublishedShape());

    const res = await POST(buildReq(), buildParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.validationPassed).toBe(true);
    expect(body.validationErrors.filter((e: { severity: string }) => e.severity === "error")).toHaveLength(0);
  });

  it("blocks publish with `error` severity when refs match the LO\\d+ placeholder pattern", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(makePlaybook());
    mockPrisma.playbookCurriculum.findMany.mockResolvedValue([{ curriculumId: "cur-1" }]);
    mockPrisma.learningObjective.findMany.mockResolvedValue([
      { ref: "LO1" },
      { ref: "LO2" },
      { ref: "LO3" },
    ]);

    const res = await POST(buildReq(), buildParams());
    const body = await res.json();
    expect(body.validationPassed).toBe(false);
    const errors = body.validationErrors.filter((e: { severity: string }) => e.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    const placeholderErr = errors.find((e: { error: string }) =>
      e.error.includes("placeholder pattern"),
    );
    expect(placeholderErr).toBeDefined();
    expect(placeholderErr.error).toContain("LO1");
    // Update must NOT have been called when validationPassed=false.
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });

  it("surfaces cross-module duplicate refs as a WARNING (publish still succeeds — covers IELTS Mock module pattern)", async () => {
    // 2026-06-06 — downgraded from error after live audit found IELTS's
    // intentional duplicates (Mock module re-references OUT-01/03/06 from
    // part1/part2/part3 by design, per #494 coversModules). Warnings
    // surface to the operator without hard-blocking publish.
    mockPrisma.playbook.findUnique.mockResolvedValue(makePlaybook());
    mockPrisma.playbookCurriculum.findMany.mockResolvedValue([{ curriculumId: "cur-1" }]);
    mockPrisma.learningObjective.findMany.mockResolvedValue([
      // The IELTS shape: OUT-01 appears in BOTH part1 and mock.
      { ref: "OUT-01" }, // part1
      { ref: "OUT-02" }, // part1
      { ref: "OUT-03" }, // part2
      { ref: "OUT-04" }, // part2
      { ref: "OUT-01" }, // mock — intentional cross-module ref
      { ref: "OUT-03" }, // mock — intentional cross-module ref
    ]);
    mockPrisma.playbook.update.mockResolvedValue(makePublishedShape());

    const res = await POST(buildReq(), buildParams());
    const body = await res.json();

    // Publish SUCCEEDS — no error severity entries.
    expect(body.validationPassed).toBe(true);
    const errors = body.validationErrors.filter((e: { severity: string }) => e.severity === "error");
    expect(errors).toHaveLength(0);

    // Warning IS surfaced with the duplicate refs named.
    const warning = body.validationErrors.find(
      (e: { severity: string; error: string }) =>
        e.severity === "warning" && e.error.includes("duplicated across modules"),
    );
    expect(warning).toBeDefined();
    expect(warning.error).toContain("OUT-01");
    expect(warning.error).toContain("OUT-03");
    expect(warning.error).toContain("coversModules"); // explains the intentional case
  });

  it("STILL blocks publish with `error` severity when refs match the placeholder pattern (the actual silent-failure case)", async () => {
    // The placeholder check stays as a hard error — that's the case where
    // per-LO mastery silently never lands. The duplicate downgrade does NOT
    // affect this branch.
    mockPrisma.playbook.findUnique.mockResolvedValue(makePlaybook());
    mockPrisma.playbookCurriculum.findMany.mockResolvedValue([{ curriculumId: "cur-1" }]);
    mockPrisma.learningObjective.findMany.mockResolvedValue([
      { ref: "LO1" },
      { ref: "LO2" },
    ]);

    const res = await POST(buildReq(), buildParams());
    const body = await res.json();
    expect(body.validationPassed).toBe(false);
    const errors = body.validationErrors.filter((e: { severity: string }) => e.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e: { error: string }) => e.error.includes("placeholder pattern"))).toBeDefined();
  });

  it("does not run the LO guard when the Playbook has no PlaybookCurriculum link (content-only course)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(makePlaybook());
    mockPrisma.playbookCurriculum.findMany.mockResolvedValue([]);
    mockPrisma.playbook.update.mockResolvedValue(makePublishedShape());

    const res = await POST(buildReq(), buildParams());
    const body = await res.json();
    expect(body.validationPassed).toBe(true);
    // No LO query should have been made.
    expect(mockPrisma.learningObjective.findMany).not.toHaveBeenCalled();
  });

  it("queries LOs across ALL linked Curricula (variant Playbooks sharing a Curriculum)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(makePlaybook());
    mockPrisma.playbookCurriculum.findMany.mockResolvedValue([
      { curriculumId: "cur-a" },
      { curriculumId: "cur-b" },
    ]);
    mockPrisma.learningObjective.findMany.mockResolvedValue([
      { ref: "GOOD-1" },
      { ref: "GOOD-2" },
    ]);
    mockPrisma.playbook.update.mockResolvedValue(makePublishedShape());

    await POST(buildReq(), buildParams());
    const findManyCall = mockPrisma.learningObjective.findMany.mock.calls[0][0];
    expect(findManyCall.where.module.curriculumId.in).toEqual(["cur-a", "cur-b"]);
  });
});
