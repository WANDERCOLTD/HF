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
 * Slug for the per-playbook MEASURE spec that writes `skill_*` CallScores
 * during EXTRACT. Mirrors the production naming pattern from
 * `apps/admin/lib/wizard/apply-projection.ts::upsertMeasureSpec` (line 644):
 * `skill-measure-<playbookId-prefix-8>`. We use the CANARY_PREFIX instead of
 * the playbook UUID prefix so the slug stays stable across DB resets.
 */
const SKILL_MEASURE_SPEC_SLUG = `skill-measure-${CANARY_PREFIX}`;

/**
 * Canonical IELTS Speaking skill parameter IDs the canary fixture seeds.
 * These are the SAME parameterIds production IELTS playbooks use
 * (`skill_fluency_and_coherence_fc`, etc.) so SKILL-AGG-001's
 * `startsWith: "skill_"` pattern matches and the CallerTarget rows the
 * canary's G2 gate inspects line up with how real callers' rows are keyed.
 * Upsert semantics — if a production seed already created these rows, the
 * fixture leaves them alone.
 */
const CANARY_SKILL_PARAMS: ReadonlyArray<{
  parameterId: string;
  name: string;
  description: string;
  /**
   * What the MEASURE trigger should look at in the transcript. Drives the
   * `description` on AnalysisAction so a real-engine EXTRACT pass has
   * something concrete to score against.
   */
  triggerHint: string;
}> = [
  {
    parameterId: "skill_fluency_and_coherence_fc",
    name: "Fluency & Coherence",
    description: "IELTS Speaking — Fluency & Coherence (FC)",
    triggerHint:
      "Score how smoothly the learner speaks, the logical flow of their ideas, " +
      "and use of cohesive devices on a 0-1 scale.",
  },
  {
    parameterId: "skill_lexical_resource_lr",
    name: "Lexical Resource",
    description: "IELTS Speaking — Lexical Resource (LR)",
    triggerHint:
      "Score the range and precision of the learner's vocabulary, including " +
      "topic-specific terms and paraphrasing on a 0-1 scale.",
  },
  {
    parameterId: "skill_grammatical_range_and_accuracy_gra",
    name: "Grammatical Range & Accuracy",
    description: "IELTS Speaking — Grammatical Range & Accuracy (GRA)",
    triggerHint:
      "Score the range of grammatical structures and their accuracy on a 0-1 scale.",
  },
  {
    parameterId: "skill_pronunciation_p",
    name: "Pronunciation",
    description: "IELTS Speaking — Pronunciation (P)",
    triggerHint:
      "Score pronunciation features the transcript explicitly cites on a 0-1 scale. " +
      "Use evidence from coach feedback turns when available.",
  },
];

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
        // NOT NULL on String[] — empty array means self-contained module.
        // (PR #1525 fix; restored here for #1516 — system reminder dropped it.)
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

  // 7. Per-playbook skill-measure spec + PLAYBOOK-scope BehaviorTarget seeding
  //    (#1516). The canary playbook's EXTRACT stage needs a MEASURE spec that
  //    writes `skill_*` CallScores; without it, SKILL-AGG-001 finds zero source
  //    rows and the G2 gate fails. Production playbooks get this spec from
  //    `apply-projection.ts::upsertMeasureSpec` after a course-reference
  //    projection — the canary bootstrap mirrors that surface area without
  //    requiring a full wizard run.
  await seedCanarySkillMeasureSpec(prisma, playbook.id);

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
 * #1516 — Seed the per-playbook `skill-measure-<canary-prefix>` MEASURE spec
 * + matching PLAYBOOK-scope BehaviorTarget rows that the canary's pipeline
 * run needs to write `skill_*` CallScore rows during EXTRACT.
 *
 * Without this, SKILL-AGG-001 (`outputType=AGGREGATE, method=ema_to_caller_target,
 * sourceParameterPattern="skill_*"`) finds zero source rows for the canary
 * caller, leaves `CallerTarget(skill_*).currentScore` NULL, and the G2 gate
 * at `adaptive-loop-canary.integration.test.ts:292-317` fails.
 *
 * Production playbooks get this spec from
 * `apps/admin/lib/wizard/apply-projection.ts::upsertMeasureSpec` after a
 * course-reference projection. The canary bootstrap mirrors the **shape** of
 * that output — Parameter rows + AnalysisSpec + AnalysisTrigger +
 * AnalysisAction + PlaybookItem link + PLAYBOOK-scope BehaviorTarget rows —
 * without requiring the full wizard pipeline. The slug pattern matches
 * production (`skill-measure-<prefix>`) so a follow-on real-engine projection
 * pass over the canary playbook would safely upsert into the same row.
 *
 * Idempotent — every write uses upsert / findFirst+create semantics. Safe to
 * re-run.
 */
async function seedCanarySkillMeasureSpec(
  prisma: PrismaClient,
  playbookId: string,
): Promise<void> {
  // 1. Upsert canonical skill Parameter rows (shared with production IELTS
  //    seed — same parameterIds, idempotent on collision).
  for (const skill of CANARY_SKILL_PARAMS) {
    await prisma.parameter.upsert({
      where: { parameterId: skill.parameterId },
      create: {
        parameterId: skill.parameterId,
        name: skill.name,
        definition: skill.description,
        sectionId: "skill",
        domainGroup: "skill",
        scaleType: "0-1",
        directionality: "positive",
        computedBy: `canary-1514-fixture`,
        parameterType: "BEHAVIOR",
        isAdjustable: true,
      },
      update: {
        // Don't overwrite production rows — leave name/definition/config
        // alone on upsert collision. The empty update is intentional.
      },
    });
  }

  // 2. Upsert the MEASURE spec itself. Mirror the production shape from
  //    `apply-projection.ts::upsertMeasureSpec` (line 648).
  const now = new Date();
  const spec = await prisma.analysisSpec.upsert({
    where: { slug: SKILL_MEASURE_SPEC_SLUG },
    create: {
      slug: SKILL_MEASURE_SPEC_SLUG,
      name: "Canary 1514 — Skill Measure",
      description:
        "Adaptive-loop canary per-playbook MEASURE spec (#1516). Scores the " +
        "4 IELTS Speaking skill parameters from every call transcript so " +
        "SKILL-AGG-001 has source rows for the EMA aggregation pass.",
      scope: "DOMAIN",
      outputType: "MEASURE",
      specType: "DOMAIN",
      specRole: "MEASURE",
      domain: DOMAIN_SLUG,
      priority: 10,
      isActive: true,
      isDirty: false,
      compiledAt: now,
    },
    update: {
      isActive: true,
      isDirty: false,
      compiledAt: now,
    },
    select: { id: true },
  });

  // 3. Replace triggers + actions wholesale (cheap — 1 trigger, 4 actions).
  //    Same pattern as the production upsert.
  await prisma.analysisTrigger.deleteMany({ where: { specId: spec.id } });
  await prisma.analysisTrigger.create({
    data: {
      specId: spec.id,
      name: "Score IELTS speaking skills",
      given:
        "the call transcript captures a speaking-practice interaction with at " +
        "least one learner utterance",
      when: "the EXTRACT stage runs over the transcript",
      then: "each IELTS skill parameter is scored on a 0-1 scale with evidence cites",
      sortOrder: 0,
      notes: `canary-1514 skill measure (#1516)`,
      actions: {
        create: CANARY_SKILL_PARAMS.map((skill, idx) => ({
          description: skill.triggerHint,
          parameterId: skill.parameterId,
          weight: 1.0,
          sortOrder: idx,
        })),
      },
    },
  });

  // 4. Link the spec to the canary playbook via PlaybookItem so the
  //    spec-loader's playbook-scope filter includes it. No composite unique
  //    on (playbookId, specId), so emulate upsert with findFirst.
  const existingLink = await prisma.playbookItem.findFirst({
    where: { playbookId, specId: spec.id },
    select: { id: true, isEnabled: true },
  });
  if (existingLink) {
    if (!existingLink.isEnabled) {
      await prisma.playbookItem.update({
        where: { id: existingLink.id },
        data: { isEnabled: true },
      });
    }
  } else {
    await prisma.playbookItem.create({
      data: {
        playbookId,
        specId: spec.id,
        itemType: "SPEC",
        isEnabled: true,
        groupId: "SKILL_MEASURE",
        groupLabel: "Per-skill scoring (#1516 canary)",
        sortOrder: 100,
      },
    });
  }

  // 5. Seed PLAYBOOK-scope BehaviorTarget rows for the 4 skill parameters
  //    so the AGGREGATE-side `CallerTarget.upsert` finds a non-default
  //    targetValue when it lands. Without these the cascade falls through
  //    to SKILL-AGG-001's hardcoded `targetValue: 1.0` (the runner's
  //    `create` default at `aggregate-runner.ts:274`).
  for (const skill of CANARY_SKILL_PARAMS) {
    const existing = await prisma.behaviorTarget.findFirst({
      where: {
        parameterId: skill.parameterId,
        scope: "PLAYBOOK",
        playbookId,
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.behaviorTarget.create({
      data: {
        parameterId: skill.parameterId,
        scope: "PLAYBOOK",
        playbookId,
        targetValue: 1.0,
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
 * `scripts/seed-system-behavior-defaults.ts` owns. Likewise the canonical
 * skill `Parameter` rows are LEFT IN PLACE — they're shared with production
 * IELTS playbooks via `apply-projection.ts::ensureParameters`, so deleting
 * them would break unrelated callers.
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
    // #1525 — Call has soft FKs from PersonalityObservation,
    // BehaviorMeasurement, and CallTarget. Drop them before the Call rows.
    await prisma.personalityObservation
      .deleteMany({ where: { callerId: caller.id } })
      .catch(() => {});
    await prisma.behaviorMeasurement
      .deleteMany({ where: { call: { callerId: caller.id } } })
      .catch(() => {});
    await prisma.callTarget
      .deleteMany({ where: { call: { callerId: caller.id } } })
      .catch(() => {});
    await prisma.call.deleteMany({ where: { callerId: caller.id } });
    // #1516 — `CallerPersonalityProfile` (legacy FK name
    // `UserPersonalityProfile_callerId_fkey`) and `CallerPersonality` are
    // hard FKs on Caller; without an explicit delete the silent
    // `.catch(() => {})` below leaks the caller row across runs (the
    // "cleanup removes every fixture row" self-test asserts against a
    // leftover Caller). Wrap each in `.catch` so the delete is best-effort
    // — production DBs without these rows for the canary still complete
    // cleanly.
    await prisma.callerPersonalityProfile
      .deleteMany({ where: { callerId: caller.id } })
      .catch(() => {});
    await prisma.callerPersonality
      .deleteMany({ where: { callerId: caller.id } })
      .catch(() => {});
    await prisma.caller.delete({ where: { id: caller.id } }).catch(() => {});
  }

  const playbook = await prisma.playbook.findFirst({
    where: { name: PLAYBOOK_NAME },
  });
  if (playbook) {
    // #1516 — Drop the per-playbook skill-measure spec + its links + targets.
    //   Order: PlaybookItem → BehaviorTarget(PLAYBOOK) → AnalysisSpec (which
    //   cascades to AnalysisTrigger → AnalysisAction via onDelete:Cascade).
    await prisma.playbookItem.deleteMany({
      where: { playbookId: playbook.id },
    });
    await prisma.behaviorTarget.deleteMany({
      where: { scope: "PLAYBOOK", playbookId: playbook.id },
    });
    await prisma.analysisSpec
      .delete({ where: { slug: SKILL_MEASURE_SPEC_SLUG } })
      .catch(() => {});

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
