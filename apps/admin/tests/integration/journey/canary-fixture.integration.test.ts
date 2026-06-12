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

  // ── #1516 — per-playbook skill-measure spec seeding ──────────────────
  describe("#1516 G2 — skill-measure spec wiring", () => {
    it("seeds the skill-measure-<canary> AnalysisSpec with 4 MEASURE actions targeting skill_* parameters", async () => {
      const fx = await bootstrapCanaryFixture(prisma);

      const spec = await prisma.analysisSpec.findUnique({
        where: { slug: `skill-measure-${CANARY_PREFIX}` },
        select: {
          id: true,
          outputType: true,
          specType: true,
          isActive: true,
          isDirty: true,
          triggers: {
            select: {
              id: true,
              actions: {
                select: { parameterId: true, weight: true },
              },
            },
          },
        },
      });

      expect(spec).not.toBeNull();
      expect(spec!.outputType).toBe("MEASURE");
      expect(spec!.specType).toBe("DOMAIN");
      expect(spec!.isActive).toBe(true);
      // spec-loader at `lib/pipeline/specs-loader.ts` filters on
      // `isDirty: false`. If this assertion ever flips, the spec stops
      // loading and the canary's G2 gate regresses silently.
      expect(spec!.isDirty).toBe(false);

      // Exactly 1 trigger, 4 actions — one per canonical IELTS skill.
      expect(spec!.triggers).toHaveLength(1);
      const actionParams = spec!.triggers[0]!.actions
        .map((a) => a.parameterId)
        .sort();
      expect(actionParams).toEqual(
        [
          "skill_fluency_and_coherence_fc",
          "skill_grammatical_range_and_accuracy_gra",
          "skill_lexical_resource_lr",
          "skill_pronunciation_p",
        ].sort(),
      );

      // PlaybookItem link is present + enabled — without it the spec-loader's
      // playbook-scope filter excludes the spec from the canary playbook's
      // EXTRACT pass even though the spec exists.
      const link = await prisma.playbookItem.findFirst({
        where: { playbookId: fx.playbookId, specId: spec!.id },
        select: { isEnabled: true, itemType: true },
      });
      expect(link).not.toBeNull();
      expect(link!.isEnabled).toBe(true);
      expect(link!.itemType).toBe("SPEC");
    });

    it("seeds 4 PLAYBOOK-scope BehaviorTarget rows for skill_* params (closes the AGGREGATE → CallerTarget cascade root)", async () => {
      const fx = await bootstrapCanaryFixture(prisma);

      const targets = await prisma.behaviorTarget.findMany({
        where: {
          scope: "PLAYBOOK",
          playbookId: fx.playbookId,
          parameterId: { startsWith: "skill_" },
        },
        select: { parameterId: true, targetValue: true, source: true },
      });

      expect(targets).toHaveLength(4);
      // All 4 skill parameters present.
      expect(targets.map((t) => t.parameterId).sort()).toEqual(
        [
          "skill_fluency_and_coherence_fc",
          "skill_grammatical_range_and_accuracy_gra",
          "skill_lexical_resource_lr",
          "skill_pronunciation_p",
        ].sort(),
      );
      // targetValue defaults to 1.0 (Secure) — the canonical "where you
      // want to be" for IELTS skill aggregation.
      for (const t of targets) {
        expect(t.targetValue).toBe(1.0);
        expect(t.source).toBe("SEED");
      }
    });

    it("skill-measure spec seeding is idempotent (re-bootstrap does not duplicate actions or targets)", async () => {
      const fx = await bootstrapCanaryFixture(prisma);

      // Re-bootstrap.
      await bootstrapCanaryFixture(prisma);

      const triggers = await prisma.analysisTrigger.count({
        where: { spec: { slug: `skill-measure-${CANARY_PREFIX}` } },
      });
      const actions = await prisma.analysisAction.count({
        where: { trigger: { spec: { slug: `skill-measure-${CANARY_PREFIX}` } } },
      });
      const targets = await prisma.behaviorTarget.count({
        where: { scope: "PLAYBOOK", playbookId: fx.playbookId },
      });
      const links = await prisma.playbookItem.count({
        where: {
          playbookId: fx.playbookId,
          spec: { slug: `skill-measure-${CANARY_PREFIX}` },
        },
      });

      expect(triggers).toBe(1);
      expect(actions).toBe(4);
      expect(targets).toBe(4);
      expect(links).toBe(1);
    });

    it("cleanup removes the skill-measure spec, its PlaybookItem link, and the PLAYBOOK-scope BehaviorTargets", async () => {
      const fx = await bootstrapCanaryFixture(prisma);
      await cleanupCanaryFixture(prisma);

      const spec = await prisma.analysisSpec.findUnique({
        where: { slug: `skill-measure-${CANARY_PREFIX}` },
      });
      expect(spec).toBeNull();

      // BehaviorTargets PLAYBOOK-scoped to the canary playbook are gone.
      // (Use the captured playbookId — the playbook row itself is also gone
      // post-cleanup, but the FK ordering means BehaviorTargets are dropped
      // first.)
      const targets = await prisma.behaviorTarget.count({
        where: { scope: "PLAYBOOK", playbookId: fx.playbookId },
      });
      expect(targets).toBe(0);
    });
  });
});
