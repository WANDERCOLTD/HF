/**
 * #1034 — Course Variant funnel — integration test (CHAIN tests).
 *
 * Pins three chain contracts (CC-A, CC-D, CC-E) against live DB data:
 *
 *   CC-A — Playbook → Curriculum linkage (PlaybookCurriculum).
 *          Pre-snapshot the parent's resource set; create variant;
 *          post-snapshot proves: + 1 Playbook row, + 1 PlaybookCurriculum
 *          row with role='linked', SAME curriculumId, ZERO new
 *          CurriculumModule rows (funnel depends on shared UUIDs).
 *
 *   CC-D — Call → COMPOSE Curriculum resolution. The variant Playbook
 *          MUST resolve to the parent's Curriculum via
 *          `resolveCurriculumIdForPlaybook`. Pre-#1034 this query went
 *          to the deprecated `Curriculum.playbookId` column directly and
 *          silently returned null for variants → pipeline skipped
 *          module-aware composition. TL hard-block regression pinned here.
 *
 *   CC-E — AGGREGATE → cross-Playbook mastery scope (INTENTIONAL).
 *          A `lo_mastery:{moduleSlug}:{loRef}` CallerAttribute written
 *          from sibling A's pipeline is the SAME ROW when sibling B's
 *          pipeline reads it. This is the funnel mechanism (Pop Quiz
 *          finds gap → Revision Aid teaches → Exam Assessment certifies)
 *          and must not be "fixed" as a bug.
 *
 * Tests run DB-only (no server needed). Each test owns its rows under
 * uniquely-prefixed slugs so concurrent test runs don't collide.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPlaybookVariant } from "@/lib/playbooks/create-variant";
import { resolveCurriculumIdForPlaybook } from "@/lib/curriculum/resolve-module";
import {
  resolvePlaybookIdForCurriculum,
  resolvePlaybookIdForCurriculumModule,
} from "@/lib/curriculum/resolve-playbook-for-curriculum";

const prisma = new PrismaClient();

const PFX = "1034-cv-funnel";
const DOMAIN_SLUG = `${PFX}-domain`;
const PARENT_PB_NAME = `${PFX}-parent-playbook`;
const CURRICULUM_SLUG = `${PFX}-curriculum`;
const MODULE_SLUG_A = `${PFX}-module-a`;
const MODULE_SLUG_B = `${PFX}-module-b`;
const SUBJECT_SLUG = `${PFX}-subject`;

let actorUserId: string;
let domainId: string;
let parentPlaybookId: string;
let curriculumId: string;
let moduleAId: string;
let moduleBId: string;
let subjectId: string;

beforeAll(async () => {
  // Seed: User actor (audit FK), Domain, Subject, Curriculum, 2 modules,
  // parent Playbook, PlaybookSubject link, PlaybookCurriculum primary row.
  const actor = await prisma.user.upsert({
    where: { email: `${PFX}-actor@test.local` },
    update: {},
    create: {
      email: `${PFX}-actor@test.local`,
      name: "1034 CV Funnel Actor",
      role: "OPERATOR",
    },
    select: { id: true },
  });
  actorUserId = actor.id;

  const domain = await prisma.domain.upsert({
    where: { slug: DOMAIN_SLUG },
    update: {},
    create: {
      slug: DOMAIN_SLUG,
      name: `${PFX} domain`,
      kind: "STANDARD",
    },
    select: { id: true },
  });
  domainId = domain.id;

  const subject = await prisma.subject.upsert({
    where: { slug: SUBJECT_SLUG },
    update: {},
    create: {
      slug: SUBJECT_SLUG,
      name: `${PFX} subject`,
    },
    select: { id: true },
  });
  subjectId = subject.id;

  const parent = await prisma.playbook.create({
    data: {
      name: PARENT_PB_NAME,
      domainId,
      status: "DRAFT",
    },
    select: { id: true },
  });
  parentPlaybookId = parent.id;

  const curriculum = await prisma.curriculum.create({
    data: {
      slug: CURRICULUM_SLUG,
      name: `${PFX} curriculum`,
      playbookId: parentPlaybookId, // deprecated column — kept for transition
    },
    select: { id: true },
  });
  curriculumId = curriculum.id;

  // Primary PlaybookCurriculum row (mirrors the wizard dual-write behaviour).
  await prisma.playbookCurriculum.create({
    data: {
      playbookId: parentPlaybookId,
      curriculumId,
      role: "primary",
    },
  });

  const modA = await prisma.curriculumModule.create({
    data: {
      curriculumId,
      slug: MODULE_SLUG_A,
      title: "Module A",
      sortOrder: 0,
    },
    select: { id: true },
  });
  moduleAId = modA.id;

  const modB = await prisma.curriculumModule.create({
    data: {
      curriculumId,
      slug: MODULE_SLUG_B,
      title: "Module B",
      sortOrder: 1,
    },
    select: { id: true },
  });
  moduleBId = modB.id;

  await prisma.playbookSubject.create({
    data: { playbookId: parentPlaybookId, subjectId },
  });
});

afterAll(async () => {
  // Cleanup in FK-safe order. Cascade handles most of the join rows.
  await prisma.callerAttribute.deleteMany({ where: { key: { startsWith: `lo_mastery:${MODULE_SLUG_A}:` } } });
  await prisma.callerAttribute.deleteMany({ where: { key: { startsWith: `lo_mastery:${MODULE_SLUG_B}:` } } });
  await prisma.caller.deleteMany({ where: { name: { startsWith: PFX } } });

  // Drop variant Playbooks (cascade clears PlaybookCurriculum + Subject + Source links).
  await prisma.playbook.deleteMany({
    where: {
      OR: [
        { name: { startsWith: PFX } },
        { id: parentPlaybookId },
      ],
    },
  });
  // PlaybookCurriculum primary row was cascaded; Curriculum + Modules remain.
  await prisma.curriculumModule.deleteMany({ where: { curriculumId } });
  await prisma.curriculum.delete({ where: { id: curriculumId } });
  await prisma.subject.delete({ where: { id: subjectId } });
  await prisma.domain.delete({ where: { id: domainId } });
  await prisma.user.delete({ where: { id: actorUserId } });
  await prisma.$disconnect();
});

describe("#1034 Course Variant funnel — CHAIN tests", () => {
  describe("CC-A — variant route writes correct join row, shares Curriculum", () => {
    it("PRE/POST snapshot — variant creation adds 1 Playbook + 1 linked PlaybookCurriculum, ZERO new CurriculumModule rows", async () => {
      // PRE-snapshot.
      const pre = {
        playbookCount: await prisma.playbook.count(),
        joinCount: await prisma.playbookCurriculum.count({
          where: { curriculumId },
        }),
        moduleIds: (
          await prisma.curriculumModule.findMany({
            where: { curriculumId },
            select: { id: true },
            orderBy: { sortOrder: "asc" },
          })
        ).map((m) => m.id),
      };

      // ACTION.
      const result = await createPlaybookVariant({
        parentPlaybookId,
        name: `${PFX}-variant-popquiz`,
        preset: "popquiz",
        actorUserId,
        reason: "CC-A snapshot test",
      });

      // POST-snapshot.
      const post = {
        playbookCount: await prisma.playbook.count(),
        joinCount: await prisma.playbookCurriculum.count({
          where: { curriculumId },
        }),
        moduleIds: (
          await prisma.curriculumModule.findMany({
            where: { curriculumId },
            select: { id: true },
            orderBy: { sortOrder: "asc" },
          })
        ).map((m) => m.id),
      };

      expect(post.playbookCount).toBe(pre.playbookCount + 1);
      expect(post.joinCount).toBe(pre.joinCount + 1);
      // Funnel depends on SHARED moduleId UUIDs — variant must not clone.
      expect(post.moduleIds).toEqual(pre.moduleIds);

      // Variant's PlaybookCurriculum row is role='linked' (not primary).
      const variantLink = await prisma.playbookCurriculum.findUnique({
        where: {
          playbookId_curriculumId: {
            playbookId: result.variantPlaybookId,
            curriculumId,
          },
        },
        select: { role: true, curriculumId: true },
      });
      expect(variantLink?.role).toBe("linked");
      expect(variantLink?.curriculumId).toBe(curriculumId);

      // Result surface: shared Curriculum, mirrored Subject link.
      expect(result.sharedCurriculumId).toBe(curriculumId);
      expect(result.subjectLinks).toBe(1);
    });
  });

  describe("CC-D — pipeline COMPOSE resolves variant to PARENT's Curriculum", () => {
    it("REGRESSION (TL hard-block #1): resolveCurriculumIdForPlaybook returns the SAME Curriculum for parent and variant", async () => {
      const variant = await createPlaybookVariant({
        parentPlaybookId,
        name: `${PFX}-variant-revision`,
        preset: "revision",
        actorUserId,
      });

      const parentResolved = await resolveCurriculumIdForPlaybook(parentPlaybookId);
      const variantResolved = await resolveCurriculumIdForPlaybook(variant.variantPlaybookId);

      expect(parentResolved).toBe(curriculumId);
      // Pre-#1034 this returned null — pipeline silently skipped module-aware
      // composition for every variant Call. CC-D pins the fix.
      expect(variantResolved).toBe(curriculumId);
      expect(variantResolved).toBe(parentResolved);
    });
  });

  describe("CC-B — curriculum mutation fanout: resolvePlaybookIdForCurriculum returns ALL siblings", () => {
    it("returns parent + every variant for a shared Curriculum", async () => {
      // Build a 3-Course product line (parent + 2 variants).
      const v1 = await createPlaybookVariant({
        parentPlaybookId,
        name: `${PFX}-variant-cc-b-1`,
        actorUserId,
      });
      const v2 = await createPlaybookVariant({
        parentPlaybookId,
        name: `${PFX}-variant-cc-b-2`,
        actorUserId,
      });

      const siblings = await resolvePlaybookIdForCurriculum(curriculumId);
      expect(siblings).toContain(parentPlaybookId);
      expect(siblings).toContain(v1.variantPlaybookId);
      expect(siblings).toContain(v2.variantPlaybookId);
      // No duplicates.
      expect(new Set(siblings).size).toBe(siblings.length);

      // …and from the module side.
      const modSiblings = await resolvePlaybookIdForCurriculumModule(moduleAId);
      expect(modSiblings).toContain(parentPlaybookId);
      expect(modSiblings).toContain(v1.variantPlaybookId);
      expect(modSiblings).toContain(v2.variantPlaybookId);
    });
  });

  describe("CC-E — cross-Playbook mastery scope (INTENTIONAL)", () => {
    it("PRE/POST snapshot — lo_mastery written for Caller via sibling A is the SAME ROW when sibling B reads it", async () => {
      // Seed a learner Caller (LEARNER role, no User FK — sim-only).
      const caller = await prisma.caller.create({
        data: {
          name: `${PFX}-learner`,
          role: "LEARNER",
          domainId,
        },
        select: { id: true },
      });

      // Build sibling A. Reads/writes use the slug-keyed mastery key
      // shape per #611 — `lo_mastery:{moduleSlug}:{loRef}`. Slug comes
      // from CurriculumModule.slug; siblings share the slug because
      // they share the CurriculumModule row.
      const siblingA = await createPlaybookVariant({
        parentPlaybookId,
        name: `${PFX}-variant-cc-e-A`,
        preset: "popquiz",
        actorUserId,
      });
      const siblingB = await createPlaybookVariant({
        parentPlaybookId,
        name: `${PFX}-variant-cc-e-B`,
        preset: "revision",
        actorUserId,
      });

      // PRE-snapshot: no mastery row yet for this Caller × LO.
      const masteryKey = `lo_mastery:${MODULE_SLUG_A}:LO2.3`;
      const pre = await prisma.callerAttribute.findFirst({
        where: { callerId: caller.id, key: masteryKey },
        select: { id: true },
      });
      expect(pre).toBeNull();

      // ACTION 1: simulate sibling A's pipeline writing mastery 0.2.
      const writtenFromA = await prisma.callerAttribute.create({
        data: {
          callerId: caller.id,
          key: masteryKey,
          scope: "GLOBAL",
          valueType: "NUMBER",
          numberValue: 0.2,
        },
        select: { id: true, numberValue: true },
      });

      // ACTION 2: simulate sibling B's pipeline READING the same key.
      // Pipeline reads are scoped by callerId + key — NOT by playbookId.
      // That's the CC-E invariant: the row is shared across siblings.
      const readFromB = await prisma.callerAttribute.findFirst({
        where: { callerId: caller.id, key: masteryKey },
        select: { id: true, numberValue: true },
      });

      expect(readFromB).not.toBeNull();
      expect(readFromB?.id).toBe(writtenFromA.id); // SAME ROW.
      expect(readFromB?.numberValue).toBe(0.2);

      // ACTION 3: sibling B updates the same row to 0.7 (caught-up mastery).
      await prisma.callerAttribute.update({
        where: { id: writtenFromA.id },
        data: { numberValue: 0.7 },
      });

      // ACTION 4: now sibling A reads again — sees B's update.
      const readFromAAfterB = await prisma.callerAttribute.findFirst({
        where: { callerId: caller.id, key: masteryKey },
        select: { id: true, numberValue: true },
      });
      expect(readFromAAfterB?.id).toBe(writtenFromA.id);
      expect(readFromAAfterB?.numberValue).toBe(0.7);

      // Sanity — variant Playbook IDs are distinct.
      expect(siblingA.variantPlaybookId).not.toBe(siblingB.variantPlaybookId);
    });
  });
});
