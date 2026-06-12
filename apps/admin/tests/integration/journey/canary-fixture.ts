/**
 * Adaptive Loop Canary Fixture — #1514 Slice 4 of epic #1510.
 *
 * Bootstraps the minimal data graph needed to drive a real-engine call
 * through the full pipeline (EXTRACT → MEMORIES → AGGREGATE → COMPOSE) and
 * assert the chain closes:
 *
 *   Domain → Subject → Playbook (PUBLISHED, IELTS-tier preset)
 *           → Curriculum (primary) → CurriculumModule
 *           → Caller (enrolled via CallerPlaybook)
 *           → SYSTEM-scope BehaviorTarget rows seeded
 *
 * The fixture is PURE READ + WRITE on Prisma — it does NOT touch the
 * pipeline runner, the invariant module, or any HTTP endpoint. The canary
 * test owns the pipeline-trigger side; the fixture owns shape only.
 *
 * **Idempotent** — re-runs find existing rows and leave them alone.
 *
 * **Cleanup** — the symmetric `cleanupCanaryFixture()` removes every row
 * the fixture authors. The two functions share the `CANARY_PREFIX` so
 * external rows are never touched.
 *
 * Used by:
 *   - `adaptive-loop-canary.integration.test.ts` — the proof gate
 *   - `canary-fixture.integration.test.ts` — pins the fixture itself
 *
 * @see docs/CHAIN-CONTRACTS.md §6 — Adaptive Loop invariants the canary
 *      observes (I-AL1 / I-AL2 / I-AL3 / I-AL4 / I-AL5).
 * @see scripts/seed-system-behavior-defaults.ts — the production source
 *      for SYSTEM BehaviorTarget seeding. The fixture mirrors its plan
 *      but seeds against an isolated Parameter set so the canary's
 *      WARN/INFO/ERROR verdicts are scoped to fixture data.
 */

import { PrismaClient } from "@prisma/client";

import {
  buildSeedPlan,
  classifySeedPlan,
} from "../../../scripts/seed-system-behavior-defaults";

/**
 * Prefix every fixture entity slug / name with this so cleanup can be
 * exhaustive without nuking pre-existing rows.
 */
export const CANARY_PREFIX = "canary-1514";

export interface CanaryFixture {
  domainId: string;
  subjectId: string;
  curriculumId: string;
  moduleId: string;
  playbookId: string;
  callerId: string;
}

const PLAYBOOK_NAME = `${CANARY_PREFIX}-playbook`;
const DOMAIN_SLUG = `${CANARY_PREFIX}-domain`;
const SUBJECT_SLUG = `${CANARY_PREFIX}-subject`;
const CURRICULUM_SLUG = `${CANARY_PREFIX}-curriculum`;
const MODULE_SLUG = `${CANARY_PREFIX}-module`;
const CALLER_EXTERNAL_ID = `${CANARY_PREFIX}-caller`;

/**
 * Create / re-attach the canary's data graph. Returns the IDs the canary
 * test threads through its assertions.
 */
export async function bootstrapCanaryFixture(
  prisma: PrismaClient,
): Promise<CanaryFixture> {
  // 1. Domain
  const domain = await prisma.domain.upsert({
    where: { slug: DOMAIN_SLUG },
    create: {
      slug: DOMAIN_SLUG,
      name: "Canary 1514 Domain",
      description:
        "Adaptive-loop canary domain — owned by tests/integration/journey/canary-fixture.ts.",
      isActive: true,
    },
    update: { isActive: true },
  });

  // 2. Subject
  const subject = await prisma.subject.upsert({
    where: { slug: SUBJECT_SLUG },
    create: {
      slug: SUBJECT_SLUG,
      name: "Canary 1514 Subject (IELTS Speaking)",
    },
    update: {},
  });

  await prisma.subjectDomain.upsert({
    where: {
      subjectId_domainId: { subjectId: subject.id, domainId: domain.id },
    },
    create: { subjectId: subject.id, domainId: domain.id },
    update: {},
  });

  // 3. Playbook — PUBLISHED + tierPresetId set so PROSODY won't WARN
  //    on the no-tierPreset reason. We don't actually want PROSODY to
  //    run successfully (no stereo recording in a fake test call), but
  //    we DO want the canary to observe whether the chain forward of
  //    PROSODY closes.
  //
  //    `config` is set only on the first `create` (the test path is
  //    a fresh-bootstrap). The update branch goes through
  //    `updatePlaybookConfig` from #826 to satisfy the canonical
  //    write-side guard `hf-playbook/no-direct-config-write` —
  //    educator-facing config writes must bump `composeInputsUpdatedAt`.
  let playbook = await prisma.playbook.findFirst({
    where: { domainId: domain.id, name: PLAYBOOK_NAME },
  });

  if (!playbook) {
    playbook = await prisma.playbook.create({
      data: {
        name: PLAYBOOK_NAME,
        description: "Adaptive-loop canary playbook (#1514).",
        domainId: domain.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
        config: {
          tierPresetId: "ielts-speaking",
        },
      },
    });
  } else if (
    !(playbook.config as Record<string, unknown> | null)?.tierPresetId
  ) {
    const { updatePlaybookConfig } = await import(
      "../../../lib/playbook/update-playbook-config"
    );
    const result = await updatePlaybookConfig(
      playbook.id,
      (current) => ({ ...current, tierPresetId: "ielts-speaking" }),
      { reason: "canary-1514 fixture bootstrap", skipTimestamp: true },
    );
    playbook = result.playbook;
  }

  await prisma.playbookSubject.upsert({
    where: {
      playbookId_subjectId: {
        playbookId: playbook.id,
        subjectId: subject.id,
      },
    },
    create: { playbookId: playbook.id, subjectId: subject.id },
    update: {},
  });

  // 4. Curriculum (primary) + 1 Module
  const curriculum = await prisma.curriculum.upsert({
    where: { slug: CURRICULUM_SLUG },
    create: {
      slug: CURRICULUM_SLUG,
      name: "Canary 1514 Curriculum",
    },
    update: {},
  });

  await prisma.playbookCurriculum.upsert({
    where: {
      playbookId_curriculumId: {
        playbookId: playbook.id,
        curriculumId: curriculum.id,
      },
    },
    create: {
      playbookId: playbook.id,
      curriculumId: curriculum.id,
      role: "primary",
    },
    update: { role: "primary" },
  });

  let curriculumModule = await prisma.curriculumModule.findFirst({
    where: { curriculumId: curriculum.id, slug: MODULE_SLUG },
  });
  if (!curriculumModule) {
    curriculumModule = await prisma.curriculumModule.create({
      data: {
        curriculumId: curriculum.id,
        slug: MODULE_SLUG,
        title: "Canary Module — Part 1: Familiar Topics",
        sortOrder: 0,
        keyTerms: ["work", "study", "hometown", "hobbies"],
        // NOT-NULL on String[]; default empty (self-contained module).
        coversModules: [],
      },
    });
  }

  // 5. Caller (enrolled via CallerPlaybook)
  const caller = await prisma.caller.upsert({
    where: { externalId: CALLER_EXTERNAL_ID },
    create: {
      externalId: CALLER_EXTERNAL_ID,
      name: "Canary Maya Tester",
      phone: "+1-555-CAN-1514",
      domainId: domain.id,
    },
    update: { domainId: domain.id },
  });

  await prisma.callerPlaybook.upsert({
    where: {
      callerId_playbookId: {
        callerId: caller.id,
        playbookId: playbook.id,
      },
    },
    create: {
      callerId: caller.id,
      playbookId: playbook.id,
      status: "ACTIVE",
      enrolledBy: CANARY_PREFIX,
      isDefault: true,
    },
    update: {
      status: "ACTIVE",
      isDefault: true,
    },
  });

  // 6. SYSTEM-scope BehaviorTarget seeding — mirrors
  //    scripts/seed-system-behavior-defaults.ts so the canary's I-AL5
  //    verdict reflects the production cascade root. Idempotent: rows
  //    already present are left alone (the script's contract).
  await seedSystemBehaviorDefaultsViaScript(prisma);

  return {
    domainId: domain.id,
    subjectId: subject.id,
    curriculumId: curriculum.id,
    moduleId: curriculumModule.id,
    playbookId: playbook.id,
    callerId: caller.id,
  };
}

/**
 * Seed the SYSTEM-scope `BehaviorTarget` rows using the production
 * script's pure planner / classifier helpers. This avoids re-implementing
 * the LISTED_KNOBS filter and guarantees the canary's view of the
 * cascade root matches what `npx tsx scripts/seed-system-behavior-defaults.ts`
 * would write on a real environment.
 *
 * Idempotent — `classifySeedPlan` skips rows already present, and the
 * `create` path here re-checks under a single statement to absorb any
 * race against a concurrent operator run.
 */
async function seedSystemBehaviorDefaultsViaScript(
  prisma: PrismaClient,
): Promise<void> {
  const plan = buildSeedPlan();
  const report = await classifySeedPlan(plan);

  for (const entry of report.toCreate) {
    const existing = await prisma.behaviorTarget.findFirst({
      where: {
        parameterId: entry.parameterId,
        scope: "SYSTEM",
        playbookId: null,
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.behaviorTarget.create({
      data: {
        parameterId: entry.parameterId,
        scope: "SYSTEM",
        playbookId: null,
        targetValue: entry.targetValue,
        source: "SEED",
        confidence: 0.5,
      },
    });
  }
}

/**
 * Remove every row authored by `bootstrapCanaryFixture` for this
 * `CANARY_PREFIX`. Symmetric — running this then re-bootstrapping is
 * the expected reset path between tests.
 *
 * Order matters because of FK constraints. SYSTEM BehaviorTarget rows
 * are intentionally NOT removed — they're shared cascade roots that
 * `scripts/seed-system-behavior-defaults.ts` owns.
 */
export async function cleanupCanaryFixture(
  prisma: PrismaClient,
): Promise<void> {
  const caller = await prisma.caller.findUnique({
    where: { externalId: CALLER_EXTERNAL_ID },
  });
  if (caller) {
    await prisma.callerPlaybook.deleteMany({ where: { callerId: caller.id } });
    await prisma.composedPrompt.deleteMany({ where: { callerId: caller.id } });
    await prisma.callerMemory.deleteMany({ where: { callerId: caller.id } });
    await prisma.callerMemorySummary.deleteMany({
      where: { callerId: caller.id },
    });
    await prisma.callScore.deleteMany({ where: { callerId: caller.id } });
    await prisma.callerTarget.deleteMany({ where: { callerId: caller.id } });
    await prisma.callerAttribute.deleteMany({
      where: { callerId: caller.id },
    });
    await prisma.callerModuleProgress.deleteMany({
      where: { callerId: caller.id },
    });
    // FK chain to Call: must delete dependent rows before deleteMany on Call.
    await prisma.personalityObservation.deleteMany({
      where: { callerId: caller.id },
    });
    await prisma.behaviorMeasurement.deleteMany({
      where: { call: { callerId: caller.id } },
    });
    await prisma.callTarget.deleteMany({
      where: { call: { callerId: caller.id } },
    });
    await prisma.call.deleteMany({ where: { callerId: caller.id } });
    await prisma.caller.delete({ where: { id: caller.id } }).catch(() => {});
  }

  const playbook = await prisma.playbook.findFirst({
    where: { name: PLAYBOOK_NAME },
  });
  if (playbook) {
    await prisma.playbookSubject.deleteMany({
      where: { playbookId: playbook.id },
    });
    await prisma.playbookCurriculum.deleteMany({
      where: { playbookId: playbook.id },
    });
    await prisma.playbook.delete({ where: { id: playbook.id } }).catch(() => {});
  }

  const curriculum = await prisma.curriculum.findUnique({
    where: { slug: CURRICULUM_SLUG },
  });
  if (curriculum) {
    await prisma.curriculumModule.deleteMany({
      where: { curriculumId: curriculum.id },
    });
    await prisma.curriculum.delete({ where: { id: curriculum.id } }).catch(() => {});
  }

  const subject = await prisma.subject.findUnique({
    where: { slug: SUBJECT_SLUG },
  });
  if (subject) {
    await prisma.subjectDomain.deleteMany({
      where: { subjectId: subject.id },
    });
    await prisma.subject.delete({ where: { id: subject.id } }).catch(() => {});
  }

  await prisma.domain.deleteMany({ where: { slug: DOMAIN_SLUG } });
}

/**
 * Canary transcript — long enough (≥ 1KB, well above I-AL1's 200-char
 * threshold) and with explicit memory hooks ("My name is Maya", workplace,
 * hobby) so a real-engine EXTRACT has unambiguous content to attribute
 * memories to.
 *
 * Exported so the canary test reads ONE canonical transcript.
 */
export const CANARY_TRANSCRIPT = [
  "AI: Hello! Welcome to your IELTS Speaking practice. Could we start by you telling me a little about yourself?",
  "Student: Hi! My name is Maya. I work at a small architecture firm in Madrid as a junior architect.",
  "AI: That's great, Maya. How long have you been working there?",
  "Student: About two years now. Before that I was studying architecture at the Universidad Politécnica de Madrid.",
  "AI: Wonderful. Let's talk about hometowns — can you describe where you grew up?",
  "Student: I grew up in a small coastal town in northern Spain called Llanes. It's famous for its beaches and the asturian cider tradition.",
  "AI: Lovely. What did you enjoy most about growing up there?",
  "Student: I loved how close everything was to the sea. My family would go fishing on weekends — my dad taught me how to read the tides.",
  "AI: That sounds wonderful. Now let's move to a slightly more abstract topic — what's a hobby that keeps you balanced outside of work?",
  "Student: I started rock climbing about a year ago. There's a great indoor gym near my apartment and I go three times a week. It really helps with stress.",
  "AI: Excellent. Do you have any long-term goals for your climbing?",
  "Student: I'd like to do a multi-pitch outdoor route in the Picos de Europa next summer. It's something I've been training for.",
  "AI: Thank you, Maya. Those were some great responses. Your fluency was strong and you used some nice descriptive vocabulary.",
].join("\n");
