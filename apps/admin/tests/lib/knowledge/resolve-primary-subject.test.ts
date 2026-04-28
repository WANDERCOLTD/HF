/**
 * Tests for resolvePrimarySubjectForPlaybook (#206).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbookSubject: { findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx: unknown) => tx ?? mockPrisma,
}));

const importHelper = async () => {
  const mod = await import("@/lib/knowledge/resolve-primary-subject");
  return mod.resolvePrimarySubjectForPlaybook;
};

const subj = (
  id: string,
  name: string,
  curricula: Array<{ id: string; modules: number; updatedAt: Date }>,
  createdAt: Date = new Date("2026-01-01"),
  sourceCount: number = 0,
) => ({
  subject: {
    id,
    name,
    qualificationRef: null,
    createdAt,
    curricula: curricula.map((c) => ({
      id: c.id,
      updatedAt: c.updatedAt,
      _count: { modules: c.modules },
    })),
    _count: { sources: sourceCount },
  },
});

describe("resolvePrimarySubjectForPlaybook", () => {
  let resolve: Awaited<ReturnType<typeof importHelper>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resolve = await importHelper();
  });

  it("returns null when playbook has zero linked subjects", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([]);
    expect(await resolve("pb-1")).toBeNull();
  });

  it("returns the only subject when playbook has one (no regression)", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-1", "ESOL", [
        { id: "c-1", modules: 5, updatedAt: new Date("2026-04-01") },
      ]),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-1");
    expect(result?.curriculumId).toBe("c-1");
    expect(result?.moduleCount).toBe(5);
  });

  it("prefers the subject whose curriculum has more modules", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-empty", "Course", []),
      subj("s-real", "ESOL", [
        { id: "c-real", modules: 8, updatedAt: new Date("2026-04-01") },
      ]),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-real");
    expect(result?.subject.name).toBe("ESOL");
    expect(result?.moduleCount).toBe(8);
  });

  it("when both populated, picks the one with more modules", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-small", "A", [
        { id: "c-small", modules: 3, updatedAt: new Date("2026-04-15") },
      ]),
      subj("s-big", "B", [
        { id: "c-big", modules: 10, updatedAt: new Date("2026-04-01") },
      ]),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-big");
  });

  it("when same module count, picks the most-recently-updated curriculum", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-old", "A", [
        { id: "c-old", modules: 5, updatedAt: new Date("2026-03-01") },
      ]),
      subj("s-new", "B", [
        { id: "c-new", modules: 5, updatedAt: new Date("2026-04-15") },
      ]),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-new");
  });

  it("when no subject has a curriculum, returns the oldest subject (deterministic)", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-newer", "B", [], new Date("2026-04-01")),
      subj("s-older", "A", [], new Date("2026-01-01")),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-older");
    expect(result?.curriculumId).toBeNull();
    expect(result?.moduleCount).toBe(0);
  });

  it("when curricula are tied (both empty), prefers the subject with more sources (real content)", async () => {
    // The IELTS Speaking case in dev: ESOL has an empty Curriculum row, "Course"
    // has all 1280 assertions across 5 sources but no Curriculum row yet.
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-empty-curr", "ESOL", [
        { id: "c-empty", modules: 0, updatedAt: new Date("2026-04-01") },
      ], new Date("2026-01-01"), /* sources */ 0),
      subj("s-content", "Course", [], new Date("2026-01-01"), /* sources */ 5),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-content");
    expect(result?.subject.name).toBe("Course");
    expect(result?.curriculumId).toBeNull();
  });

  it("falls back to subject with empty curriculum over none, when no sources differ", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      subj("s-no-curr", "A", []),
      subj("s-zero-mods", "B", [
        { id: "c-empty", modules: 0, updatedAt: new Date("2026-04-01") },
      ]),
    ]);
    const result = await resolve("pb-1");
    expect(result?.subjectId).toBe("s-zero-mods");
    expect(result?.curriculumId).toBe("c-empty");
    expect(result?.moduleCount).toBe(0);
  });
});
