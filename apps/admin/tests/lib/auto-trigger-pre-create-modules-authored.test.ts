/**
 * #476 — auto-trigger.ts pre-create_course modulesAuthored guard.
 *
 * Extraction completes before create_course, so #469's playbook lookup
 * returns null and the LLM runner fires anyway. This guard reads the
 * "Modules authored: Yes" declaration directly from the COURSE_REFERENCE_
 * CANONICAL source's textSample, BEFORE any playbook exists.
 *
 * Live IELTS run 2026-05-18 produced 11 spurious modules because of this
 * race — the LLM curriculum landed on the auto-created ESOL subject and
 * drove the tutor to lecture about exam format instead of running practice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn().mockResolvedValue([{ count: BigInt(0) }]),
  contentAssertion: { count: vi.fn().mockResolvedValue(1) },
  playbookSubject: { findFirst: vi.fn().mockResolvedValue(null) },
  subjectSource: { findMany: vi.fn().mockResolvedValue([]) },
  subject: { findUnique: vi.fn().mockResolvedValue({ name: "Test Subject" }) },
}));

const mockStartCurriculumGeneration = vi.hoisted(() => vi.fn().mockResolvedValue("task-auto"));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/jobs/curriculum-runner", () => ({
  startCurriculumGeneration: (...args: unknown[]) => mockStartCurriculumGeneration(...args),
}));

import { checkAutoTriggerCurriculum } from "@/lib/jobs/auto-trigger";

const SAMPLE_WITH_AUTHORED = `# IELTS Speaking Practice — Course Reference

## Course Configuration

**Modules authored:** Yes

## Modules

### Module Catalogue

| id | title | outcomesPrimary |
| --- | --- | --- |
| baseline | Part 1: Familiar Topics | OUT-01, OUT-02 |
| part2 | Part 2: Long Turn | OUT-03 |
`;

const SAMPLE_NO_AUTHORED = `# IELTS Speaking Practice — Course Reference

## Course Configuration

**Modules authored:** No

This course uses AI-generated module structure.
`;

const SAMPLE_PARTIAL = `# Some Course

## Course Configuration

**Modules authored:** Partial

## Modules

### Module Catalogue

| id | title | outcomesPrimary |
| --- | --- | --- |
| mod-1 | Module One | OUT-01 |
`;

describe("auto-trigger pre-create_course modulesAuthored guard (#476)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    mockPrisma.contentAssertion.count.mockResolvedValue(1);
    mockPrisma.subject.findUnique.mockResolvedValue({ name: "IELTS Speaking Practice" });
    mockPrisma.playbookSubject.findFirst.mockResolvedValue(null); // no playbook yet
  });

  it("returns null when source textSample declares Modules authored: Yes", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { source: { id: "src-1", slug: "course-ref", textSample: SAMPLE_WITH_AUTHORED } },
    ]);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("returns null when 'Partial' is declared with at least one module", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { source: { id: "src-1", slug: "course-ref", textSample: SAMPLE_PARTIAL } },
    ]);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("fires curriculum generation when source textSample declares Modules authored: No", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { source: { id: "src-1", slug: "course-ref", textSample: SAMPLE_NO_AUTHORED } },
    ]);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("task-auto");
    expect(mockStartCurriculumGeneration).toHaveBeenCalled();
  });

  it("fires curriculum generation when no COURSE_REFERENCE source exists", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([]);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("task-auto");
    expect(mockStartCurriculumGeneration).toHaveBeenCalled();
  });

  it("returns null when ANY linked canonical source declares authored modules (multi-source)", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { source: { id: "src-1", slug: "older-course-ref", textSample: SAMPLE_NO_AUTHORED } },
      { source: { id: "src-2", slug: "course-ref", textSample: SAMPLE_WITH_AUTHORED } },
    ]);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("skips sources with null textSample (no crash, no false skip)", async () => {
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      { source: { id: "src-1", slug: "no-sample", textSample: null } },
    ]);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("task-auto");
    expect(mockStartCurriculumGeneration).toHaveBeenCalled();
  });
});
