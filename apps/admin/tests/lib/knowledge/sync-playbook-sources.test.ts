/**
 * Tests for syncPlaybookSources inheritance boundary (#478).
 *
 * Background: the wizard creating a new course can link the playbook to an
 * existing Subject (e.g. a shared "ESOL" subject). Before #478,
 * syncPlaybookSources copied EVERY SubjectSource row on that subject into
 * the new playbook's PlaybookSource rows — including stale content from
 * prior wizard experiments. The reported incident: a freshly-created IELTS
 * course inherited an old course-ref attached to ESOL by an unrelated run.
 *
 * The fix: by default, only SubjectSource rows created AFTER playbook.createdAt
 * are synced. `{ includePreExisting: true }` opts out for backfill scripts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  playbook: {
    findUnique: vi.fn(),
  },
  subjectSource: {
    findMany: vi.fn(),
  },
  playbookSource: {
    upsert: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

import { syncPlaybookSources } from "@/lib/knowledge/domain-sources";

describe("syncPlaybookSources — inheritance boundary (#478)", () => {
  const PLAYBOOK_ID = "pb-new-course";
  const SUBJECT_ID = "subj-shared";
  const PLAYBOOK_CREATED_AT = new Date("2026-05-18T15:49:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({ createdAt: PLAYBOOK_CREATED_AT });
    mockPrisma.subjectSource.findMany.mockResolvedValue([]);
  });

  it("default behaviour: only syncs SubjectSource rows created at-or-after playbook.createdAt", async () => {
    await syncPlaybookSources(PLAYBOOK_ID, SUBJECT_ID);

    expect(mockPrisma.subjectSource.findMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.subjectSource.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      subjectId: SUBJECT_ID,
      createdAt: { gte: PLAYBOOK_CREATED_AT },
    });
  });

  it("includePreExisting=true: lifts the boundary — syncs every SubjectSource on the subject", async () => {
    await syncPlaybookSources(PLAYBOOK_ID, SUBJECT_ID, { includePreExisting: true });

    expect(mockPrisma.subjectSource.findMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.subjectSource.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ subjectId: SUBJECT_ID });
    expect(call.where.createdAt).toBeUndefined();
  });

  it("returns 0 and skips upserts when playbook does not exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const synced = await syncPlaybookSources(PLAYBOOK_ID, SUBJECT_ID);

    expect(synced).toBe(0);
    expect(mockPrisma.subjectSource.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.playbookSource.upsert).not.toHaveBeenCalled();
  });

  it("upserts one PlaybookSource per returned SubjectSource (preserving sortOrder/tags/trustLevelOverride)", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { sourceId: "src-new-1", sortOrder: 0, tags: ["content"], trustLevelOverride: null },
      { sourceId: "src-new-2", sortOrder: 1, tags: ["content", "syllabus"], trustLevelOverride: "VERIFIED" },
    ]);

    const synced = await syncPlaybookSources(PLAYBOOK_ID, SUBJECT_ID);

    expect(synced).toBe(2);
    expect(mockPrisma.playbookSource.upsert).toHaveBeenCalledTimes(2);
    const firstCall = mockPrisma.playbookSource.upsert.mock.calls[0][0];
    expect(firstCall.create).toEqual({
      playbookId: PLAYBOOK_ID,
      sourceId: "src-new-1",
      sortOrder: 0,
      tags: ["content"],
      trustLevelOverride: null,
    });
    expect(firstCall.update).toEqual({});
  });

  it("ESOL leak regression: pre-existing SubjectSource rows do NOT propagate to a fresh playbook", async () => {
    // Prisma applies the createdAt filter at the DB level, so the mock just
    // verifies the filter is constructed — and that no pre-existing rows
    // sneak through under the default opts.
    mockPrisma.subjectSource.findMany.mockImplementation(async ({ where }: any) => {
      const all = [
        // Pre-existing row from a prior wizard experiment (stale ESOL course-ref)
        { sourceId: "src-stale-courseref", createdAt: new Date("2026-05-18T15:20:00.000Z"), sortOrder: 0, tags: ["content"], trustLevelOverride: null },
        // Fresh row attached as part of this wizard run
        { sourceId: "src-fresh-question-bank", createdAt: new Date("2026-05-18T15:49:30.000Z"), sortOrder: 0, tags: ["content"], trustLevelOverride: null },
      ];
      const gte = where?.createdAt?.gte;
      return gte ? all.filter((r) => r.createdAt.getTime() >= gte.getTime()) : all;
    });

    const synced = await syncPlaybookSources(PLAYBOOK_ID, SUBJECT_ID);

    expect(synced).toBe(1);
    const syncedSourceIds = mockPrisma.playbookSource.upsert.mock.calls.map(
      (call) => call[0].create.sourceId,
    );
    expect(syncedSourceIds).toEqual(["src-fresh-question-bank"]);
    expect(syncedSourceIds).not.toContain("src-stale-courseref");
  });
});
