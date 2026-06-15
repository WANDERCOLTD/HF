/**
 * Mastery write→read round-trip — INTEGRATION (real DB).
 *
 * Sibling to:
 *   - tests/lib/mastery-roundtrip.test.ts (unit, mocked Prisma) — pins the
 *     reader's column + key-shape contract.
 *   - tests/integration/journey/exam-assessment-isolation.integration.test.ts
 *     — pins the useFreshMastery branch (scratchMastery isolation).
 *
 * This file pins the LONG-TERM CallerAttribute branch end-to-end through
 * the real schema:
 *
 *   1. AGGREGATE writes via `updateCurriculumProgress` land in
 *      `CallerAttribute` at the canonical key shape
 *      `curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}`.
 *   2. The reader `deriveLearnGoalProgressFromRef` returns the written
 *      value — same column, same key shape, no divergence.
 *   3. A subsequent write monotonically updates the same row (no
 *      duplicate keys, no column drift).
 *
 * If a future refactor changes the writer's column or the reader's
 * `endsWith` filter shape, this bank fails before reaching hf_sandbox —
 * exactly the divergence pattern that produced the #1554 / #1561 / #1573
 * / #1552 fix chain on 2026-06-13.
 *
 * DB-only (no server). Each test owns its rows under uniquely-prefixed slugs.
 *
 * Run via:
 *   cd apps/admin && npm run test:integration -- tests/integration/journey/mastery-write-read-roundtrip
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { updateCurriculumProgress } from "@/lib/curriculum/track-progress";
import { deriveLearnGoalProgressFromRef } from "@/lib/goals/track-progress";
import { invalidatePlaybookMasteryConfigCache } from "@/lib/curriculum/playbook-mastery-config";

const prisma = new PrismaClient();

const PFX = "1599-mastery-roundtrip";
const DOMAIN_SLUG = `${PFX}-domain`;
const SUBJECT_SLUG = `${PFX}-subject`;
const CURRICULUM_SLUG = `${PFX}-curriculum`;
const MODULE_SLUG = `${PFX}-mod`;
const LO_REF = "LO-A";

let domainId: string;
let subjectId: string;
let curriculumId: string;
let moduleId: string;
let playbookId: string;
let callerId: string;
let firstCallId: string;
let secondCallId: string;

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

  // No useFreshMastery — exercises the long-term CallerAttribute path.
  const pb = await prisma.playbook.create({
    data: {
      name: `${PFX} playbook`,
      domainId,
      status: "DRAFT",
      config: {},
    },
    select: { id: true },
  });
  playbookId = pb.id;

  const curriculum = await prisma.curriculum.create({
    data: { slug: CURRICULUM_SLUG, name: `${PFX} curriculum` },
    select: { id: true },
  });
  curriculumId = curriculum.id;

  await prisma.playbookCurriculum.create({
    data: { playbookId, curriculumId, role: "primary" },
  });

  const moduleRow = await prisma.curriculumModule.create({
    data: {
      curriculumId,
      slug: MODULE_SLUG,
      title: "Module Under Test",
      sortOrder: 0,
    },
    select: { id: true },
  });
  moduleId = moduleRow.id;

  // The reader (`deriveLearnGoalProgressFromRef`) resolves `ref → moduleSlug`
  // via a LearningObjective lookup, then queries CallerAttribute by
  // `:lo_mastery:{moduleSlug}:{loRef}` suffix. Must exist for the read leg.
  await prisma.learningObjective.create({
    data: {
      moduleId,
      ref: LO_REF,
      description: "Test LO under integration roundtrip",
    },
  });

  await prisma.playbookSubject.create({ data: { playbookId, subjectId } });

  const caller = await prisma.caller.create({
    data: { name: `${PFX} caller`, domainId },
    select: { id: true },
  });
  callerId = caller.id;

  const firstCall = await prisma.call.create({
    data: {
      source: "test",
      transcript: "(call 1 transcript)",
      callerId,
      playbookId,
    },
    select: { id: true },
  });
  firstCallId = firstCall.id;

  const secondCall = await prisma.call.create({
    data: {
      source: "test",
      transcript: "(call 2 transcript)",
      callerId,
      playbookId,
    },
    select: { id: true },
  });
  secondCallId = secondCall.id;

  invalidatePlaybookMasteryConfigCache(playbookId);
});

afterAll(async () => {
  try {
    if (callerId) {
      await prisma.callerAttribute.deleteMany({ where: { callerId } });
      await prisma.callerModuleProgress.deleteMany({ where: { callerId } });
    }
    if (firstCallId) {
      await prisma.call.delete({ where: { id: firstCallId } }).catch(() => {});
    }
    if (secondCallId) {
      await prisma.call.delete({ where: { id: secondCallId } }).catch(() => {});
    }
    if (callerId) {
      await prisma.caller.delete({ where: { id: callerId } }).catch(() => {});
    }
    if (curriculumId) {
      await prisma.learningObjective.deleteMany({ where: { module: { curriculumId } } });
      await prisma.curriculumModule.deleteMany({ where: { curriculumId } });
      await prisma.playbookCurriculum.deleteMany({ where: { curriculumId } });
      await prisma.curriculum.delete({ where: { id: curriculumId } }).catch(() => {});
    }
    if (playbookId) {
      await prisma.playbookSubject.deleteMany({ where: { playbookId } });
      await prisma.playbook.delete({ where: { id: playbookId } }).catch(() => {});
    }
    if (subjectId) {
      await prisma.subject.delete({ where: { id: subjectId } }).catch(() => {});
    }
    if (domainId) {
      await prisma.domain.delete({ where: { id: domainId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe("#1599 — mastery write→read round-trip (long-term CallerAttribute path)", () => {
  it("write lands at the canonical key shape AND reader returns the exact value", async () => {
    // Call 1 writes lo_mastery = 0.4 for LO_REF.
    await updateCurriculumProgress(callerId, CURRICULUM_SLUG, {
      loMastery: { moduleId: MODULE_SLUG, outcomes: { [LO_REF]: 0.4 } },
      curriculumId,
      playbookId,
      callId: firstCallId,
      lastAccessedAt: new Date(),
    });

    // Direct DB probe — canonical key shape per #1599 contract.
    const expectedKey = `curriculum:${CURRICULUM_SLUG}:lo_mastery:${MODULE_SLUG}:${LO_REF}`;
    const row = await prisma.callerAttribute.findUnique({
      where: {
        callerId_key_scope: { callerId, key: expectedKey, scope: "CURRICULUM" },
      },
      select: { numberValue: true, valueType: true },
    });
    expect(row).not.toBeNull();
    expect(row?.valueType).toBe("NUMBER");
    expect(row?.numberValue).toBeCloseTo(0.4, 5);

    // Reader path — must return what we wrote. If the reader queries a
    // different column or a different key shape, this is the line that
    // catches the #1561 divergence fingerprint at integration grain.
    const readBack = await deriveLearnGoalProgressFromRef(callerId, {
      ref: LO_REF,
      playbookId,
    });
    expect(readBack).not.toBeNull();
    expect(readBack?.progress).toBeCloseTo(0.4, 5);
    expect(readBack?.touchedModules).toBe(1);
    expect(readBack?.totalModulesWithRef).toBe(1);
  });

  it("second call updates the same canonical row — no duplicate key, no column drift", async () => {
    // Call 2 writes lo_mastery = 0.8 for the same LO. The #1081 discipline
    // is max(existing, new) — 0.8 should win over the prior 0.4.
    await updateCurriculumProgress(callerId, CURRICULUM_SLUG, {
      loMastery: { moduleId: MODULE_SLUG, outcomes: { [LO_REF]: 0.8 } },
      curriculumId,
      playbookId,
      callId: secondCallId,
      lastAccessedAt: new Date(),
    });

    const expectedKey = `curriculum:${CURRICULUM_SLUG}:lo_mastery:${MODULE_SLUG}:${LO_REF}`;
    // There must still be exactly one row for this (callerId, key, scope).
    const allRows = await prisma.callerAttribute.findMany({
      where: { callerId, key: { contains: ":lo_mastery:" } },
      select: { key: true, numberValue: true },
    });
    expect(allRows).toHaveLength(1);
    expect(allRows[0].key).toBe(expectedKey);
    expect(allRows[0].numberValue).toBeCloseTo(0.8, 5);

    // Reader picks up the updated value — same column, same key shape.
    const readBack = await deriveLearnGoalProgressFromRef(callerId, {
      ref: LO_REF,
      playbookId,
    });
    expect(readBack?.progress).toBeCloseTo(0.8, 5);
  });
});
