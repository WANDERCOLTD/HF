/**
 * Content Isolation Integration Test
 *
 * Proves that two courses on the same domain, same discipline, with
 * overlapping documents have ZERO content cross-contamination.
 *
 * Setup:
 *   - 1 domain ("Greenfield Academy")
 *   - 2 playbooks, both "English Language"
 *   - 3 content sources (Course A → src1+src2, Course B → src2+src3)
 *   - Assertions scoped per-course via SubjectSource chains
 *   - 1 caller enrolled in each course
 *
 * This test should FAIL without the PlaybookSource migration (or pass
 * only with band-aid patches). After migration it passes structurally.
 *
 * @see https://github.com/paw2paw/HF/issues/180
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  getSourceIdsForPlaybook,
  getSubjectsForPlaybook,
} from "@/lib/knowledge/domain-sources";

const prisma = new PrismaClient();
const PREFIX = "isolation-test";

// ── Fixture IDs (populated in beforeAll) ────────────────────────────

interface IsolationFixtures {
  domainId: string;
  // Course A
  subjectAId: string;
  playbookAId: string;
  callerAId: string;
  sourceAOnlyId: string;   // source 1 — exclusive to A
  sharedSourceId: string;  // source 2 — shared between A and B
  assertionIdsA: string[]; // assertions scoped to Course A's SubjectSource
  // Course B
  subjectBId: string;
  playbookBId: string;
  callerBId: string;
  sourceBOnlyId: string;   // source 3 — exclusive to B
  assertionIdsB: string[]; // assertions scoped to Course B's SubjectSource
}

let fx: IsolationFixtures;

// ── Fixture Data ────────────────────────────────────────────────────

const ASSERTIONS_A = [
  {
    assertion: "Shakespeare's sonnets follow an ABAB CDCD EFEF GG rhyme scheme.",
    category: "definition",
    tags: ["english", "poetry", "shakespeare"],
    orderIndex: 0,
    topicSlug: "sonnets",
  },
  {
    assertion: "Iambic pentameter consists of five metrical feet, each with an unstressed and stressed syllable.",
    category: "rule",
    tags: ["english", "poetry", "metre"],
    orderIndex: 1,
    topicSlug: "metre",
  },
  {
    assertion: "A volta marks the turn in a sonnet, typically at line 9 (Petrarchan) or line 13 (Shakespearean).",
    category: "definition",
    tags: ["english", "poetry", "structure"],
    orderIndex: 2,
    topicSlug: "sonnets",
  },
];

const ASSERTIONS_SHARED_FOR_A = [
  {
    assertion: "Pathetic fallacy uses weather or nature to reflect a character's emotional state.",
    category: "definition",
    tags: ["english", "literary-devices"],
    orderIndex: 0,
    topicSlug: "literary-devices",
  },
];

const ASSERTIONS_SHARED_FOR_B = [
  {
    assertion: "Pathetic fallacy in Brontë's Wuthering Heights mirrors Heathcliff's inner turmoil.",
    category: "example",
    tags: ["english", "literary-devices", "novel"],
    orderIndex: 0,
    topicSlug: "literary-devices",
  },
];

const ASSERTIONS_B = [
  {
    assertion: "First-person narration creates intimacy but limits the reader to one perspective.",
    category: "rule",
    tags: ["english", "narrative", "prose"],
    orderIndex: 0,
    topicSlug: "narrative-voice",
  },
  {
    assertion: "An unreliable narrator forces the reader to question the truth of the story.",
    category: "definition",
    tags: ["english", "narrative", "prose"],
    orderIndex: 1,
    topicSlug: "narrative-voice",
  },
];

// ── Setup & Teardown ────────────────────────────────────────────────

async function seedIsolationFixtures(): Promise<IsolationFixtures> {
  // 1. Domain
  const domain = await prisma.domain.upsert({
    where: { slug: `${PREFIX}-domain` },
    create: {
      slug: `${PREFIX}-domain`,
      name: "Greenfield Academy (Isolation Test)",
      isActive: true,
    },
    update: { isActive: true },
  });

  // 2. Two subjects — SAME discipline name, different per-course slugs
  //    (This mirrors what course-setup.ts does today)
  const subjectA = await prisma.subject.upsert({
    where: { slug: `${PREFIX}-english-course-a` },
    create: {
      slug: `${PREFIX}-english-course-a`,
      name: "English Language",
      description: "Course A's per-course subject",
    },
    update: {},
  });

  const subjectB = await prisma.subject.upsert({
    where: { slug: `${PREFIX}-english-course-b` },
    create: {
      slug: `${PREFIX}-english-course-b`,
      name: "English Language",
      description: "Course B's per-course subject",
    },
    update: {},
  });

  // Link both subjects to domain
  for (const s of [subjectA, subjectB]) {
    await prisma.subjectDomain.upsert({
      where: { subjectId_domainId: { subjectId: s.id, domainId: domain.id } },
      create: { subjectId: s.id, domainId: domain.id },
      update: {},
    });
  }

  // 3. Three content sources
  const sourceAOnly = await prisma.contentSource.upsert({
    where: { slug: `${PREFIX}-poetry-anthology` },
    create: {
      slug: `${PREFIX}-poetry-anthology`,
      name: "Poetry Anthology (Course A only)",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "TEXTBOOK",
      documentTypeSource: "test:fixture",
    },
    update: {},
  });

  const sharedSource = await prisma.contentSource.upsert({
    where: { slug: `${PREFIX}-literary-devices-guide` },
    create: {
      slug: `${PREFIX}-literary-devices-guide`,
      name: "Literary Devices Study Guide (shared)",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "TEXTBOOK",
      documentTypeSource: "test:fixture",
    },
    update: {},
  });

  const sourceBOnly = await prisma.contentSource.upsert({
    where: { slug: `${PREFIX}-prose-reader` },
    create: {
      slug: `${PREFIX}-prose-reader`,
      name: "Prose Reader (Course B only)",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "TEXTBOOK",
      documentTypeSource: "test:fixture",
    },
    update: {},
  });

  // 4. SubjectSource links — THIS IS THE KEY SCOPING MECHANISM
  //    Course A's subject links to: sourceAOnly + sharedSource
  //    Course B's subject links to: sharedSource + sourceBOnly
  const ssAOnly = await prisma.subjectSource.upsert({
    where: { subjectId_sourceId: { subjectId: subjectA.id, sourceId: sourceAOnly.id } },
    create: { subjectId: subjectA.id, sourceId: sourceAOnly.id, tags: ["content"], sortOrder: 0 },
    update: {},
  });

  const ssAShared = await prisma.subjectSource.upsert({
    where: { subjectId_sourceId: { subjectId: subjectA.id, sourceId: sharedSource.id } },
    create: { subjectId: subjectA.id, sourceId: sharedSource.id, tags: ["content"], sortOrder: 1 },
    update: {},
  });

  const ssBShared = await prisma.subjectSource.upsert({
    where: { subjectId_sourceId: { subjectId: subjectB.id, sourceId: sharedSource.id } },
    create: { subjectId: subjectB.id, sourceId: sharedSource.id, tags: ["content"], sortOrder: 0 },
    update: {},
  });

  const ssBOnly = await prisma.subjectSource.upsert({
    where: { subjectId_sourceId: { subjectId: subjectB.id, sourceId: sourceBOnly.id } },
    create: { subjectId: subjectB.id, sourceId: sourceBOnly.id, tags: ["content"], sortOrder: 1 },
    update: {},
  });

  // 5. Clean + create assertions
  for (const srcId of [sourceAOnly.id, sharedSource.id, sourceBOnly.id]) {
    await prisma.contentAssertion.deleteMany({ where: { sourceId: srcId } });
  }

  const assertionIdsA: string[] = [];

  // Course A's exclusive assertions (from poetry anthology)
  for (const a of ASSERTIONS_A) {
    const created = await prisma.contentAssertion.create({
      data: {
        sourceId: sourceAOnly.id,
        subjectSourceId: ssAOnly.id,
        ...a,
      },
    });
    assertionIdsA.push(created.id);
  }

  // Course A's assertions from shared source (scoped to A's SubjectSource)
  for (const a of ASSERTIONS_SHARED_FOR_A) {
    const created = await prisma.contentAssertion.create({
      data: {
        sourceId: sharedSource.id,
        subjectSourceId: ssAShared.id,
        ...a,
      },
    });
    assertionIdsA.push(created.id);
  }

  const assertionIdsB: string[] = [];

  // Course B's assertions from shared source (scoped to B's SubjectSource)
  for (const a of ASSERTIONS_SHARED_FOR_B) {
    const created = await prisma.contentAssertion.create({
      data: {
        sourceId: sharedSource.id,
        subjectSourceId: ssBShared.id,
        ...a,
      },
    });
    assertionIdsB.push(created.id);
  }

  // Course B's exclusive assertions (from prose reader)
  for (const a of ASSERTIONS_B) {
    const created = await prisma.contentAssertion.create({
      data: {
        sourceId: sourceBOnly.id,
        subjectSourceId: ssBOnly.id,
        ...a,
      },
    });
    assertionIdsB.push(created.id);
  }

  // 6. Two playbooks — same domain, same discipline config
  const playbookConfig = {
    subjectDiscipline: "English Language",
    teachingMode: "structured",
  };

  let playbookA = await prisma.playbook.findFirst({
    where: { domainId: domain.id, name: `${PREFIX}-poetry-course` },
  });
  if (!playbookA) {
    playbookA = await prisma.playbook.create({
      data: {
        name: `${PREFIX}-poetry-course`,
        description: "Course A: Poetry & Sonnets",
        domainId: domain.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
        config: playbookConfig,
      },
    });
  }

  let playbookB = await prisma.playbook.findFirst({
    where: { domainId: domain.id, name: `${PREFIX}-prose-course` },
  });
  if (!playbookB) {
    playbookB = await prisma.playbook.create({
      data: {
        name: `${PREFIX}-prose-course`,
        description: "Course B: Prose & Narrative",
        domainId: domain.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
        config: playbookConfig,
      },
    });
  }

  // 7. PlaybookSubject links (taxonomy)
  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId: playbookA.id, subjectId: subjectA.id } },
    create: { playbookId: playbookA.id, subjectId: subjectA.id },
    update: {},
  });

  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId: playbookB.id, subjectId: subjectB.id } },
    create: { playbookId: playbookB.id, subjectId: subjectB.id },
    update: {},
  });

  // 7b. PlaybookSource links (content scoping — Phase 6 authoritative path)
  // Course A: sourceAOnly + sharedSource
  // Course B: sharedSource + sourceBOnly
  for (const [pbId, srcId, sortOrder] of [
    [playbookA.id, sourceAOnly.id, 0],
    [playbookA.id, sharedSource.id, 1],
    [playbookB.id, sharedSource.id, 0],
    [playbookB.id, sourceBOnly.id, 1],
  ] as const) {
    await prisma.playbookSource.upsert({
      where: { playbookId_sourceId: { playbookId: pbId, sourceId: srcId } },
      create: { playbookId: pbId, sourceId: srcId, tags: ["content"], sortOrder },
      update: {},
    });
  }

  // 8. Two callers, each enrolled in one course
  const callerA = await prisma.caller.upsert({
    where: { externalId: `${PREFIX}-caller-a` },
    create: {
      externalId: `${PREFIX}-caller-a`,
      name: "Student A (Poetry)",
      phone: "+1-555-ISO-001",
      domainId: domain.id,
    },
    update: { domainId: domain.id },
  });

  const callerB = await prisma.caller.upsert({
    where: { externalId: `${PREFIX}-caller-b` },
    create: {
      externalId: `${PREFIX}-caller-b`,
      name: "Student B (Prose)",
      phone: "+1-555-ISO-002",
      domainId: domain.id,
    },
    update: { domainId: domain.id },
  });

  // Enroll each caller in their respective course
  await prisma.callerPlaybook.upsert({
    where: { callerId_playbookId: { callerId: callerA.id, playbookId: playbookA.id } },
    create: { callerId: callerA.id, playbookId: playbookA.id, status: "ACTIVE", enrolledBy: PREFIX, isDefault: true },
    update: { status: "ACTIVE" },
  });

  await prisma.callerPlaybook.upsert({
    where: { callerId_playbookId: { callerId: callerB.id, playbookId: playbookB.id } },
    create: { callerId: callerB.id, playbookId: playbookB.id, status: "ACTIVE", enrolledBy: PREFIX, isDefault: true },
    update: { status: "ACTIVE" },
  });

  return {
    domainId: domain.id,
    subjectAId: subjectA.id,
    playbookAId: playbookA.id,
    callerAId: callerA.id,
    sourceAOnlyId: sourceAOnly.id,
    sharedSourceId: sharedSource.id,
    assertionIdsA,
    subjectBId: subjectB.id,
    playbookBId: playbookB.id,
    callerBId: callerB.id,
    sourceBOnlyId: sourceBOnly.id,
    assertionIdsB,
  };
}

async function cleanupIsolationFixtures(): Promise<void> {
  // Reverse order of creation
  await prisma.callerPlaybook.deleteMany({
    where: { caller: { externalId: { startsWith: PREFIX } } },
  });
  await prisma.caller.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.contentAssertion.deleteMany({
    where: { source: { slug: { startsWith: PREFIX } } },
  });
  await prisma.playbookSubject.deleteMany({
    where: { playbook: { name: { startsWith: PREFIX } } },
  });
  await prisma.playbook.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.subjectSource.deleteMany({
    where: { subject: { slug: { startsWith: PREFIX } } },
  });
  await prisma.subjectDomain.deleteMany({
    where: { subject: { slug: { startsWith: PREFIX } } },
  });
  await prisma.contentSource.deleteMany({
    where: { slug: { startsWith: PREFIX } },
  });
  await prisma.subject.deleteMany({
    where: { slug: { startsWith: PREFIX } },
  });
  await prisma.domain.deleteMany({
    where: { slug: { startsWith: PREFIX } },
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Content Isolation: two courses, same discipline, shared docs", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    await cleanupIsolationFixtures();
    fx = await seedIsolationFixtures();
  }, 30_000);

  afterAll(async () => {
    await cleanupIsolationFixtures();
    await prisma.$disconnect();
  });

  // ── Source Resolution ──────────────────────────────────────────

  it("Course A resolves ONLY its sources (src1 + shared)", async () => {
    const sourceIds = await getSourceIdsForPlaybook(fx.playbookAId);
    expect(sourceIds).toContain(fx.sourceAOnlyId);
    expect(sourceIds).toContain(fx.sharedSourceId);
    expect(sourceIds).not.toContain(fx.sourceBOnlyId);
    expect(sourceIds).toHaveLength(2);
  });

  it("Course B resolves ONLY its sources (shared + src3)", async () => {
    const sourceIds = await getSourceIdsForPlaybook(fx.playbookBId);
    expect(sourceIds).toContain(fx.sharedSourceId);
    expect(sourceIds).toContain(fx.sourceBOnlyId);
    expect(sourceIds).not.toContain(fx.sourceAOnlyId);
    expect(sourceIds).toHaveLength(2);
  });

  // ── Subject Scope ──────────────────────────────────────────────

  it("Course A's subject scope includes only subjectA", async () => {
    const result = await getSubjectsForPlaybook(fx.playbookAId, fx.domainId);
    const subjectIds = result.subjects.map((s) => s.id);
    expect(subjectIds).toContain(fx.subjectAId);
    expect(subjectIds).not.toContain(fx.subjectBId);
    expect(result.scoped).toBe(true);
  });

  it("Course B's subject scope includes only subjectB", async () => {
    const result = await getSubjectsForPlaybook(fx.playbookBId, fx.domainId);
    const subjectIds = result.subjects.map((s) => s.id);
    expect(subjectIds).toContain(fx.subjectBId);
    expect(subjectIds).not.toContain(fx.subjectAId);
    expect(result.scoped).toBe(true);
  });

  // ── Assertion Isolation ────────────────────────────────────────

  it("Course A's assertions do NOT include Course B's assertions", async () => {
    const result = await getSubjectsForPlaybook(fx.playbookAId, fx.domainId);
    const subjectSourceIds = result.subjects.flatMap((s) =>
      s.sources.map((src) => src.subjectSourceId)
    );

    // Fetch assertions scoped to Course A's SubjectSources
    const assertions = await prisma.contentAssertion.findMany({
      where: {
        subjectSourceId: { in: subjectSourceIds },
      },
      select: { id: true, assertion: true },
    });

    const ids = assertions.map((a) => a.id);

    // All of Course A's assertions should be present
    for (const id of fx.assertionIdsA) {
      expect(ids).toContain(id);
    }
    // None of Course B's assertions should be present
    for (const id of fx.assertionIdsB) {
      expect(ids).not.toContain(id);
    }
  });

  it("Course B's assertions do NOT include Course A's assertions", async () => {
    const result = await getSubjectsForPlaybook(fx.playbookBId, fx.domainId);
    const subjectSourceIds = result.subjects.flatMap((s) =>
      s.sources.map((src) => src.subjectSourceId)
    );

    const assertions = await prisma.contentAssertion.findMany({
      where: {
        subjectSourceId: { in: subjectSourceIds },
      },
      select: { id: true, assertion: true },
    });

    const ids = assertions.map((a) => a.id);

    for (const id of fx.assertionIdsB) {
      expect(ids).toContain(id);
    }
    for (const id of fx.assertionIdsA) {
      expect(ids).not.toContain(id);
    }
  });

  // ── Shared Source Isolation ────────────────────────────────────

  it("shared source has DIFFERENT assertions per course (same doc, different scoping)", async () => {
    // Course A's view of the shared source
    const resultA = await getSubjectsForPlaybook(fx.playbookAId, fx.domainId);
    const ssIdsA = resultA.subjects.flatMap((s) =>
      s.sources
        .filter((src) => src.sourceId === fx.sharedSourceId)
        .map((src) => src.subjectSourceId)
    );
    const assertionsA = await prisma.contentAssertion.findMany({
      where: { sourceId: fx.sharedSourceId, subjectSourceId: { in: ssIdsA } },
      select: { assertion: true },
    });

    // Course B's view of the shared source
    const resultB = await getSubjectsForPlaybook(fx.playbookBId, fx.domainId);
    const ssIdsB = resultB.subjects.flatMap((s) =>
      s.sources
        .filter((src) => src.sourceId === fx.sharedSourceId)
        .map((src) => src.subjectSourceId)
    );
    const assertionsB = await prisma.contentAssertion.findMany({
      where: { sourceId: fx.sharedSourceId, subjectSourceId: { in: ssIdsB } },
      select: { assertion: true },
    });

    // They should have different assertions even for the same underlying document
    const textsA = assertionsA.map((a) => a.assertion).sort();
    const textsB = assertionsB.map((a) => a.assertion).sort();

    expect(textsA).not.toEqual(textsB);
    expect(textsA.length).toBeGreaterThan(0);
    expect(textsB.length).toBeGreaterThan(0);

    // Verify specific content
    expect(textsA.some((t) => t.includes("Pathetic fallacy uses weather"))).toBe(true);
    expect(textsB.some((t) => t.includes("Brontë's Wuthering Heights"))).toBe(true);
  });

  // ── Cross-enrollment protection ────────────────────────────────

  it("enrolling in Course A does NOT grant access to Course B content", async () => {
    // Caller A is enrolled in Course A only
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId: fx.callerAId, status: "ACTIVE" },
      select: { playbookId: true },
    });

    expect(enrollment).toBeTruthy();
    expect(enrollment!.playbookId).toBe(fx.playbookAId);

    // Source resolution for this playbook should not include B's exclusive source
    const sourceIds = await getSourceIdsForPlaybook(enrollment!.playbookId);
    expect(sourceIds).not.toContain(fx.sourceBOnlyId);
  });
});
