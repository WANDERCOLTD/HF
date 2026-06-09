/**
 * Seed Demo Fixtures
 *
 * Creates predictable, well-populated entities for demo screenshot capture.
 * Idempotent — safe to run repeatedly (uses upsert patterns).
 *
 * Entities created:
 *   - Domain: "Quantum Mechanics Tutor" (slug: qm-tutor)
 *   - Caller: "Paul" (externalId: demo-paul) with personality data
 *   - 5 calls with realistic transcripts
 *   - 6 caller memories
 *   - 1 memory summary
 *   - 1 published playbook with spec items
 *
 * Prerequisites:
 *   - Database migrated (npx prisma db push / migrate)
 *   - seed-from-specs.ts run (specs must exist for playbook items)
 *
 * Usage:
 *   npx tsx prisma/seed-demo-fixtures.ts
 */

import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

// ── Demo transcripts ────────────────────────────────

const DEMO_TRANSCRIPTS = [
  {
    source: "demo-fixture",
    transcript: `AI: Welcome back, Paul! Last time we were discussing quantum superposition. How did your reading go?\nUser: Pretty well actually. I think I understand the basic idea — a particle exists in multiple states until measured.\nAI: Exactly right! That's the core principle. Can you think of an everyday analogy that captures this idea?\nUser: Maybe like a coin spinning in the air? Before it lands, it's both heads and tails.\nAI: That's a great analogy! Now, how does this relate to Schrödinger's cat thought experiment?\nUser: The cat is both alive and dead until you open the box, right? It's in a superposition of states.\nAI: Perfect understanding. Let's explore what happens when we actually make a measurement...`,
  },
  {
    source: "demo-fixture",
    transcript: `AI: Hi Paul! Today let's tackle wave-particle duality. Ready?\nUser: Yeah, this is the one that confuses me the most.\nAI: That's totally normal — it confused physicists too! Let's start simple. What do you know about how light behaves?\nUser: Well, sometimes it acts like a wave, like in diffraction. And sometimes like particles, like in the photoelectric effect.\nAI: Excellent recall! Now here's the key question: is light a wave or a particle?\nUser: Both? Neither? It depends on how you observe it?\nAI: You're getting right to the heart of it. The nature of light depends on the experimental setup. This is wave-particle duality.`,
  },
  {
    source: "demo-fixture",
    transcript: `AI: Paul, let's review what we've covered so far. We've discussed superposition, wave-particle duality, and quantum entanglement. Which topic would you like to explore deeper?\nUser: I'd like to understand entanglement better. The idea that two particles can be connected across any distance seems impossible.\nAI: It does seem that way! Einstein called it "spooky action at a distance." Let me ask you this: what happens to one particle when you measure the other?\nUser: If you measure one and it's spin-up, the other immediately becomes spin-down, no matter how far apart they are.\nAI: Right! And this happens instantaneously. Does this violate the speed of light?\nUser: I read that it doesn't because you can't actually send information this way. Is that right?\nAI: Exactly. No usable information travels faster than light. The correlations are real, but they can't be used for faster-than-light communication.`,
  },
  {
    source: "demo-fixture",
    transcript: `AI: Today we're going to apply what you've learned. I'll give you some quantum mechanics problems and we'll work through them together.\nUser: Sounds good. I've been practicing the math.\nAI: Great! First question: A photon passes through a beam splitter that has a 50/50 chance of reflecting or transmitting. Describe the photon's state after the beam splitter.\nUser: It's in a superposition of being reflected and transmitted. So it's kind of in both paths at once.\nAI: Perfect. Now, if we put detectors on both paths, what happens?\nUser: The superposition collapses and we detect the photon on one path or the other, each with 50% probability.\nAI: Excellent work, Paul. Your understanding has really deepened over our sessions.`,
  },
  {
    source: "demo-fixture",
    transcript: `AI: Welcome to our session on the uncertainty principle, Paul.\nUser: Heisenberg's uncertainty principle, right? You can't know both position and momentum precisely at the same time.\nAI: That's the one! But here's a subtle point: this isn't about the limits of our measuring equipment. It's a fundamental property of nature. Why do you think that is?\nUser: Because particles are described by wave functions? And a wave that's spread out in space has well-defined momentum but not position?\nAI: That's a remarkably insightful answer. You're connecting wave mechanics to the uncertainty principle. The more localized a wave packet is, the less certain its momentum becomes. You've really grown in your understanding of quantum mechanics.`,
  },
];

// ── Demo memories ───────────────────────────────────

const DEMO_MEMORIES: Array<{
  category: "FACT" | "PREFERENCE" | "TOPIC" | "CONTEXT";
  source: "EXTRACTED" | "INFERRED";
  key: string;
  value: string;
  confidence: number;
  evidence?: string;
}> = [
  { category: "FACT", source: "EXTRACTED", key: "name", value: "Paul", confidence: 0.95, evidence: "User identified themselves as Paul in first session" },
  { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Prefers analogies and everyday examples to understand abstract concepts", confidence: 0.85, evidence: "Uses coin-spinning analogy for superposition" },
  { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "Quantum mechanics — uncertainty principle", confidence: 0.9, evidence: "Most recent session covered Heisenberg's uncertainty principle" },
  { category: "FACT", source: "EXTRACTED", key: "knowledge_level", value: "Intermediate — understands core concepts, working on mathematical formalism", confidence: 0.8 },
  { category: "PREFERENCE", source: "INFERRED", key: "session_preference", value: "Prefers interactive Q&A over lecture-style teaching", confidence: 0.75 },
  { category: "CONTEXT", source: "EXTRACTED", key: "progress", value: "Covered superposition, wave-particle duality, entanglement, uncertainty principle. Ready for measurement theory.", confidence: 0.9 },
];

// ── Main ────────────────────────────────────────────

export async function main(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();
  console.log("\n=== Seeding Demo Fixtures ===\n");

  // 1. Create/update QM Tutor domain
  const domain = await prisma.domain.upsert({
    where: { slug: "qm-tutor" },
    create: {
      slug: "qm-tutor",
      name: "Quantum Mechanics Tutor",
      description: "An adaptive AI tutor for quantum mechanics concepts — from superposition to entanglement.",
      isActive: true,
    },
    update: {
      name: "Quantum Mechanics Tutor",
      description: "An adaptive AI tutor for quantum mechanics concepts — from superposition to entanglement.",
      isActive: true,
    },
  });
  console.log(`  Domain: ${domain.name} (${domain.slug}) — ${domain.id}`);

  // 2. Create/update caller "Paul"
  const caller = await prisma.caller.upsert({
    where: { externalId: "demo-paul" },
    create: {
      externalId: "demo-paul",
      name: "Paul",
      phone: "+1-555-DEMO-001",
      domainId: domain.id,
    },
    update: {
      name: "Paul",
      domainId: domain.id,
    },
  });
  console.log(`  Caller: ${caller.name} — ${caller.id}`);

  // 3. Upsert personality profile with realistic Big Five + VARK scores
  await prisma.callerPersonalityProfile.upsert({
    where: { callerId: caller.id },
    create: {
      callerId: caller.id,
      parameterValues: {
        "B5-O": 0.82,
        "B5-C": 0.71,
        "B5-E": 0.65,
        "B5-A": 0.78,
        "B5-N": 0.35,
        "VARK-VISUAL": 0.72,
        "VARK-AUDITORY": 0.55,
        "VARK-READWRITE": 0.68,
        "VARK-KINESTHETIC": 0.45,
      },
      callsUsed: 5,
      specsUsed: 2,
      lastUpdatedAt: new Date(),
    },
    update: {
      parameterValues: {
        "B5-O": 0.82,
        "B5-C": 0.71,
        "B5-E": 0.65,
        "B5-A": 0.78,
        "B5-N": 0.35,
        "VARK-VISUAL": 0.72,
        "VARK-AUDITORY": 0.55,
        "VARK-READWRITE": 0.68,
        "VARK-KINESTHETIC": 0.45,
      },
      callsUsed: 5,
      specsUsed: 2,
      lastUpdatedAt: new Date(),
    },
  });
  console.log("  Personality profile created");

  // 4. Create calls (delete existing demo-fixture calls first for idempotency)
  await prisma.call.deleteMany({
    where: { callerId: caller.id, source: "demo-fixture" },
  });

  for (let i = 0; i < DEMO_TRANSCRIPTS.length; i++) {
    const t = DEMO_TRANSCRIPTS[i];
    await prisma.call.create({
      data: {
        source: t.source,
        externalId: `demo-call-${i + 1}`,
        callerId: caller.id,
        transcript: t.transcript,
        // #1344 Slice 4 — `Call.callSequence` dropped; sequencing now lives
        // on the Session row (`learnerFacingNumber`). Demo fixtures don't
        // produce Sessions, so no sequence number is recorded here.
      },
    });
  }
  console.log(`  Calls: ${DEMO_TRANSCRIPTS.length} created`);

  // 5. Create caller memories (delete existing for idempotency)
  await prisma.callerMemory.deleteMany({
    where: { callerId: caller.id, extractedBy: "demo-fixture" },
  });

  for (const mem of DEMO_MEMORIES) {
    await prisma.callerMemory.create({
      data: {
        callerId: caller.id,
        category: mem.category,
        source: mem.source,
        key: mem.key,
        value: mem.value,
        confidence: mem.confidence,
        evidence: mem.evidence,
        extractedBy: "demo-fixture",
      },
    });
  }
  console.log(`  Memories: ${DEMO_MEMORIES.length} created`);

  // 6. Create/update memory summary
  await prisma.callerMemorySummary.upsert({
    where: { callerId: caller.id },
    create: {
      callerId: caller.id,
      factCount: 2,
      preferenceCount: 2,
      eventCount: 0,
      topicCount: 1,
      keyFacts: [
        { key: "name", value: "Paul", confidence: 0.95 },
        { key: "knowledge_level", value: "Intermediate", confidence: 0.8 },
      ],
      topTopics: [
        { topic: "Quantum mechanics", frequency: 5, lastMentioned: new Date().toISOString() },
        { topic: "Superposition", frequency: 3, lastMentioned: new Date().toISOString() },
        { topic: "Entanglement", frequency: 2, lastMentioned: new Date().toISOString() },
      ],
      preferences: {
        learningStyle: "analogies and everyday examples",
        sessionType: "interactive Q&A",
      },
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
    update: {
      factCount: 2,
      preferenceCount: 2,
      topicCount: 1,
      keyFacts: [
        { key: "name", value: "Paul", confidence: 0.95 },
        { key: "knowledge_level", value: "Intermediate", confidence: 0.8 },
      ],
      topTopics: [
        { topic: "Quantum mechanics", frequency: 5, lastMentioned: new Date().toISOString() },
        { topic: "Superposition", frequency: 3, lastMentioned: new Date().toISOString() },
        { topic: "Entanglement", frequency: 2, lastMentioned: new Date().toISOString() },
      ],
      preferences: {
        learningStyle: "analogies and everyday examples",
        sessionType: "interactive Q&A",
      },
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
  });
  console.log("  Memory summary created");

  // 7. Create a published playbook for the domain (if specs exist)
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { specRole: "IDENTITY" },
  });
  const extractSpecs = await prisma.analysisSpec.findMany({
    where: { specRole: "EXTRACT" },
    take: 2,
  });

  if (identitySpec) {
    // Check for existing demo playbook
    let playbook = await prisma.playbook.findFirst({
      where: { domainId: domain.id, name: "QM Adaptive v1" },
    });

    if (!playbook) {
      playbook = await prisma.playbook.create({
        data: {
          name: "QM Adaptive v1",
          description: "Adaptive playbook for the Quantum Mechanics Tutor — identity + personality measurement",
          domainId: domain.id,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

      // Add identity spec
      await prisma.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: identitySpec.id,
          sortOrder: 0,
          groupLabel: "Identity",
        },
      });

      // Add measurement specs
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

  // 8. Set demo capture defaults in SystemSettings
  const demoSettings = [
    { key: "demo.default_caller", value: "Paul" },
    { key: "demo.default_domain", value: "qm-tutor" },
    { key: "demo.default_spec", value: "" },
  ];

  for (const s of demoSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: JSON.stringify(s.value) },
      update: { value: JSON.stringify(s.value) },
    });
  }
  console.log("  SystemSettings: demo defaults saved");

  console.log("\n=== Demo Fixtures Complete ===\n");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("Seed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
