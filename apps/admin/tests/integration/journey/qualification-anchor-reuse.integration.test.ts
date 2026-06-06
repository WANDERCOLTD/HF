/**
 * #1081 Slice 2B.2 — qualificationAnchor sibling-reuse — integration test.
 *
 * Pins the new anchor-aware link behaviour against a live DB:
 *
 *   - When a Curriculum with `qualificationAnchor = X` exists in a domain
 *     and a NEW course is created with a Subject whose qualification metadata
 *     derives to the SAME anchor `X` in the SAME domain, the system MUST
 *     link the new Playbook to the existing Curriculum via
 *     PlaybookCurriculum(role: "linked") rather than mint a fresh Curriculum.
 *
 *   - When two Curricula both carry the same `qualificationAnchor` in the
 *     same domain (data-integrity violation), the helper MUST throw
 *     QualificationAnchorAmbiguity — runtime refuses to guess.
 *
 * Tests are DB-only (no server). Each test owns rows under a unique prefix
 * so concurrent runs don't collide.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  findCurriculumByAnchor,
  QualificationAnchorAmbiguity,
} from "@/lib/curriculum/find-sibling-curricula";

const prisma = new PrismaClient();

const PFX = "1081-2b2-anchor-reuse";
const DOMAIN_SLUG = `${PFX}-domain`;
const PARENT_PB_NAME = `${PFX}-parent-playbook`;
const PARENT_CURR_SLUG = `${PFX}-parent-curriculum`;
const SUBJECT_SLUG = `${PFX}-subject`;
const TEST_ANCHOR = `${PFX}-anchor-v1`;

let domainId: string;
let parentPlaybookId: string;
let parentCurriculumId: string;

beforeAll(async () => {
  const domain = await prisma.domain.upsert({
    where: { slug: DOMAIN_SLUG },
    update: {},
    create: {
      slug: DOMAIN_SLUG,
      name: `${PFX} domain`,
      kind: "INSTITUTION",
    },
    select: { id: true },
  });
  domainId = domain.id;

  await prisma.subject.upsert({
    where: { slug: SUBJECT_SLUG },
    update: {},
    create: {
      slug: SUBJECT_SLUG,
      name: `${PFX} subject`,
    },
    select: { id: true },
  });

  // Parent playbook + curriculum carrying the anchor.
  const parent = await prisma.playbook.create({
    data: {
      name: PARENT_PB_NAME,
      domainId,
      status: "DRAFT",
    },
    select: { id: true },
  });
  parentPlaybookId = parent.id;

  // #1177 Slice 6 — Curriculum.playbookId dropped; ownership via PlaybookCurriculum below.
  const parentCurr = await prisma.curriculum.create({
    data: {
      slug: PARENT_CURR_SLUG,
      name: `${PFX} parent curriculum`,
      qualificationAnchor: TEST_ANCHOR,
    },
    select: { id: true },
  });
  parentCurriculumId = parentCurr.id;

  await prisma.playbookCurriculum.create({
    data: {
      playbookId: parentPlaybookId,
      curriculumId: parentCurriculumId,
      role: "primary",
    },
  });
});

afterAll(async () => {
  // Tear down — order matters for FKs. Capture rows by prefix so a
  // partially-completed test still leaves the DB clean.
  const curricula = await prisma.curriculum.findMany({
    where: { OR: [{ slug: { startsWith: PFX } }, { qualificationAnchor: TEST_ANCHOR }] },
    select: { id: true },
  });
  const playbooks = await prisma.playbook.findMany({
    where: { name: { startsWith: PFX } },
    select: { id: true },
  });
  const curIds = curricula.map((c) => c.id);
  const pbIds = playbooks.map((p) => p.id);

  await prisma.playbookCurriculum.deleteMany({
    where: { OR: [{ playbookId: { in: pbIds } }, { curriculumId: { in: curIds } }] },
  });
  await prisma.curriculum.deleteMany({ where: { id: { in: curIds } } });
  await prisma.playbook.deleteMany({ where: { id: { in: pbIds } } });
  await prisma.subject.deleteMany({ where: { slug: { startsWith: PFX } } });
  await prisma.domain.deleteMany({ where: { slug: { startsWith: PFX } } });

  await prisma.$disconnect();
});

describe("findCurriculumByAnchor — sibling reuse", () => {
  it("returns the parent's Curriculum when looking up the seeded anchor in the seeded domain", async () => {
    const sibling = await findCurriculumByAnchor(TEST_ANCHOR, domainId);
    expect(sibling).not.toBeNull();
    expect(sibling!.id).toBe(parentCurriculumId);
    expect(sibling!.qualificationAnchor).toBe(TEST_ANCHOR);
  });

  it("returns null when the anchor does not match anything in the domain", async () => {
    const result = await findCurriculumByAnchor(
      `${PFX}-bogus-anchor`,
      domainId,
    );
    expect(result).toBeNull();
  });

  it("returns null when the anchor exists but in a different domain", async () => {
    // Create a second domain with no matching Curriculum.
    const otherDomain = await prisma.domain.create({
      data: {
        slug: `${PFX}-other-domain`,
        name: `${PFX} other domain`,
        kind: "INSTITUTION",
      },
      select: { id: true },
    });
    try {
      const result = await findCurriculumByAnchor(TEST_ANCHOR, otherDomain.id);
      expect(result).toBeNull();
    } finally {
      await prisma.domain.delete({ where: { id: otherDomain.id } });
    }
  });
});

describe("findCurriculumByAnchor — ambiguity (data-integrity guard)", () => {
  it("throws QualificationAnchorAmbiguity when 2 Curricula share the anchor in the domain", async () => {
    // Seed a SECOND playbook + curriculum with the SAME anchor in the same
    // domain. This is the data-integrity violation the runtime must refuse
    // to guess on (CI guard from Slice 2B.3 will prevent this at build time).
    const dupePb = await prisma.playbook.create({
      data: {
        name: `${PFX}-dupe-playbook`,
        domainId,
        status: "DRAFT",
      },
      select: { id: true },
    });
    // #1177 Slice 6 — Curriculum.playbookId dropped; ownership via PlaybookCurriculum below.
    const dupeCurr = await prisma.curriculum.create({
      data: {
        slug: `${PFX}-dupe-curriculum`,
        name: `${PFX} dupe curriculum`,
        qualificationAnchor: TEST_ANCHOR,
      },
      select: { id: true },
    });
    await prisma.playbookCurriculum.create({
      data: { playbookId: dupePb.id, curriculumId: dupeCurr.id, role: "primary" },
    });

    try {
      await expect(
        findCurriculumByAnchor(TEST_ANCHOR, domainId),
      ).rejects.toThrow(QualificationAnchorAmbiguity);

      // Confirm the error carries the matched IDs for operator triage.
      try {
        await findCurriculumByAnchor(TEST_ANCHOR, domainId);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(QualificationAnchorAmbiguity);
        const e = err as QualificationAnchorAmbiguity;
        expect(e.matchedCurriculumIds.sort()).toEqual(
          [parentCurriculumId, dupeCurr.id].sort(),
        );
        expect(e.domainId).toBe(domainId);
        expect(e.anchor).toBe(TEST_ANCHOR);
      }
    } finally {
      // Clean up the duplicate inside the test (afterAll will also sweep).
      await prisma.playbookCurriculum.deleteMany({
        where: { curriculumId: dupeCurr.id },
      });
      await prisma.curriculum.delete({ where: { id: dupeCurr.id } });
      await prisma.playbook.delete({ where: { id: dupePb.id } });
    }
  });
});
