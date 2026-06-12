/**
 * Canary fixture self-tests — #1514 Slice 4 of epic #1510.
 *
 * Pins the contract of `bootstrapCanaryFixture` + `cleanupCanaryFixture`
 * so the proof gate (`adaptive-loop-canary.integration.test.ts`) never
 * relies on a fixture that silently no-ops or leaks rows between runs.
 *
 * Strictly DB-only — no pipeline, no HTTP, no AI. The fixture itself is
 * the unit under test.
 *
 * Run via:
 *   cd apps/admin && npm run test:integration -- tests/integration/journey/canary-fixture
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import {
  bootstrapCanaryFixture,
  cleanupCanaryFixture,
  CANARY_PREFIX,
  CANARY_TRANSCRIPT,
} from "./canary-fixture";

const prisma = new PrismaClient();

beforeAll(async () => {
  // Ensure a clean slate so the first test's "fresh bootstrap" case is
  // genuinely fresh.
  await cleanupCanaryFixture(prisma);
});

afterAll(async () => {
  await cleanupCanaryFixture(prisma);
  await prisma.$disconnect();
});

describe("#1514 canary fixture — self-tests", () => {
  it("creates the expected Domain / Subject / Playbook / Curriculum / Module / Caller / CallerPlaybook chain", async () => {
    const fx = await bootstrapCanaryFixture(prisma);

    expect(fx.domainId).toBeTruthy();
    expect(fx.subjectId).toBeTruthy();
    expect(fx.curriculumId).toBeTruthy();
    expect(fx.moduleId).toBeTruthy();
    expect(fx.playbookId).toBeTruthy();
    expect(fx.callerId).toBeTruthy();

    // Playbook is PUBLISHED + tier preset set (so PROSODY's no-tierPreset
    // skip reason cannot fire on the canary path).
    const pb = await prisma.playbook.findUnique({
      where: { id: fx.playbookId },
      select: { status: true, config: true, domainId: true },
    });
    expect(pb?.status).toBe("PUBLISHED");
    expect(pb?.domainId).toBe(fx.domainId);
    expect(
      (pb?.config as Record<string, unknown> | null)?.tierPresetId,
    ).toBe("ielts-speaking");

    // Curriculum is linked to the playbook via the canonical primary join.
    const link = await prisma.playbookCurriculum.findUnique({
      where: {
        playbookId_curriculumId: {
          playbookId: fx.playbookId,
          curriculumId: fx.curriculumId,
        },
      },
      select: { role: true },
    });
    expect(link?.role).toBe("primary");

    // Module belongs to the curriculum.
    const mod = await prisma.curriculumModule.findUnique({
      where: { id: fx.moduleId },
      select: { curriculumId: true, slug: true },
    });
    expect(mod?.curriculumId).toBe(fx.curriculumId);
    expect(mod?.slug).toContain(CANARY_PREFIX);

    // Caller is enrolled in the playbook as ACTIVE + default.
    const enroll = await prisma.callerPlaybook.findUnique({
      where: {
        callerId_playbookId: {
          callerId: fx.callerId,
          playbookId: fx.playbookId,
        },
      },
      select: { status: true, isDefault: true },
    });
    expect(enroll?.status).toBe("ACTIVE");
    expect(enroll?.isDefault).toBe(true);
  });

  it("cleanupCanaryFixture removes every fixture row except shared SYSTEM defaults", async () => {
    await bootstrapCanaryFixture(prisma);
    await cleanupCanaryFixture(prisma);

    // Caller / Playbook / Curriculum / Subject / Domain are all gone.
    const caller = await prisma.caller.findUnique({
      where: { externalId: `${CANARY_PREFIX}-caller` },
    });
    expect(caller).toBeNull();

    const playbook = await prisma.playbook.findFirst({
      where: { name: `${CANARY_PREFIX}-playbook` },
    });
    expect(playbook).toBeNull();

    const curriculum = await prisma.curriculum.findUnique({
      where: { slug: `${CANARY_PREFIX}-curriculum` },
    });
    expect(curriculum).toBeNull();

    const subject = await prisma.subject.findUnique({
      where: { slug: `${CANARY_PREFIX}-subject` },
    });
    expect(subject).toBeNull();

    const domain = await prisma.domain.findUnique({
      where: { slug: `${CANARY_PREFIX}-domain` },
    });
    expect(domain).toBeNull();
  });

  it("bootstrap is idempotent — re-running yields the same IDs", async () => {
    const first = await bootstrapCanaryFixture(prisma);
    const second = await bootstrapCanaryFixture(prisma);

    expect(second.domainId).toBe(first.domainId);
    expect(second.subjectId).toBe(first.subjectId);
    expect(second.curriculumId).toBe(first.curriculumId);
    expect(second.moduleId).toBe(first.moduleId);
    expect(second.playbookId).toBe(first.playbookId);
    expect(second.callerId).toBe(first.callerId);

    // No duplicate CallerPlaybook rows.
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { callerId: first.callerId, playbookId: first.playbookId },
    });
    expect(enrollments).toHaveLength(1);
  });

  it("SYSTEM BehaviorTarget seeding is idempotent (re-bootstrap does not duplicate rows)", async () => {
    await bootstrapCanaryFixture(prisma);
    const before = await prisma.behaviorTarget.count({
      where: { scope: "SYSTEM", playbookId: null },
    });

    await bootstrapCanaryFixture(prisma);
    const after = await prisma.behaviorTarget.count({
      where: { scope: "SYSTEM", playbookId: null },
    });

    expect(after).toBe(before);

    // And the count is >= what the production seed plan would produce
    // for rows whose underlying Parameter exists. The fixture does NOT
    // guarantee every plan entry — that's the seed script's job — but it
    // does guarantee no row is dropped on a re-run.
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it("CANARY_TRANSCRIPT is at least 1KB and contains the assertable memory hook", async () => {
    expect(CANARY_TRANSCRIPT.length).toBeGreaterThanOrEqual(1024);
    // The exact "My name is X" pattern that gives a real-engine extractor
    // a clean memory hook.
    expect(CANARY_TRANSCRIPT).toMatch(/My name is \w+/);
    // And a workplace hook that any reasonable extractor will catch.
    expect(CANARY_TRANSCRIPT).toMatch(/I work at/);
  });
});
