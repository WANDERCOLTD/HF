/**
 * #1268 — `composeInputsUpdatedAt` staleness coverage for the 4 routes
 * Tech Lead flagged during Course Design Console (#1263) Slice 3 review.
 *
 * Each test asserts the relevant bump helper is called after the route's
 * main mutation succeeds, and is NOT called when the mutation short-circuits
 * (auth failure / 404 / no-op).
 *
 * Routes covered:
 *  1. POST /api/courses/[courseId]/regenerate-curriculum
 *  2. POST /api/courses/[courseId]/import-modules
 *  3. POST /api/courses/[courseId]/course-reference  (new upload route)
 *  4. POST /api/playbooks/[playbookId]/subjects
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── Shared hoisted mocks ─────────────────────────────────────────────

const {
  mockPrisma,
  mockRequireAuth,
  mockIsAuthError,
  mockBumpPlaybook,
  mockBumpCurriculumFanout,
  mockSyncModules,
  mockExtractCurriculum,
  mockEnsurePrimaryLink,
  mockSyncAuthored,
  mockRecommendNextModule,
  mockReclassifyLearningObjectives,
  mockResolvePrimarySubject,
  mockGetSourceIdsForPlaybook,
  mockReconcileQuestionAssertions,
} = vi.hoisted(() => ({
  mockPrisma: {
    playbook: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    curriculum: {
      findFirst: vi.fn(),
    },
    curriculumModule: {
      findMany: vi.fn(),
    },
    playbookCurriculum: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    contentAssertion: {
      findMany: vi.fn(),
    },
    contentSource: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    playbookSource: {
      upsert: vi.fn(),
    },
    playbookSubject: {
      upsert: vi.fn(),
      // #2132 — course-reference POST now looks up the primary subject to
      // create a SubjectSource link before triggering extraction (closes
      // I1 invariant). Tests default to "no primary subject linked" so
      // the upload path skips the SubjectSource upsert; tests that care
      // can override per-case.
      findFirst: vi.fn().mockResolvedValue(null),
    },
    subjectSource: {
      upsert: vi.fn().mockResolvedValue({ id: "ss-1" }),
    },
    $transaction: vi.fn(async (fn: unknown) => {
      // Two transaction shapes are exercised here:
      //  - regenerate-curriculum passes a callback (interactive tx) when no
      //    curriculum exists; tests below always seed an existing curriculum
      //    so this branch is not hit. Still handle for safety.
      //  - import-modules passes a callback that uses tx.playbook.update.
      if (typeof fn === "function") {
        const tx = {
          playbook: { update: mockPrisma.playbook.update },
          curriculum: { create: vi.fn() },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      }
      return [];
    }),
  },
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockBumpPlaybook: vi.fn(),
  mockBumpCurriculumFanout: vi.fn(),
  mockSyncModules: vi.fn(),
  mockExtractCurriculum: vi.fn(),
  mockEnsurePrimaryLink: vi.fn(),
  mockSyncAuthored: vi.fn(),
  mockRecommendNextModule: vi.fn(),
  mockReclassifyLearningObjectives: vi.fn(),
  mockResolvePrimarySubject: vi.fn(),
  mockGetSourceIdsForPlaybook: vi.fn(),
  mockReconcileQuestionAssertions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
  ROLE_LEVEL: {
    DEMO: 0,
    VIEWER: 1,
    TESTER: 1,
    STUDENT: 1,
    SUPER_TESTER: 2,
    OPERATOR: 3,
    EDUCATOR: 3,
    ADMIN: 4,
    SUPERADMIN: 5,
  },
}));

vi.mock("@/lib/compose/bump-timestamp", () => ({
  bumpPlaybookComposeTimestamp: (...args: unknown[]) => mockBumpPlaybook(...args),
  bumpCallerComposeTimestamp: vi.fn(),
}));

vi.mock("@/lib/compose/bump-curriculum-fanout", () => ({
  bumpCurriculumComposeFanout: (...args: unknown[]) =>
    mockBumpCurriculumFanout(...args),
  bumpCurriculumModuleComposeFanout: vi.fn(),
}));

// ── regenerate-curriculum dependency mocks ───────────────────────────

vi.mock("@/lib/content-trust/extract-curriculum", () => ({
  extractCurriculumFromAssertions: (...args: unknown[]) =>
    mockExtractCurriculum(...args),
}));

vi.mock("@/lib/curriculum/sync-modules", () => ({
  syncModulesToDB: (...args: unknown[]) => mockSyncModules(...args),
}));

vi.mock("@/lib/curriculum/ensure-primary-playbook-link", () => ({
  ensurePrimaryPlaybookLink: (...args: unknown[]) =>
    mockEnsurePrimaryLink(...args),
}));

vi.mock("@/lib/content-trust/resolve-config", () => ({
  INSTRUCTION_CATEGORIES: ["INSTRUCTION", "PEDAGOGY"],
}));

vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSourceIdsForPlaybook: (...args: unknown[]) =>
    mockGetSourceIdsForPlaybook(...args),
}));

vi.mock("@/lib/knowledge/resolve-primary-subject", () => ({
  resolvePrimarySubjectForPlaybook: (...args: unknown[]) =>
    mockResolvePrimarySubject(...args),
}));

vi.mock("@/lib/content-trust/reconcile-question-linkage", () => ({
  reconcileQuestionAssertions: (...args: unknown[]) =>
    mockReconcileQuestionAssertions(...args),
}));

// ── import-modules dependency mocks ──────────────────────────────────

vi.mock("@/lib/wizard/sync-authored-modules-to-curriculum", () => ({
  syncAuthoredModulesToCurriculum: (...args: unknown[]) =>
    mockSyncAuthored(...args),
}));

vi.mock("@/lib/curriculum/recommend-next-module", () => ({
  recommendNextModule: (...args: unknown[]) => mockRecommendNextModule(...args),
}));

vi.mock("@/lib/curriculum/reclassify-los", () => ({
  reclassifyLearningObjectives: (...args: unknown[]) =>
    mockReclassifyLearningObjectives(...args),
}));

// Import routes AFTER mocks.
import { POST as regenerateCurriculumPOST } from "@/app/api/courses/[courseId]/regenerate-curriculum/route";
import { POST as importModulesPOST } from "@/app/api/courses/[courseId]/import-modules/route";
import { POST as courseReferencePOST } from "@/app/api/courses/[courseId]/course-reference/route";
import { POST as playbookSubjectsPOST } from "@/app/api/playbooks/[playbookId]/subjects/route";

// ── Helpers ──────────────────────────────────────────────────────────

function makeReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const passingAuth = { session: { user: { id: "u1", role: "OPERATOR" } } };

const SMALL_AUTHORED_DOC = `# Course

**Modules authored:** Yes

## Modules

### Module Catalogue

| ID | Label | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency |
|---|---|---|---|---|---|---|---|
| \`m1\` | Module One | tutor | Student-led | LR + GRA only | No | No | repeatable |
`;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(passingAuth);
  mockIsAuthError.mockReturnValue(false);
  mockBumpPlaybook.mockResolvedValue(undefined);
  mockBumpCurriculumFanout.mockResolvedValue({ count: 1, representativePlaybookId: "playbook-1" });
});

// ─────────────────────────────────────────────────────────────────────
// 1. regenerate-curriculum
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/regenerate-curriculum — #1268 staleness bump", () => {
  const params = Promise.resolve({ courseId: "playbook-1" });

  beforeEach(() => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      name: "Test Course",
      domainId: "d1",
      config: { subjectDiscipline: "english" },
    });
    mockGetSourceIdsForPlaybook.mockResolvedValue(["src-1"]);
    mockResolvePrimarySubject.mockResolvedValue({
      subject: { id: "subj-1", name: "English", qualificationRef: null },
    });
    mockPrisma.contentAssertion.findMany.mockResolvedValue([
      { id: "a1", assertion: "fact 1", category: "CONCEPT", chapter: null, section: null, tags: [] },
    ]);
    mockPrisma.curriculum.findFirst.mockResolvedValue({
      id: "curr-1",
      deliveryConfig: {},
    });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
    mockExtractCurriculum.mockResolvedValue({
      ok: true,
      modules: [
        {
          id: "MOD-1",
          title: "M1",
          description: "",
          sortOrder: 0,
          estimatedDurationMinutes: 30,
          learningOutcomes: [],
          assessmentCriteria: [],
          keyTerms: [],
        },
      ],
      assertionTags: {},
      warnings: [],
    });
    mockSyncModules.mockResolvedValue({
      count: 1,
      reconcile: { assertionsScanned: 1, fkWritten: 1 },
    });
    mockReconcileQuestionAssertions.mockResolvedValue(undefined);
  });

  it("calls bumpCurriculumComposeFanout(curriculumId) after a successful regen", async () => {
    const req = new NextRequest(
      "http://localhost/api/courses/playbook-1/regenerate-curriculum",
      { method: "POST" },
    );
    const res = await regenerateCurriculumPOST(req, { params });
    expect(res.status).toBe(200);
    expect(mockBumpCurriculumFanout).toHaveBeenCalledTimes(1);
    expect(mockBumpCurriculumFanout).toHaveBeenCalledWith("curr-1");
  });

  it("does NOT bump when the course is not found", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const req = new NextRequest(
      "http://localhost/api/courses/missing/regenerate-curriculum",
      { method: "POST" },
    );
    const res = await regenerateCurriculumPOST(req, {
      params: Promise.resolve({ courseId: "missing" }),
    });
    expect(res.status).toBe(404);
    expect(mockBumpCurriculumFanout).not.toHaveBeenCalled();
  });

  it("does NOT bump when extraction returns no modules", async () => {
    mockExtractCurriculum.mockResolvedValue({
      ok: false,
      modules: [],
      assertionTags: {},
      warnings: [],
      error: "boom",
    });
    const req = new NextRequest(
      "http://localhost/api/courses/playbook-1/regenerate-curriculum",
      { method: "POST" },
    );
    const res = await regenerateCurriculumPOST(req, { params });
    expect(res.status).toBe(500);
    expect(mockBumpCurriculumFanout).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. import-modules
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/import-modules — #1268 staleness bump", () => {
  const params = Promise.resolve({ courseId: "playbook-1" });

  beforeEach(() => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: { lessonPlanMode: "continuous" },
    });
    mockPrisma.playbook.update.mockResolvedValue({});
    mockSyncAuthored.mockResolvedValue({
      curriculumId: "curr-1",
      created: 1,
      updated: 0,
      orphaned: 0,
    });
    mockReclassifyLearningObjectives.mockResolvedValue({
      applied: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
    });
    mockRecommendNextModule.mockResolvedValue(null);
  });

  it("calls bumpPlaybookComposeTimestamp(courseId) after a successful import", async () => {
    const res = await importModulesPOST(
      makeReq(
        "http://localhost/api/courses/playbook-1/import-modules",
        { markdown: SMALL_AUTHORED_DOC },
      ),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.persisted).toBe(true);
    expect(mockBumpPlaybook).toHaveBeenCalledTimes(1);
    expect(mockBumpPlaybook).toHaveBeenCalledWith("playbook-1");
  });

  it("does NOT bump when nothing changed (no Modules signal)", async () => {
    const res = await importModulesPOST(
      makeReq(
        "http://localhost/api/courses/playbook-1/import-modules",
        { markdown: "# Plain doc\n\n**Course name:** something" },
      ),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.persisted).toBe(false);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });

  it("does NOT bump when the course is not found", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await importModulesPOST(
      makeReq(
        "http://localhost/api/courses/missing/import-modules",
        { markdown: SMALL_AUTHORED_DOC },
      ),
      { params: Promise.resolve({ courseId: "missing" }) },
    );
    expect(res.status).toBe(404);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. course-reference (upload route)
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/courses/[courseId]/course-reference — #1268 staleness bump", () => {
  const params = Promise.resolve({ courseId: "playbook-1" });

  beforeEach(() => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      name: "Test Course",
    });
    mockPrisma.contentSource.findFirst.mockResolvedValue(null);
    mockPrisma.contentSource.create.mockResolvedValue({ id: "src-new" });
    mockPrisma.playbookSource.upsert.mockResolvedValue({ id: "ps-1" });
  });

  it("calls bumpPlaybookComposeTimestamp(courseId) after a successful upload", async () => {
    const res = await courseReferencePOST(
      makeReq(
        "http://localhost/api/courses/playbook-1/course-reference",
        { markdown: "# Course reference\n\nSome content." },
      ),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.isNew).toBe(true);
    expect(mockBumpPlaybook).toHaveBeenCalledTimes(1);
    expect(mockBumpPlaybook).toHaveBeenCalledWith("playbook-1");
  });

  it("still bumps when reusing an existing source (idempotent re-upload)", async () => {
    mockPrisma.contentSource.findFirst.mockResolvedValue({ id: "existing" });
    const res = await courseReferencePOST(
      makeReq(
        "http://localhost/api/courses/playbook-1/course-reference",
        { markdown: "# Course reference\n\nSome content." },
      ),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNew).toBe(false);
    // Re-upload still flips staleness — the playbook-source link may have
    // just been added even if the source already existed.
    expect(mockBumpPlaybook).toHaveBeenCalledWith("playbook-1");
  });

  it("does NOT bump on a 400 (invalid body)", async () => {
    const res = await courseReferencePOST(
      makeReq(
        "http://localhost/api/courses/playbook-1/course-reference",
        { markdown: "" },
      ),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });

  it("does NOT bump when the course is not found", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await courseReferencePOST(
      makeReq(
        "http://localhost/api/courses/missing/course-reference",
        { markdown: "# anything" },
      ),
      { params: Promise.resolve({ courseId: "missing" }) },
    );
    expect(res.status).toBe(404);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. playbooks/[playbookId]/subjects
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/playbooks/[playbookId]/subjects — #1268 staleness bump", () => {
  const params = Promise.resolve({ playbookId: "playbook-1" });

  beforeEach(() => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "playbook-1" });
    mockPrisma.playbookSubject.upsert.mockResolvedValue({ id: "link-1" });
  });

  it("calls bumpPlaybookComposeTimestamp(playbookId) after a successful link", async () => {
    const res = await playbookSubjectsPOST(
      makeReq(
        "http://localhost/api/playbooks/playbook-1/subjects",
        { subjectIds: ["s1", "s2"] },
      ),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(2);
    expect(mockBumpPlaybook).toHaveBeenCalledTimes(1);
    expect(mockBumpPlaybook).toHaveBeenCalledWith("playbook-1");
  });

  it("does NOT bump when subjectIds is empty (400)", async () => {
    const res = await playbookSubjectsPOST(
      makeReq(
        "http://localhost/api/playbooks/playbook-1/subjects",
        { subjectIds: [] },
      ),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });

  it("does NOT bump when no upserts succeeded", async () => {
    mockPrisma.playbookSubject.upsert.mockRejectedValue(
      new Error("FK violation"),
    );
    const res = await playbookSubjectsPOST(
      makeReq(
        "http://localhost/api/playbooks/playbook-1/subjects",
        { subjectIds: ["bad-subject"] },
      ),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(0);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });

  it("does NOT bump when the playbook is not found", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await playbookSubjectsPOST(
      makeReq(
        "http://localhost/api/playbooks/missing/subjects",
        { subjectIds: ["s1"] },
      ),
      { params: Promise.resolve({ playbookId: "missing" }) },
    );
    expect(res.status).toBe(404);
    expect(mockBumpPlaybook).not.toHaveBeenCalled();
  });
});

// Re-export NextResponse to suppress the unused-import warning — it is
// preserved here so the test file mirrors the production response shape.
export { NextResponse };
