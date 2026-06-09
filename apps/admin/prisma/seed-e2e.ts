/**
 * Seed E2E Test Fixtures
 *
 * Creates deterministic test data for Playwright cloud E2E tests.
 * Idempotent — safe to run repeatedly (uses upsert patterns).
 *
 * Entities created:
 *   - Domain: "E2E Test Domain" (slug: e2e-test-domain)
 *   - Caller: "E2E Test Caller" (externalId: e2e-sim-caller) with memories
 *   - 1 published playbook with spec items
 *
 * Prerequisites:
 *   - Database migrated
 *   - seed-from-specs.ts run (specs must exist for playbook items)
 *
 * Usage:
 *   npx tsx prisma/seed-e2e.ts
 */

import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

export { main };

const E2E_MEMORIES: Array<{
  category: "FACT" | "PREFERENCE" | "TOPIC" | "CONTEXT";
  source: "EXTRACTED" | "INFERRED";
  key: string;
  value: string;
  confidence: number;
  evidence?: string;
}> = [
  {
    category: "FACT",
    source: "EXTRACTED",
    key: "name",
    value: "E2E Tester",
    confidence: 0.95,
    evidence: "User identified themselves in first session",
  },
  {
    category: "PREFERENCE",
    source: "INFERRED",
    key: "learning_style",
    value: "Visual learner — prefers diagrams and examples",
    confidence: 0.8,
    evidence: "Requested visual aids in session 1",
  },
  {
    category: "TOPIC",
    source: "EXTRACTED",
    key: "current_topic",
    value: "Basic Mathematics — algebra fundamentals",
    confidence: 0.9,
    evidence: "Most recent session covered algebra",
  },
  {
    category: "CONTEXT",
    source: "EXTRACTED",
    key: "progress",
    value: "Starting out — completed introduction, ready for core concepts",
    confidence: 0.85,
  },
];

const E2E_TRANSCRIPT = `AI: Welcome! I'm your E2E test tutor. How can I help you today?
User: Hi, I want to learn about algebra.
AI: Great choice! Let's start with the basics. An equation is like a balanced scale — whatever you do to one side, you must do to the other. What do you already know about equations?
User: I know that x + 5 = 10 means x is 5.
AI: Exactly! You've solved your first equation by isolating the variable. Let's try something slightly more challenging next.`;

async function main(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();
  console.log("\n=== Seeding E2E Test Fixtures ===\n");

  // 1. Create/update E2E domain
  const domain = await prisma.domain.upsert({
    where: { slug: "e2e-test-domain" },
    create: {
      slug: "e2e-test-domain",
      name: "E2E Test Domain",
      description: "Test domain for Playwright E2E tests — do not delete.",
      isActive: true,
    },
    update: {
      name: "E2E Test Domain",
      description: "Test domain for Playwright E2E tests — do not delete.",
      isActive: true,
    },
  });
  console.log(`  Domain: ${domain.name} (${domain.slug}) — ${domain.id}`);

  // 2. Create/update E2E caller
  const caller = await prisma.caller.upsert({
    where: { externalId: "e2e-sim-caller" },
    create: {
      externalId: "e2e-sim-caller",
      name: "E2E Test Caller",
      phone: "+1-555-E2E-001",
      domainId: domain.id,
    },
    update: {
      name: "E2E Test Caller",
      domainId: domain.id,
    },
  });
  console.log(`  Caller: ${caller.name} — ${caller.id}`);

  // 3. Upsert personality profile
  await prisma.callerPersonalityProfile.upsert({
    where: { callerId: caller.id },
    create: {
      callerId: caller.id,
      parameterValues: {
        "B5-O": 0.7,
        "B5-C": 0.6,
        "B5-E": 0.5,
        "B5-A": 0.8,
        "B5-N": 0.3,
      },
      callsUsed: 1,
      specsUsed: 1,
      lastUpdatedAt: new Date(),
    },
    update: {
      parameterValues: {
        "B5-O": 0.7,
        "B5-C": 0.6,
        "B5-E": 0.5,
        "B5-A": 0.8,
        "B5-N": 0.3,
      },
      lastUpdatedAt: new Date(),
    },
  });
  console.log("  Personality profile created");

  // 4. Create a sample call with transcript (delete existing e2e calls first)
  await prisma.call.deleteMany({
    where: { callerId: caller.id, source: "e2e-fixture" },
  });

  await prisma.call.create({
    data: {
      source: "e2e-fixture",
      externalId: "e2e-call-1",
      callerId: caller.id,
      transcript: E2E_TRANSCRIPT,
      // #1344 Slice 4 — `Call.callSequence` dropped; sequencing lives on
      // `Session.learnerFacingNumber`. e2e fixture has no Session.
    },
  });
  console.log("  Call: 1 created with transcript");

  // 5. Create caller memories (delete existing e2e memories first)
  await prisma.callerMemory.deleteMany({
    where: { callerId: caller.id, extractedBy: "e2e-fixture" },
  });

  for (const mem of E2E_MEMORIES) {
    await prisma.callerMemory.create({
      data: {
        callerId: caller.id,
        category: mem.category,
        source: mem.source,
        key: mem.key,
        value: mem.value,
        confidence: mem.confidence,
        evidence: mem.evidence,
        extractedBy: "e2e-fixture",
      },
    });
  }
  console.log(`  Memories: ${E2E_MEMORIES.length} created`);

  // 6. Create/update memory summary
  await prisma.callerMemorySummary.upsert({
    where: { callerId: caller.id },
    create: {
      callerId: caller.id,
      factCount: 1,
      preferenceCount: 1,
      eventCount: 0,
      topicCount: 1,
      keyFacts: [
        { key: "name", value: "E2E Tester", confidence: 0.95 },
      ],
      topTopics: [
        { topic: "Basic Mathematics", frequency: 1, lastMentioned: new Date().toISOString() },
      ],
      preferences: {
        learningStyle: "visual",
      },
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
    update: {
      factCount: 1,
      preferenceCount: 1,
      topicCount: 1,
      keyFacts: [
        { key: "name", value: "E2E Tester", confidence: 0.95 },
      ],
      topTopics: [
        { topic: "Basic Mathematics", frequency: 1, lastMentioned: new Date().toISOString() },
      ],
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
  });
  console.log("  Memory summary created");

  // 7. Create a published playbook for the E2E domain (if specs exist)
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { specRole: "IDENTITY" },
  });
  const extractSpecs = await prisma.analysisSpec.findMany({
    where: { specRole: "EXTRACT" },
    take: 2,
  });

  if (identitySpec) {
    let playbook = await prisma.playbook.findFirst({
      where: { domainId: domain.id, name: "E2E Adaptive v1" },
    });

    if (!playbook) {
      playbook = await prisma.playbook.create({
        data: {
          name: "E2E Adaptive v1",
          description: "E2E test playbook — identity + measurement specs",
          domainId: domain.id,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

      await prisma.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: identitySpec.id,
          sortOrder: 0,
          groupLabel: "Identity",
        },
      });

      for (let i = 0; i < extractSpecs.length; i++) {
        await prisma.playbookItem.create({
          data: {
            playbookId: playbook.id,
            itemType: "SPEC",
            specId: extractSpecs[i].id,
            sortOrder: i + 1,
            groupLabel: "Measurement",
          },
        });
      }

      console.log(`  Playbook: ${playbook.name} (PUBLISHED) with ${1 + extractSpecs.length} specs`);
    } else {
      console.log(`  Playbook: ${playbook.name} already exists`);
    }
  } else {
    console.log("  Playbook: SKIPPED (no specs found — run seed-from-specs first)");
  }

  console.log("\n=== E2E Fixtures Complete ===\n");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("E2E seed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
