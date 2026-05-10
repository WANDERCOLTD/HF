/**
 * import-modules-helper.test.ts
 *
 * Pure-logic tests for the shared "import authored modules" helper. The
 * helper itself takes a Prisma transaction client so we mock it with a
 * minimal in-memory stub — we are checking the routing of detectAuthoredModules
 * output into the merge + sync pipeline, NOT the parser itself (which has
 * its own coverage in detect-authored-modules.test.ts).
 *
 * Covers the three create_course pass/fail branches called out in the
 * #318 follow-up brief:
 *   (a) course-ref with `Modules authored: Yes` + 4 module rows
 *       → success with modules.length === 4
 *   (b) course-ref with `Modules authored: Yes` + malformed table
 *       → parser returns 0 modules; helper signals via detected.modules
 *   (c) no course-ref → no-op, leaves config untouched
 */

import { describe, it, expect, vi } from "vitest";
import { importAuthoredModulesIntoPlaybook } from "../import-modules-helper";

interface MockPlaybook {
  id: string;
  config: Record<string, unknown>;
}

function makeTx(playbook: MockPlaybook) {
  const updated = { value: null as Record<string, unknown> | null };
  const moduleUpserts: { slug: string; title: string }[] = [];
  const loUpserts: { ref: string; description: string }[] = [];
  const tx = {
    playbook: {
      findUnique: vi.fn(async () => ({
        ...playbook,
        // syncAuthoredModulesToCurriculum expects `curricula` + `name`
        name: "Test Playbook",
        curricula: [{ id: "curr-1" }],
      })),
      update: vi.fn(async ({ data }: { data: { config: Record<string, unknown> } }) => {
        updated.value = data.config;
        playbook.config = data.config;
        return playbook;
      }),
    },
    curriculum: {
      create: vi.fn(async () => ({ id: "curr-1" })),
    },
    curriculumModule: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create }: { create: { slug: string; title: string } }) => {
        moduleUpserts.push({ slug: create.slug, title: create.title });
        const now = new Date();
        return { id: `mod-${moduleUpserts.length}`, createdAt: now, updatedAt: now };
      }),
    },
    learningObjective: {
      upsert: vi.fn(async ({ create }: { create: { ref: string; description: string } }) => {
        loUpserts.push({ ref: create.ref, description: create.description });
        return { id: `lo-${loUpserts.length}` };
      }),
    },
  };
  return { tx, updated, moduleUpserts, loUpserts };
}

const VALID_COURSE_REF = `
# Course Reference — Sample

**Modules authored:** Yes

## Modules

| ID | Label | Learner-selectable | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency | Content source | Outcomes (primary) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| \`part1\` | Part 1: Familiar Topics | Yes | Tutor | Student-led | LR + GRA only | No | No | Repeatable | Source 1 | OUT-01, 02 |
| \`part2\` | Part 2: Cue Card | Yes | Mixed | Student-led | All four | No | No | Repeatable | Source 2 | OUT-04, 08 |
| \`part3\` | Part 3: Discussion | Yes | Tutor | Student-led | LR + GRA only | No | No | Repeatable | Source 3 | OUT-13, 14 |
| \`mock\` | Full Mock Test | Yes | Examiner | 11-14 min | All four | Yes | Yes | Cooldown | Source 4 | OUT-04, 22 |

**OUT-01: Extends every answer.**
**OUT-02: Uses topic-specific vocabulary.**
**OUT-04: Sustains a monologue.**
`.trim();

const MALFORMED_COURSE_REF = `
# Course Reference — Sample

**Modules authored:** Yes

## Modules

Some prose here but no table at all. Just paragraphs.

The catalogue should be a markdown table but it isn't. The parser should
return zero modules and emit warnings.
`.trim();

describe("importAuthoredModulesIntoPlaybook (PR 1, #318 follow-up)", () => {
  it("(a) parses Modules authored: Yes + 4 module rows → 4 modules persisted", async () => {
    const playbook: MockPlaybook = { id: "pb-1", config: {} };
    const { tx, updated, moduleUpserts } = makeTx(playbook);
    const result = await importAuthoredModulesIntoPlaybook(
      tx as never,
      "pb-1",
      VALID_COURSE_REF,
    );
    expect(result.detected.modulesAuthored).toBe(true);
    expect(result.detected.modules).toHaveLength(4);
    expect(result.persisted).toBe(true);
    expect(updated.value).toMatchObject({ modulesAuthored: true, moduleSource: "authored" });
    expect((updated.value as Record<string, unknown>).modules).toHaveLength(4);
    expect(moduleUpserts.map((m) => m.slug)).toEqual(["part1", "part2", "part3", "mock"]);
    expect(result.curriculumSync?.curriculumId).toBe("curr-1");
  });

  it("(b) Modules authored: Yes + malformed table → 0 modules, persisted but hard-gate-bait", async () => {
    const playbook: MockPlaybook = { id: "pb-2", config: {} };
    const { tx } = makeTx(playbook);
    const result = await importAuthoredModulesIntoPlaybook(
      tx as never,
      "pb-2",
      MALFORMED_COURSE_REF,
    );
    // The parser DOES NOT raise: it returns modulesAuthored=true but 0 modules,
    // along with a validationWarning. The wizard executor's hard gate is what
    // converts this into a CREATE_COURSE_INCOMPLETE error. We assert the
    // parser shape here so the executor's gate logic has the data it needs.
    expect(result.detected.modules).toHaveLength(0);
    // No curriculum sync runs because modules.length < 1.
    expect(result.curriculumSync).toBeNull();
    // The parser flagged the absence of a catalogue.
    expect(result.detected.validationWarnings.length).toBeGreaterThan(0);
  });

  it("(c) no `Modules authored:` declaration → no-op, config untouched", async () => {
    const playbook: MockPlaybook = { id: "pb-3", config: { lessonPlanMode: "continuous" } };
    const { tx, updated } = makeTx(playbook);
    const result = await importAuthoredModulesIntoPlaybook(
      tx as never,
      "pb-3",
      "# Just a course reference\n\nNo modules-authored header here.",
    );
    expect(result.detected.modulesAuthored).toBe(null);
    expect(result.persisted).toBe(false);
    expect(updated.value).toBeNull();
    expect(result.curriculumSync).toBeNull();
  });
});
