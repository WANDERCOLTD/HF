/**
 * #607 — cleanup-placeholder-subjects: unlinkNonPrimaryPlaybookSubjects.
 *
 * Verifies the single-primary-subject invariant guard at the
 * analyze → create_course composition point. quick-launch/analyze creates
 * a domain-level Subject (bare slug); wizard-tool-executor.create_course
 * creates a course-scoped Subject. The DB unique constraint only prevents
 * (playbookId, subjectId) pair-duplicates — different subjects on the
 * same playbook slip past. unlinkNonPrimaryPlaybookSubjects displaces the
 * non-primary rows after the primary is linked.
 *
 * Also verifies the pre-existing placeholder cleanup still works.
 *
 * See: gh issue view 607
 *      lib/knowledge/cleanup-placeholder-subjects.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  deleteOne: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playbookSubject: {
      findMany: mocks.findMany,
      deleteMany: mocks.deleteMany,
      delete: mocks.deleteOne,
    },
  },
}));

import {
  isPlaceholderSubjectName,
  removePlaceholderPlaybookSubjects,
  unlinkNonPrimaryPlaybookSubjects,
} from "@/lib/knowledge/cleanup-placeholder-subjects";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────
// isPlaceholderSubjectName
// ─────────────────────────────────────────────────────────
describe("isPlaceholderSubjectName", () => {
  it.each(["course", "subject", "training plan", "playbook", "Course", "  Subject  "])(
    "returns true for placeholder term %s",
    (name) => {
      expect(isPlaceholderSubjectName(name)).toBe(true);
    },
  );

  it.each(["IELTS Speaking Practice", "GCSE Biology", "ESOL"])(
    "returns false for real subject name %s",
    (name) => {
      expect(isPlaceholderSubjectName(name)).toBe(false);
    },
  );

  it("returns true for null/empty", () => {
    expect(isPlaceholderSubjectName(null)).toBe(true);
    expect(isPlaceholderSubjectName("")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// #607 — unlinkNonPrimaryPlaybookSubjects
// ─────────────────────────────────────────────────────────
describe("#607 — unlinkNonPrimaryPlaybookSubjects", () => {
  const playbookId = "pb-ielts-prep-lab";
  const primarySubjectId = "subj-course-scoped";

  it("no-ops when only the primary subject is linked", async () => {
    mocks.findMany.mockResolvedValueOnce([]);

    const result = await unlinkNonPrimaryPlaybookSubjects(playbookId, primarySubjectId);

    expect(result).toEqual({ removed: 0, displaced: [] });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { playbookId, NOT: { subjectId: primarySubjectId } },
      select: expect.any(Object),
    });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("unlinks a single non-primary subject and returns displaced metadata", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        subjectId: "subj-esol",
        subject: { id: "subj-esol", name: "ESOL", slug: "esol" },
      },
    ]);
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await unlinkNonPrimaryPlaybookSubjects(playbookId, primarySubjectId);

    expect(result.removed).toBe(1);
    expect(result.displaced).toEqual([
      { subjectId: "subj-esol", subjectName: "ESOL", subjectSlug: "esol" },
    ]);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { playbookId, subjectId: { in: ["subj-esol"] } },
    });
  });

  it("unlinks multiple non-primary subjects in a single deleteMany", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { subjectId: "subj-a", subject: { id: "subj-a", name: "Subject A", slug: "subject-a" } },
      { subjectId: "subj-b", subject: { id: "subj-b", name: "Subject B", slug: "subject-b" } },
      { subjectId: "subj-c", subject: { id: "subj-c", name: "Subject C", slug: "subject-c" } },
    ]);
    mocks.deleteMany.mockResolvedValueOnce({ count: 3 });

    const result = await unlinkNonPrimaryPlaybookSubjects(playbookId, primarySubjectId);

    expect(result.removed).toBe(3);
    expect(result.displaced.map((d) => d.subjectName)).toEqual(["Subject A", "Subject B", "Subject C"]);
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { playbookId, subjectId: { in: ["subj-a", "subj-b", "subj-c"] } },
    });
  });

  it("never deletes the primary subject (it's excluded by the findMany filter)", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { subjectId: "subj-other", subject: { id: "subj-other", name: "Other", slug: "other" } },
    ]);
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 });

    await unlinkNonPrimaryPlaybookSubjects(playbookId, primarySubjectId);

    const findManyArg = mocks.findMany.mock.calls[0][0];
    expect(findManyArg.where).toMatchObject({ NOT: { subjectId: primarySubjectId } });

    const deleteManyArg = mocks.deleteMany.mock.calls[0][0];
    expect(deleteManyArg.where.subjectId.in).not.toContain(primarySubjectId);
  });

  it("logs each displaced subject for telemetry", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.findMany.mockResolvedValueOnce([
      { subjectId: "subj-esol", subject: { id: "subj-esol", name: "ESOL", slug: "esol" } },
    ]);
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 });

    await unlinkNonPrimaryPlaybookSubjects(playbookId, primarySubjectId);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[unlink-non-primary] playbook ${playbookId}`),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`"ESOL"`));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`keeping primary ${primarySubjectId}`));
    logSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────
// Regression — placeholder cleanup still works
// ─────────────────────────────────────────────────────────
describe("removePlaceholderPlaybookSubjects (#207 regression)", () => {
  const playbookId = "pb-x";
  const keepSubjectId = "subj-keep";

  it("removes empty placeholder subjects (placeholder name + no curriculum + no assertions)", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        subjectId: "subj-placeholder",
        subject: {
          id: "subj-placeholder",
          name: "Course",
          curricula: [],
          sources: [],
        },
      },
    ]);
    mocks.deleteOne.mockResolvedValueOnce({});

    const removed = await removePlaceholderPlaybookSubjects(playbookId, keepSubjectId);

    expect(removed).toBe(1);
    expect(mocks.deleteOne).toHaveBeenCalledWith({
      where: { playbookId_subjectId: { playbookId, subjectId: "subj-placeholder" } },
    });
  });

  it("preserves a placeholder-named subject that has real content", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        subjectId: "subj-courseful",
        subject: {
          id: "subj-courseful",
          name: "Course",
          curricula: [{ id: "curr-1" }],
          sources: [],
        },
      },
    ]);

    const removed = await removePlaceholderPlaybookSubjects(playbookId, keepSubjectId);

    expect(removed).toBe(0);
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });

  it("preserves a real-named subject (e.g. ESOL) even when empty — #607 handles this case", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        subjectId: "subj-esol",
        subject: {
          id: "subj-esol",
          name: "ESOL",
          curricula: [],
          sources: [],
        },
      },
    ]);

    const removed = await removePlaceholderPlaybookSubjects(playbookId, keepSubjectId);

    expect(removed).toBe(0);
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });
});
