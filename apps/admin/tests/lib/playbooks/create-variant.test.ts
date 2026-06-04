/**
 * Tests for `lib/playbooks/create-variant.ts` — #1034.
 *
 * Verifies the central invariants of variant creation:
 *   • Curriculum is LINKED via PlaybookCurriculum{role:'linked'}, never cloned.
 *   • CurriculumModule rows are NEVER written (mastery shared via UUID).
 *   • Subjects + Sources mirror parent's join rows.
 *   • All writes happen inside a single $transaction.
 *   • #607 invariant guard (unlinkNonPrimaryPlaybookSubjects) is called.
 *   • Audit row is written with `kind: "variant"` + provenance metadata.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const txInteractive = vi.fn(async (fn: (tx: any) => any) => fn(mockTx));

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  $transaction: txInteractive,
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockTx = {
  playbook: { create: vi.fn() },
  playbookCurriculum: { create: vi.fn() },
  playbookSubject: { create: vi.fn() },
  playbookSource: { create: vi.fn() },
  // Variant must NEVER write CurriculumModule — sentinel for regression.
  curriculumModule: { create: vi.fn() },
  curriculum: { create: vi.fn() },
};

const mockUnlink = vi.fn(async () => ({ removed: 0, displaced: [] }));
vi.mock("@/lib/knowledge/cleanup-placeholder-subjects", () => ({
  unlinkNonPrimaryPlaybookSubjects: mockUnlink,
}));

const mockAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  auditLog: mockAudit,
  AuditAction: {
    CREATED_PLAYBOOK: "created_playbook",
  },
}));

describe("createPlaybookVariant — #1034", () => {
  let mod: typeof import("@/lib/playbooks/create-variant");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/playbooks/create-variant");

    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "pb-parent",
      name: "The Standard — Foundation",
      domainId: "dom-1",
      groupId: "grp-1",
      sortOrder: 5,
      playbookCurricula: [{ curriculumId: "c-shared" }],
      subjects: [{ subjectId: "subj-primary" }],
      playbookSources: [
        {
          sourceId: "src-1",
          sortOrder: 0,
          tags: ["content"],
          trustLevelOverride: null,
        },
      ],
    });
    mockTx.playbook.create.mockResolvedValue({ id: "pb-variant" });
  });

  it("creates a variant Playbook, linked Curriculum, mirrored Subjects and Sources", async () => {
    const result = await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Pop Quiz — The Standard",
      preset: "popquiz",
      actorUserId: "user-1",
      reason: "spawn from parent",
    });

    expect(result.variantPlaybookId).toBe("pb-variant");
    expect(result.sharedCurriculumId).toBe("c-shared");
    expect(result.subjectLinks).toBe(1);
    expect(result.sourceLinks).toBe(1);

    // Variant Playbook row
    expect(mockTx.playbook.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        name: "Pop Quiz — The Standard",
        domainId: "dom-1",
        groupId: "grp-1",
        sortOrder: 6,
        status: "DRAFT",
        config: expect.objectContaining({
          teachingProfile: "assessment-led",
          modelTier: "haiku",
        }),
      }),
      select: { id: true },
    });

    // PlaybookCurriculum row — role='linked', NOT 'primary'
    expect(mockTx.playbookCurriculum.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        playbookId: "pb-variant",
        curriculumId: "c-shared",
        role: "linked",
      },
    });

    // PlaybookSubject mirror
    expect(mockTx.playbookSubject.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        playbookId: "pb-variant",
        subjectId: "subj-primary",
      },
    });

    // PlaybookSource mirror
    expect(mockTx.playbookSource.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        playbookId: "pb-variant",
        sourceId: "src-1",
        sortOrder: 0,
        tags: ["content"],
        trustLevelOverride: null,
      },
    });
  });

  it("REGRESSION (CC-A invariant): NEVER writes CurriculumModule or Curriculum on the variant path", async () => {
    await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Variant X",
      actorUserId: "user-1",
    });
    expect(mockTx.curriculumModule.create).not.toHaveBeenCalled();
    expect(mockTx.curriculum.create).not.toHaveBeenCalled();
  });

  it("runs all writes inside one $transaction (interactive form)", async () => {
    await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Variant X",
      actorUserId: "user-1",
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it("calls unlinkNonPrimaryPlaybookSubjects after tx commit (#607 invariant guard)", async () => {
    await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Variant X",
      actorUserId: "user-1",
    });
    expect(mockUnlink).toHaveBeenCalledExactlyOnceWith("pb-variant", "subj-primary");
  });

  it("writes audit row with variant provenance metadata", async () => {
    await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Variant X",
      preset: "exam",
      actorUserId: "user-1",
      reason: "build exam tier",
    });
    expect(mockAudit).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      action: "created_playbook",
      entityType: "Playbook",
      entityId: "pb-variant",
      metadata: expect.objectContaining({
        kind: "variant",
        parentPlaybookId: "pb-parent",
        sharedCurriculumId: "c-shared",
        preset: "exam",
        reason: "build exam tier",
      }),
    });
  });

  it("preset=undefined seeds an empty config (forward-declared keys absent)", async () => {
    await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Variant X",
      actorUserId: "user-1",
    });
    const data = mockTx.playbook.create.mock.calls[0][0].data;
    expect(data.config).toEqual({});
  });

  it("skips PlaybookCurriculum write when parent has no Curriculum (graceful)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "pb-parent",
      name: "Parent without curriculum",
      domainId: "dom-1",
      groupId: null,
      sortOrder: 0,
      playbookCurricula: [],
      subjects: [],
      playbookSources: [],
    });

    const result = await mod.createPlaybookVariant({
      parentPlaybookId: "pb-parent",
      name: "Variant X",
      actorUserId: "user-1",
    });
    expect(result.sharedCurriculumId).toBeNull();
    expect(mockTx.playbookCurriculum.create).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("throws when parent Playbook is missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    await expect(
      mod.createPlaybookVariant({
        parentPlaybookId: "pb-missing",
        name: "Variant X",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("throws on empty name", async () => {
    await expect(
      mod.createPlaybookVariant({
        parentPlaybookId: "pb-parent",
        name: "   ",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(/name is required/);
  });
});
