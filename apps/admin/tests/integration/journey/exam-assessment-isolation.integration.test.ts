/**
 * #1081 Slice 1 — Exam Assessment isolation (AC11 + AC12) — integration test.
 *
 * Pins the AGGREGATE-write contract for `Playbook.config.useFreshMastery: true`:
 *
 *   AC11: mastery scoring writes for an Exam Assessment call MUST go to
 *         `Call.scratchMastery` (JSON column), NOT to
 *         `CallerAttribute.lo_mastery:*`.
 *
 *   AC12: an existing long-term `lo_mastery:*` row on the same LO MUST be
 *         left untouched by the Exam Assessment write — so a learner who
 *         walks in at Practitioner walks out at Practitioner regardless of
 *         the exam result.
 *
 * DB-only (no server). Each test owns its rows under uniquely-prefixed slugs.
 *
 * Run via:
 *   cd apps/admin && npm run test:integration -- tests/integration/journey/exam-assessment-isolation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { updateCurriculumProgress } from "@/lib/curriculum/track-progress";
import { invalidatePlaybookMasteryConfigCache } from "@/lib/curriculum/playbook-mastery-config";

const prisma = new PrismaClient();

const PFX = "1081-exam-isolation";
const DOMAIN_SLUG = `${PFX}-domain`;
const SUBJECT_SLUG = `${PFX}-subject`;
const CURRICULUM_SLUG = `${PFX}-curriculum`;
const MODULE_SLUG = `${PFX}-mod`;
const LO_REF = "lo-A";
const EXISTING_MASTERY = 0.75; // Practitioner band

let domainId: string;
let subjectId: string;
let curriculumId: string;
let playbookId: string;
let callerId: string;
let callId: string;

beforeAll(async () => {
  const domain = await prisma.domain.upsert({
    where: { slug: DOMAIN_SLUG },
    update: {},
    create: { slug: DOMAIN_SLUG, name: `${PFX} domain`, kind: "INSTITUTION" },
    select: { id: true },
  });
  domainId = domain.id;

  const subject = await prisma.subject.upsert({
    where: { slug: SUBJECT_SLUG },
    update: {},
    create: { slug: SUBJECT_SLUG, name: `${PFX} subject` },
    select: { id: true },
  });
  subjectId = subject.id;

  const pb = await prisma.playbook.create({
    data: {
      name: `${PFX} exam playbook`,
      domainId,
      status: "DRAFT",
      // Use the Slice 1 LIVE config key.
      config: { useFreshMastery: true },
    },
    select: { id: true },
  });
  playbookId = pb.id;

  // #1177 Slice 6 — Curriculum.playbookId dropped; ownership via PlaybookCurriculum below.
  const curriculum = await prisma.curriculum.create({
    data: {
      slug: CURRICULUM_SLUG,
      name: `${PFX} curriculum`,
    },
    select: { id: true },
  });
  curriculumId = curriculum.id;

  await prisma.playbookCurriculum.create({
    data: { playbookId, curriculumId, role: "primary" },
  });

  await prisma.curriculumModule.create({
    data: {
      curriculumId,
      slug: MODULE_SLUG,
      title: "Module Under Test",
      sortOrder: 0,
    },
  });

  await prisma.playbookSubject.create({ data: { playbookId, subjectId } });

  const caller = await prisma.caller.create({
    data: {
      name: `${PFX} caller`,
      domainId,
    },
    select: { id: true },
  });
  callerId = caller.id;

  const call = await prisma.call.create({
    data: {
      source: "test",
      transcript: "(test transcript)",
      callerId,
      playbookId,
    },
    select: { id: true },
  });
  callId = call.id;

  // Seed the long-term `lo_mastery:*` row at Practitioner so we can prove
  // the Exam Assessment write doesn't pollute it.
  await prisma.callerAttribute.upsert({
    where: {
      callerId_key_scope: {
        callerId,
        key: `curriculum:${CURRICULUM_SLUG}:lo_mastery:${MODULE_SLUG}:${LO_REF}`,
        scope: "CURRICULUM",
      },
    },
    create: {
      callerId,
      key: `curriculum:${CURRICULUM_SLUG}:lo_mastery:${MODULE_SLUG}:${LO_REF}`,
      scope: "CURRICULUM",
      valueType: "NUMBER",
      numberValue: EXISTING_MASTERY,
    },
    update: { numberValue: EXISTING_MASTERY },
  });

  // Clear the per-playbook config cache so the test's seed is read fresh.
  invalidatePlaybookMasteryConfigCache(playbookId);
});

afterAll(async () => {
  try {
    if (callerId) {
      await prisma.callerAttribute.deleteMany({ where: { callerId } });
      await prisma.callerModuleProgress.deleteMany({ where: { callerId } });
    }
    if (callId) await prisma.call.delete({ where: { id: callId } }).catch(() => {});
    if (callerId) await prisma.caller.delete({ where: { id: callerId } }).catch(() => {});
    if (curriculumId) {
      await prisma.curriculumModule.deleteMany({ where: { curriculumId } });
      await prisma.playbookCurriculum.deleteMany({ where: { curriculumId } });
      await prisma.curriculum.delete({ where: { id: curriculumId } }).catch(() => {});
    }
    if (playbookId) {
      await prisma.playbookSubject.deleteMany({ where: { playbookId } });
      await prisma.playbook.delete({ where: { id: playbookId } }).catch(() => {});
    }
    if (subjectId) await prisma.subject.delete({ where: { id: subjectId } }).catch(() => {});
    if (domainId) await prisma.domain.delete({ where: { id: domainId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

describe("#1081 Slice 1 — Exam Assessment isolation", () => {
  it("AC11 + AC12: useFreshMastery writes to Call.scratchMastery; long-term lo_mastery row is untouched", async () => {
    // Drive the AGGREGATE write site with a Playbook configured for
    // useFreshMastery.
    await updateCurriculumProgress(callerId, CURRICULUM_SLUG, {
      loMastery: { moduleId: MODULE_SLUG, outcomes: { [LO_REF]: 0.95 } },
      curriculumId,
      playbookId,
      callId,
      lastAccessedAt: new Date(),
    });

    // AC11 — Call.scratchMastery now contains the per-LO mastery key.
    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { scratchMastery: true },
    });
    expect(call?.scratchMastery).not.toBeNull();
    const scratch = call?.scratchMastery as Record<string, unknown>;
    const key = `curriculum:${CURRICULUM_SLUG}:lo_mastery:${MODULE_SLUG}:${LO_REF}`;
    expect(scratch[key]).toBe(0.95);

    // AC12 — long-term lo_mastery CallerAttribute is UNCHANGED at Practitioner.
    const attr = await prisma.callerAttribute.findUnique({
      where: {
        callerId_key_scope: {
          callerId,
          key,
          scope: "CURRICULUM",
        },
      },
      select: { numberValue: true },
    });
    expect(attr?.numberValue).toBe(EXISTING_MASTERY);
  });
});
