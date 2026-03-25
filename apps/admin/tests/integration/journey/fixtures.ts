/**
 * Journey Integration Test Fixtures
 *
 * Creates the minimal data graph needed to test the full educator journey:
 *   Domain → Subject → ContentSource → Assertions → Curriculum → Playbook → Caller → Compose
 *
 * All entities tagged with "journey-test-" prefix for safe cleanup.
 * Idempotent — safe to run repeatedly.
 *
 * Prerequisites:
 *   - Database migrated
 *   - seed-from-specs run (specs must exist)
 */

import { PrismaClient } from "@prisma/client";

const JOURNEY_PREFIX = "journey-test";

/** IDs populated during setup, consumed by tests */
export interface JourneyFixtures {
  domainId: string;
  subjectId: string;
  sourceId: string;
  playbook: { id: string; name: string };
  curriculum: { id: string; slug: string };
  moduleIds: string[];
  loRefs: string[];
  assertionIds: string[];
  callerId: string;
  callId: string;
  /** Caller with userId but no enrollment — for sim-setup tests */
  simSetupCallerId: string;
  simSetupUserId: string;
}

/** Sample assertions representing extracted teaching points */
const JOURNEY_ASSERTIONS = [
  {
    assertion: "Photosynthesis converts light energy into chemical energy stored in glucose.",
    category: "definition",
    tags: ["biology", "photosynthesis", "energy"],
    learningOutcomeRef: "BIO-LO1",
    orderIndex: 0,
    topicSlug: "photosynthesis",
    teachMethod: "definition_matching",
  },
  {
    assertion: "The chemical equation for photosynthesis is 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂.",
    category: "fact",
    tags: ["biology", "photosynthesis", "equation"],
    learningOutcomeRef: "BIO-LO1",
    orderIndex: 1,
    topicSlug: "photosynthesis",
    teachMethod: "recall_quiz",
  },
  {
    assertion: "Chloroplasts contain chlorophyll which absorbs light, primarily red and blue wavelengths.",
    category: "fact",
    tags: ["biology", "chloroplast", "chlorophyll"],
    learningOutcomeRef: "BIO-LO1",
    orderIndex: 2,
    topicSlug: "chloroplast-structure",
    teachMethod: "recall_quiz",
  },
  {
    assertion: "The rate of photosynthesis is affected by light intensity, CO₂ concentration, and temperature.",
    category: "rule",
    tags: ["biology", "photosynthesis", "limiting-factors"],
    learningOutcomeRef: "BIO-LO2",
    orderIndex: 3,
    topicSlug: "limiting-factors",
    teachMethod: "scenario_analysis",
  },
  {
    assertion: "Cellular respiration is the reverse process, breaking down glucose to release energy as ATP.",
    category: "definition",
    tags: ["biology", "respiration", "atp"],
    learningOutcomeRef: "BIO-LO2",
    orderIndex: 4,
    topicSlug: "cellular-respiration",
    teachMethod: "definition_matching",
  },
];

/** Lesson plan entries matching the assertions via learningOutcomeRefs */
const JOURNEY_LESSON_PLAN = [
  {
    session: 1,
    type: "introduce",
    label: "Introduction to Photosynthesis",
    moduleId: null,
    moduleLabel: "Module 1: Energy in Living Systems",
    estimatedDurationMins: 30,
    learningOutcomeRefs: ["BIO-LO1"],
    phases: [
      { id: "activate", label: "Activate Prior Knowledge", durationMins: 5 },
      { id: "present", label: "Present Key Concepts", durationMins: 15 },
      { id: "practice", label: "Guided Practice", durationMins: 10 },
    ],
  },
  {
    session: 2,
    type: "deepen",
    label: "Limiting Factors & Respiration",
    moduleId: null,
    moduleLabel: "Module 1: Energy in Living Systems",
    estimatedDurationMins: 30,
    learningOutcomeRefs: ["BIO-LO2"],
    phases: [
      { id: "review", label: "Review Session 1", durationMins: 5 },
      { id: "explore", label: "Explore Limiting Factors", durationMins: 15 },
      { id: "compare", label: "Compare with Respiration", durationMins: 10 },
    ],
  },
];

/**
 * Create all journey test fixtures.
 * Returns IDs for use in test assertions.
 */
export async function seedJourneyFixtures(prisma: PrismaClient): Promise<JourneyFixtures> {
  // 1. Domain
  const domain = await prisma.domain.upsert({
    where: { slug: `${JOURNEY_PREFIX}-domain` },
    create: {
      slug: `${JOURNEY_PREFIX}-domain`,
      name: "Journey Test Biology",
      description: "Integration test domain — do not delete during test runs.",
      isActive: true,
    },
    update: { isActive: true },
  });

  // 2. Subject
  const subject = await prisma.subject.upsert({
    where: { slug: `${JOURNEY_PREFIX}-biology` },
    create: {
      slug: `${JOURNEY_PREFIX}-biology`,
      name: "GCSE Biology (Journey Test)",
      description: "Test subject for journey integration tests.",
    },
    update: {},
  });

  // Link subject to domain
  await prisma.subjectDomain.upsert({
    where: {
      subjectId_domainId: { subjectId: subject.id, domainId: domain.id },
    },
    create: { subjectId: subject.id, domainId: domain.id },
    update: {},
  });

  // 3. Content Source
  const source = await prisma.contentSource.upsert({
    where: { slug: `${JOURNEY_PREFIX}-textbook` },
    create: {
      slug: `${JOURNEY_PREFIX}-textbook`,
      name: "Biology Textbook (Journey Test)",
      description: "Test document for journey integration tests.",
      trustLevel: "ACCREDITED_MATERIAL",
      documentType: "TEXTBOOK",
      documentTypeSource: "test:fixture",
    },
    update: {},
  });

  // Link source to subject
  await prisma.subjectSource.upsert({
    where: {
      subjectId_sourceId: { subjectId: subject.id, sourceId: source.id },
    },
    create: {
      subjectId: subject.id,
      sourceId: source.id,
      tags: ["content"],
    },
    update: {},
  });

  // 4. Content Assertions (teaching points)
  // Clean existing journey assertions for this source
  await prisma.contentAssertion.deleteMany({
    where: { sourceId: source.id },
  });

  const assertionIds: string[] = [];
  for (const a of JOURNEY_ASSERTIONS) {
    const created = await prisma.contentAssertion.create({
      data: {
        sourceId: source.id,
        assertion: a.assertion,
        category: a.category,
        tags: a.tags,
        learningOutcomeRef: a.learningOutcomeRef,
        orderIndex: a.orderIndex,
        topicSlug: a.topicSlug,
        teachMethod: a.teachMethod,
      },
    });
    assertionIds.push(created.id);
  }

  // 5. Curriculum with lesson plan + modules + learning objectives
  const curriculum = await prisma.curriculum.upsert({
    where: { slug: `${JOURNEY_PREFIX}-curriculum` },
    create: {
      slug: `${JOURNEY_PREFIX}-curriculum`,
      name: "Biology Curriculum (Journey Test)",
      deliveryConfig: { lessonPlan: JOURNEY_LESSON_PLAN },
      constraints: [],
    },
    update: {
      deliveryConfig: { lessonPlan: JOURNEY_LESSON_PLAN },
    },
  });

  // Modules
  await prisma.curriculumModule.deleteMany({
    where: { curriculumId: curriculum.id },
  });

  const mod1 = await prisma.curriculumModule.create({
    data: {
      curriculumId: curriculum.id,
      slug: "MOD-1",
      title: "Energy in Living Systems",
      sortOrder: 0,
      keyTerms: ["photosynthesis", "respiration", "ATP", "chlorophyll"],
    },
  });

  // Learning objectives (ref matches ContentAssertion.learningOutcomeRef)
  const lo1 = await prisma.learningObjective.create({
    data: {
      moduleId: mod1.id,
      ref: "BIO-LO1",
      description: "Understand the process and equation of photosynthesis.",
      sortOrder: 0,
    },
  });
  const lo2 = await prisma.learningObjective.create({
    data: {
      moduleId: mod1.id,
      ref: "BIO-LO2",
      description: "Explain limiting factors and the relationship between photosynthesis and respiration.",
      sortOrder: 1,
    },
  });

  // Link assertions to learning objectives
  await prisma.contentAssertion.updateMany({
    where: { id: { in: assertionIds.slice(0, 3) }, learningOutcomeRef: "BIO-LO1" },
    data: { learningObjectiveId: lo1.id },
  });
  await prisma.contentAssertion.updateMany({
    where: { id: { in: assertionIds.slice(3) }, learningOutcomeRef: "BIO-LO2" },
    data: { learningObjectiveId: lo2.id },
  });

  // 6. Playbook (published, with identity spec + content wiring)
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { specRole: "IDENTITY", isActive: true },
  });

  let playbook = await prisma.playbook.findFirst({
    where: { domainId: domain.id, name: `${JOURNEY_PREFIX}-playbook` },
  });

  if (!playbook) {
    playbook = await prisma.playbook.create({
      data: {
        name: `${JOURNEY_PREFIX}-playbook`,
        description: "Journey test playbook",
        domainId: domain.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    if (identitySpec) {
      await prisma.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: identitySpec.id,
          sortOrder: 0,
          groupLabel: "Identity",
        },
      });
    }
  }

  // Link playbook to subject
  await prisma.playbookSubject.upsert({
    where: {
      playbookId_subjectId: { playbookId: playbook.id, subjectId: subject.id },
    },
    create: { playbookId: playbook.id, subjectId: subject.id },
    update: {},
  });

  // 7. Caller (enrolled in domain)
  const caller = await prisma.caller.upsert({
    where: { externalId: `${JOURNEY_PREFIX}-caller` },
    create: {
      externalId: `${JOURNEY_PREFIX}-caller`,
      name: "Journey Test Student",
      phone: "+1-555-JRN-001",
      domainId: domain.id,
    },
    update: { domainId: domain.id },
  });

  // 7b. Enroll caller in playbook (CallerPlaybook)
  await prisma.callerPlaybook.upsert({
    where: {
      callerId_playbookId: { callerId: caller.id, playbookId: playbook.id },
    },
    create: {
      callerId: caller.id,
      playbookId: playbook.id,
      status: "ACTIVE",
      enrolledBy: `${JOURNEY_PREFIX}`,
      isDefault: true,
    },
    update: {
      status: "ACTIVE",
      enrolledBy: `${JOURNEY_PREFIX}`,
      isDefault: true,
    },
  });

  // 7c. Sim-setup caller — has userId, no enrollment (tests the fix for TODO #39)
  const simSetupUser = await prisma.caller.upsert({
    where: { externalId: `${JOURNEY_PREFIX}-sim-setup` },
    create: {
      externalId: `${JOURNEY_PREFIX}-sim-setup`,
      name: "Journey Sim Setup Tester",
      phone: "+1-555-JRN-002",
      domainId: domain.id,
      userId: `${JOURNEY_PREFIX}-user-id`,
    },
    update: { domainId: domain.id, userId: `${JOURNEY_PREFIX}-user-id` },
  });

  // 8. A completed call (so Call 2 composition has history)
  await prisma.call.deleteMany({
    where: { callerId: caller.id, source: `${JOURNEY_PREFIX}` },
  });

  const call = await prisma.call.create({
    data: {
      source: `${JOURNEY_PREFIX}`,
      externalId: `${JOURNEY_PREFIX}-call-1`,
      callerId: caller.id,
      callSequence: 1,
      transcript: [
        "AI: Welcome! Today we'll explore photosynthesis. What do you already know about how plants make food?",
        "Student: I know plants need sunlight and water.",
        "AI: Exactly! Plants use sunlight, water, and carbon dioxide to produce glucose and oxygen. This process is called photosynthesis.",
        "Student: What's the chemical equation?",
        "AI: Great question! 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂. Let's break it down...",
      ].join("\n"),
      moduleId: mod1.id,
    },
  });

  // 9. Caller memories (extracted from Call 1)
  await prisma.callerMemory.deleteMany({
    where: { callerId: caller.id, extractedBy: `${JOURNEY_PREFIX}` },
  });

  const memories = [
    { category: "FACT" as const, key: "name", value: "Journey Test Student", confidence: 0.95 },
    { category: "TOPIC" as const, key: "photosynthesis_basics", value: "Understands sunlight and water needed", confidence: 0.85 },
    { category: "FACT" as const, key: "equation_exposure", value: "Has seen the photosynthesis equation", confidence: 0.8 },
  ];

  for (const mem of memories) {
    await prisma.callerMemory.create({
      data: {
        callerId: caller.id,
        category: mem.category,
        source: "EXTRACTED",
        key: mem.key,
        value: mem.value,
        confidence: mem.confidence,
        extractedBy: `${JOURNEY_PREFIX}`,
      },
    });
  }

  // 10. Memory summary
  await prisma.callerMemorySummary.upsert({
    where: { callerId: caller.id },
    create: {
      callerId: caller.id,
      factCount: 2,
      preferenceCount: 0,
      eventCount: 0,
      topicCount: 1,
      keyFacts: [{ key: "name", value: "Journey Test Student", confidence: 0.95 }],
      topTopics: [{ topic: "Photosynthesis", frequency: 1, lastMentioned: new Date().toISOString() }],
      preferences: {},
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
    update: {
      factCount: 2,
      topicCount: 1,
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
  });

  return {
    domainId: domain.id,
    subjectId: subject.id,
    sourceId: source.id,
    playbook: { id: playbook.id, name: playbook.name },
    curriculum: { id: curriculum.id, slug: curriculum.slug },
    moduleIds: [mod1.id],
    loRefs: ["BIO-LO1", "BIO-LO2"],
    assertionIds,
    callerId: caller.id,
    callId: call.id,
    simSetupCallerId: simSetupUser.id,
    simSetupUserId: `${JOURNEY_PREFIX}-user-id`,
  };
}

/**
 * Clean up all journey test data.
 * Order matters due to FK constraints.
 */
export async function cleanupJourneyFixtures(prisma: PrismaClient): Promise<void> {
  const caller = await prisma.caller.findUnique({
    where: { externalId: `${JOURNEY_PREFIX}-caller` },
  });

  if (caller) {
    await prisma.callerPlaybook.deleteMany({ where: { callerId: caller.id } });
    await prisma.composedPrompt.deleteMany({ where: { callerId: caller.id } });
    await prisma.callerMemory.deleteMany({ where: { callerId: caller.id } });
    await prisma.callerMemorySummary.deleteMany({ where: { callerId: caller.id } });
    await prisma.call.deleteMany({ where: { callerId: caller.id } });
    await prisma.caller.delete({ where: { id: caller.id } });
  }

  // Clean up sim-setup caller
  const simSetupCaller = await prisma.caller.findUnique({
    where: { externalId: `${JOURNEY_PREFIX}-sim-setup` },
  });
  if (simSetupCaller) {
    await prisma.callerPlaybook.deleteMany({ where: { callerId: simSetupCaller.id } });
    await prisma.composedPrompt.deleteMany({ where: { callerId: simSetupCaller.id } });
    await prisma.caller.delete({ where: { id: simSetupCaller.id } });
  }

  const source = await prisma.contentSource.findUnique({
    where: { slug: `${JOURNEY_PREFIX}-textbook` },
  });
  if (source) {
    // Assertions cascade from source delete
    await prisma.contentSource.delete({ where: { id: source.id } });
  }

  const curriculum = await prisma.curriculum.findUnique({
    where: { slug: `${JOURNEY_PREFIX}-curriculum` },
  });
  if (curriculum) {
    // Modules + LOs cascade from curriculum delete
    await prisma.curriculum.delete({ where: { id: curriculum.id } });
  }

  const subject = await prisma.subject.findUnique({
    where: { slug: `${JOURNEY_PREFIX}-biology` },
  });
  if (subject) {
    await prisma.subject.delete({ where: { id: subject.id } });
  }

  // Playbook cascades its items + subject links
  const playbook = await prisma.playbook.findFirst({
    where: { name: `${JOURNEY_PREFIX}-playbook` },
  });
  if (playbook) {
    await prisma.playbook.delete({ where: { id: playbook.id } });
  }

  await prisma.domain.deleteMany({
    where: { slug: `${JOURNEY_PREFIX}-domain` },
  });
}
