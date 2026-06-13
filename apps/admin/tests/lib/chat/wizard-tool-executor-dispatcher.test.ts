/**
 * Golden tests for `executeWizardTool` — the dispatcher contract.
 *
 * Purpose
 * -------
 * Pre-flight for the wizard-tool-executor monolith → per-tool-file split
 * (Phase 1 of docs/audit/HANDOFF-large-file-refactor.md). The split moves
 * each `case` body into its own file under
 * `lib/chat/wizard-tool-executor/tools/<name>.ts`. These tests pin the
 * dispatcher behaviour at the entrypoint (`executeWizardTool(toolName,
 * input, userId, setupData?)`) BEFORE the move, so the per-tool extraction
 * is behaviour-preserving by construction — any drift fails here.
 *
 * What's covered (Tech Lead minimum-5, this branch)
 * -------------------------------------------------
 *   1. `mark_complete`         — terminal lifecycle guards + success shape
 *   2. `create_institution`    — already-exists short-circuit
 *   3. `update_setup`          — progressionMode rejection contract (#398)
 *   4. `create_course` (graph) — pre-launch hard-fail when canLaunch=false
 *   5. `create_course` (reuse) — `unlinkNonPrimaryPlaybookSubjects` fires
 *                                on the existing-playbook reuse path
 *                                (ai-to-db-guard.md row 8 / #607)
 *
 * What's NOT covered (intentional)
 * --------------------------------
 *   - Full happy-path snapshots of every branch in update_setup /
 *     create_course (the executor has ~370 + ~1360 lines of branch code;
 *     covering exhaustively would inflate the test bed to thousands of
 *     LOC for a refactor that should land in days). The refactor PR can
 *     add per-tool tests as each case is extracted.
 *   - `create_institution` create-new transaction body — the test pins
 *     the happy guard path only. The transaction is well-isolated and
 *     its own integration test exists at the prisma level.
 *
 * Mock strategy
 * -------------
 * The executor uses dynamic imports (`await import("@/lib/…")`) so each
 * test mocks only the modules its case body actually loads. `vi.mock`
 * hoists, so per-test mock returns are set via `mockResolvedValueOnce`
 * inside `beforeEach`. Shared `mockPrisma` at the top of the file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared prisma mock — every case touches some subset of these models ──
const mockPrisma = {
  playbook: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  domain: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  institution: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  institutionType: { findFirst: vi.fn() },
  subject: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  subjectDomain: { findFirst: vi.fn(), create: vi.fn() },
  playbookSubject: { upsert: vi.fn() },
  user: { update: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Default $transaction passthrough: feed the same mockPrisma to the
// callback so create_institution's create+create+update chain runs.
beforeEach(() => {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === "object" && model) {
      for (const fn of Object.values(model)) {
        if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  }
  mockPrisma.$transaction.mockReset();
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma));
});

// ─── Dynamic-import targets used across cases ────────────────────────────

const mockUpdatePlaybookConfig = vi.fn(async () => undefined);
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: mockUpdatePlaybookConfig,
}));

const mockUpdateDomainConfig = vi.fn(async () => undefined);
vi.mock("@/lib/domain/update-domain-config", () => ({
  updateDomainConfig: mockUpdateDomainConfig,
}));

const mockValidateSetupFields = vi.fn();
vi.mock("@/lib/wizard/validate-setup-fields", () => ({
  validateSetupFields: mockValidateSetupFields,
}));

const mockEvaluateGraph = vi.fn();
vi.mock("@/lib/wizard/graph-evaluator", () => ({
  evaluateGraph: mockEvaluateGraph,
}));

const mockUnlinkNonPrimaryPlaybookSubjects = vi.fn(async () => ({
  removed: 0,
  displaced: [] as { subjectName: string }[],
}));
const mockRemovePlaceholderPlaybookSubjects = vi.fn(async () => undefined);
const mockIsPlaceholderSubjectName = vi.fn((s: string) => s.toLowerCase() === "course");
vi.mock("@/lib/knowledge/cleanup-placeholder-subjects", () => ({
  unlinkNonPrimaryPlaybookSubjects: mockUnlinkNonPrimaryPlaybookSubjects,
  removePlaceholderPlaybookSubjects: mockRemovePlaceholderPlaybookSubjects,
  isPlaceholderSubjectName: mockIsPlaceholderSubjectName,
}));

// New-path dispatcher pin (#1544 AC) requires mocking the dynamic
// imports the Stage 5 helper makes. Each block returns the bare minimum
// needed for the path to reach the #607 `unlinkNonPrimaryPlaybookSubjects`
// call. Returns past that point can throw — the pin asserts BEFORE.
const mockScaffoldDomain = vi.fn(async () => ({ playbook: { id: "pb-new" } }));
vi.mock("@/lib/domain/scaffold", () => ({ scaffoldDomain: mockScaffoldDomain }));

const mockLoadPersonaArchetype = vi.fn(async () => null);
const mockLoadPersonaFlowPhases = vi.fn(async () => null);
const mockLoadPersonaWelcomeTemplate = vi.fn(async () => null);
vi.mock("@/lib/domain/persona-loaders", () => ({
  loadPersonaArchetype: mockLoadPersonaArchetype,
  loadPersonaFlowPhases: mockLoadPersonaFlowPhases,
  loadPersonaWelcomeTemplate: mockLoadPersonaWelcomeTemplate,
}));

const mockSuggestTeachingProfile = vi.fn(() => ({}));
vi.mock("@/lib/content-trust/teaching-profiles", () => ({
  suggestTeachingProfile: mockSuggestTeachingProfile,
}));

// slugify is dynamically imported; vitest's auto-mock would clobber it.
// Provide a thin real impl since several cases depend on its output for
// transaction params. slugify ships its own default export.
vi.mock("slugify", () => ({
  default: (s: string, opts?: { lower?: boolean; strict?: boolean }) => {
    let out = s.replace(/[^A-Za-z0-9\s-]/g, "").replace(/\s+/g, "-");
    if (opts?.lower) out = out.toLowerCase();
    return out;
  },
}));

// ─── Helper: import executor freshly per-test so mocks above are in scope ─
async function loadExecutor() {
  const mod = await import("@/lib/chat/wizard-tool-executor");
  return mod.executeWizardTool;
}

// ════════════════════════════════════════════════════════════════════════
// 1. mark_complete
// ════════════════════════════════════════════════════════════════════════

describe("executeWizardTool / mark_complete", () => {
  it("BLOCKS with is_error when setupData has no draftPlaybookId", async () => {
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool("mark_complete", {}, "user-1", {});
    expect(result.is_error).toBe(true);
    const body = JSON.parse(result.content);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no course has been created/i);
    // Critical: prisma never touched without a playbook id.
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });

  it("BLOCKS with is_error when the playbook id doesn't resolve in DB", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce(null);
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "mark_complete",
      {},
      "user-1",
      { draftPlaybookId: "pb-missing" },
    );
    expect(result.is_error).toBe(true);
    const body = JSON.parse(result.content);
    expect(body.error).toMatch(/doesn't exist in the database/i);
  });

  it("BLOCKS with is_error when the playbook has no curriculum modules", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "Course Alpha",
      playbookCurricula: [
        { curriculum: { id: "cur-1", _count: { modules: 0 } } },
      ],
    });
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "mark_complete",
      {},
      "user-1",
      { draftPlaybookId: "pb-1" },
    );
    expect(result.is_error).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/no curriculum modules yet/i);
  });

  it("returns 'Setup complete' when playbook + curriculum + modules exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "Course Alpha",
      playbookCurricula: [
        { curriculum: { id: "cur-1", _count: { modules: 5 } } },
      ],
    });
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "mark_complete",
      {},
      "user-1",
      { draftPlaybookId: "pb-1" },
    );
    expect(result.is_error).toBeUndefined();
    expect(result.content).toMatch(/Setup complete/i);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. create_institution
// ════════════════════════════════════════════════════════════════════════

describe("executeWizardTool / create_institution", () => {
  it("short-circuits when setupData carries valid existing UUIDs", async () => {
    // cuid shape: leading 'c' + 24 alphanumeric chars. validUuid accepts /^c[a-z0-9]{24,}$/i.
    const cuid = "ckabcdefghijklmnopqrstuvw";
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "create_institution",
      { name: "Test Org" },
      "user-1",
      {
        existingDomainId: cuid,
        existingInstitutionId: cuid,
      },
    );
    expect(result.is_error).toBeUndefined();
    const body = JSON.parse(result.content);
    expect(body.ok).toBe(true);
    expect(body.alreadyExisted).toBe(true);
    expect(body.institutionId).toBe(cuid);
    expect(body.domainId).toBe(cuid);
    // No write attempted on the short-circuit branch.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns alreadyExisted when resolveInstitutionByName finds a match", async () => {
    // resolveInstitutionByName queries `prisma.institution.findFirst` then
    // reads institution.domains[0] for domainId + subjects/playbooks merge.
    mockPrisma.institution.findFirst.mockResolvedValueOnce({
      id: "inst-1",
      name: "Test Org",
      type: { slug: "school" },
      domains: [
        {
          id: "dom-1",
          kind: "INSTITUTION",
          subjects: [],
          playbooks: [],
        },
      ],
    });

    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "create_institution",
      { name: "Test Org" },
      "user-1",
      {},
    );
    const body = JSON.parse(result.content);
    expect(body.ok).toBe(true);
    expect(body.alreadyExisted).toBe(true);
    expect(body.institutionId).toBe("inst-1");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. update_setup — progressionMode rejection contract (#398)
// ════════════════════════════════════════════════════════════════════════

describe("executeWizardTool / update_setup", () => {
  it("REJECTS progressionMode when not already set in setupData (#398)", async () => {
    mockValidateSetupFields.mockReturnValueOnce({
      validated: { progressionMode: "ai-led", interactionPattern: "voice-first" },
      corrections: [],
      errors: [],
    });
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "update_setup",
      { fields: { progressionMode: "ai-led", interactionPattern: "voice-first" } },
      "user-1",
      {}, // progressionMode NOT already set
    );
    // The valid sibling (interactionPattern) still saves — content threads
    // the rejection note. progressionMode does NOT appear in the saved set.
    expect(result.content).toMatch(/progressionMode NOT saved/i);
    expect(result.content).toMatch(/dataKey:"progressionMode"/);
  });

  it("ALLOWS progressionMode write when already set in setupData (idempotent re-affirm)", async () => {
    mockValidateSetupFields.mockReturnValueOnce({
      validated: { progressionMode: "ai-led" },
      corrections: [],
      errors: [],
    });
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "update_setup",
      { fields: { progressionMode: "ai-led" } },
      "user-1",
      { progressionMode: "ai-led" }, // already set — rewrite allowed
    );
    expect(result.content).not.toMatch(/progressionMode NOT saved/i);
  });

  it("auto-corrects bad field names via validateSetupFields", async () => {
    mockValidateSetupFields.mockReturnValueOnce({
      validated: { progressionMode: "ai-led" },
      corrections: [{ from: "moduleProgression", to: "progressionMode", reason: "alias" }],
      errors: [],
    });
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "update_setup",
      { fields: { moduleProgression: "ai-led" } },
      "user-1",
      { progressionMode: "ai-led" }, // already set so the corrected key isn't re-rejected
    );
    // validateSetupFields was invoked with the raw fields
    expect(mockValidateSetupFields).toHaveBeenCalledWith({ moduleProgression: "ai-led" });
    expect(result.is_error).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. create_course — pre-launch graph guard
// ════════════════════════════════════════════════════════════════════════

describe("executeWizardTool / create_course (graph guard)", () => {
  it("HARD-FAILS with is_error when evaluateGraph.canLaunch is false", async () => {
    mockEvaluateGraph.mockReturnValueOnce({
      canLaunch: false,
      missingRequired: [
        { key: "courseName", label: "Course name" },
        { key: "subjectDiscipline", label: "Subject discipline" },
      ],
    });
    const executeWizardTool = await loadExecutor();
    const result = await executeWizardTool(
      "create_course",
      {},
      "user-1",
      {},
    );
    expect(result.is_error).toBe(true);
    const body = JSON.parse(result.content);
    expect(body.ok).toBe(false);
    expect(body.missingKeys).toEqual(["courseName", "subjectDiscipline"]);
    expect(body.missingLabels).toEqual(["Course name", "Subject discipline"]);
    // Critical: did NOT touch prisma — early hard fail.
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. create_course — reuse path #607 unlink guard (ai-to-db-guard row 8)
// ════════════════════════════════════════════════════════════════════════

describe("executeWizardTool / create_course (reuse path — #607 invariant)", () => {
  it("calls unlinkNonPrimaryPlaybookSubjects when course-scoped Subject exists on reuse", async () => {
    // Graph green-lit.
    mockEvaluateGraph.mockReturnValueOnce({ canLaunch: true, missingRequired: [] });

    // setupData carries a valid draftPlaybookId (cuid shape — leading c + 24 alphanumeric).
    const draftPbId = "ckpb1abcdefghijklmnopqrstu";
    const existingDomainId = "ckdomabcdefghijklmnopqrstu";
    const courseName = "Reused Course";
    const subjectDiscipline = "Geometry";

    // playbook.findUnique #1 — name lookup for the "rename mismatch" guard.
    // Same name → reuse-path proceeds.
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({ name: courseName });
    // playbook.findUnique #2 — the reuse branch's existingPb fetch.
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: draftPbId,
      domainId: existingDomainId,
      config: {},
    });
    // domain.findUnique — slug for expectedSubjectSlug
    mockPrisma.domain.findUnique.mockResolvedValueOnce({ slug: "test-domain" });
    // subject.findUnique — course-scoped Subject DOES exist → unlink fires.
    mockPrisma.subject.findUnique.mockResolvedValueOnce({ id: "subj-1" });

    // Unlink returns 1 displaced.
    mockUnlinkNonPrimaryPlaybookSubjects.mockResolvedValueOnce({
      removed: 1,
      displaced: [{ subjectName: "Stale Subject" }],
    });

    const executeWizardTool = await loadExecutor();
    // Suppress noisy console.log under the reuse-path success branch.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await executeWizardTool(
        "create_course",
        { courseName, subjectDiscipline },
        "user-1",
        {
          draftPlaybookId: draftPbId,
          existingDomainId,
        },
      );
    } catch {
      // The full reuse path continues into enrollment / lesson-plan paths
      // we haven't mocked — a downstream throw is expected. The assertions
      // below are about the #607 guard, which fires BEFORE any throw.
    } finally {
      logSpy.mockRestore();
    }

    // Critical: #607 unlink fired with the resolved Subject id.
    expect(mockUnlinkNonPrimaryPlaybookSubjects).toHaveBeenCalledWith(
      draftPbId,
      "subj-1",
    );
    // Critical: updatePlaybookConfig fired with reason carrying reuse-path label.
    expect(mockUpdatePlaybookConfig).toHaveBeenCalledWith(
      draftPbId,
      expect.any(Function),
      expect.objectContaining({ reason: expect.stringContaining("existing path") }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. create_course — new path #607 unlink guard (#1544 Stage 5 AC)
// ════════════════════════════════════════════════════════════════════════

describe("executeWizardTool / create_course (new path — #607 invariant)", () => {
  it("calls unlinkNonPrimaryPlaybookSubjects on the fresh-scaffold branch too", async () => {
    // Graph green-lit.
    mockEvaluateGraph.mockReturnValueOnce({ canLaunch: true, missingRequired: [] });

    const existingDomainId = "ckdomnewabcdefghijklmnopqr";
    const courseName = "Brand New Course";
    const subjectDiscipline = "Astronomy";

    // domain.findUnique #1 — Stage 5 reads { slug } for the course-scoped Subject slug.
    mockPrisma.domain.findUnique.mockResolvedValueOnce({ slug: "new-domain" });
    // subject.findUnique — slug doesn't exist → forces subject.create.
    mockPrisma.subject.findUnique.mockResolvedValueOnce(null);
    // subject.create — returns the fresh Subject row Stage 5 then threads to #607.
    mockPrisma.subject.create.mockResolvedValueOnce({
      id: "subj-new",
      slug: "new-domain-brand-new-course-astronomy",
      name: subjectDiscipline,
    });
    // subjectDomain.findFirst — no prior link → trigger .create (mocked to no-op).
    mockPrisma.subjectDomain.findFirst.mockResolvedValueOnce(null);
    // playbook.findFirst — dedup-by-name returns null → no recurse into reuse path.
    mockPrisma.playbook.findFirst.mockResolvedValueOnce(null);

    const executeWizardTool = await loadExecutor();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await executeWizardTool(
        "create_course",
        { courseName, subjectDiscipline },
        "user-1",
        {
          existingDomainId,
        },
      );
    } catch {
      // Downstream of #607 (config/projection/onboarding flow) isn't fully
      // mocked — a throw past the pin is expected. The assertion below fires
      // BEFORE any throw because the #607 unlink is one of the first writes
      // after scaffoldDomain returns.
    } finally {
      logSpy.mockRestore();
    }

    // Critical: #607 unlink fires on the new-path too, with the freshly-
    // created Subject as the keep-id.
    expect(mockUnlinkNonPrimaryPlaybookSubjects).toHaveBeenCalledWith(
      "pb-new",
      "subj-new",
    );
    // Critical: scaffoldDomain was called with forceNewPlaybook so the
    // path is truly the fresh-scaffold branch.
    expect(mockScaffoldDomain).toHaveBeenCalledWith(
      existingDomainId,
      expect.objectContaining({
        forceNewPlaybook: true,
        playbookName: courseName,
      }),
    );
  });
});
