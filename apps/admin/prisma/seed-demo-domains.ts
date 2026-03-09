/**
 * Seed Demo Data for Professional Domains
 *
 * Creates realistic callers and playbooks for each seeded domain.
 * Idempotent — safe to run repeatedly (uses upsert/check-first patterns).
 *
 * Per domain:
 *   - 3 callers with names, emails, personality profiles, memories
 *   - 1 published playbook with identity + measurement specs
 *
 * Prerequisites:
 *   - seed-clean.ts run (specs must exist)
 *   - seed-domains.ts run (4 professional domains)
 *
 * Usage:
 *   npx tsx prisma/seed-demo-domains.ts
 */

import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

// ── Domain-specific demo data ────────────────────────

interface DemoCallerDef {
  externalId: string;
  name: string;
  email: string;
  phone: string;
  personality: Record<string, number>;
  memories: Array<{
    category: "FACT" | "PREFERENCE" | "TOPIC" | "CONTEXT";
    source: "EXTRACTED" | "INFERRED";
    key: string;
    value: string;
    confidence: number;
  }>;
}

interface DomainDemoData {
  slug: string;
  playbookName: string;
  playbookDescription: string;
  callers: DemoCallerDef[];
}

const DOMAIN_DEMOS: DomainDemoData[] = [
  {
    slug: "meridian-academy",
    playbookName: "Meridian Adaptive Learning v1",
    playbookDescription: "Adaptive K-12 tutoring — identity, personality measurement, and learning style detection.",
    callers: [
      {
        externalId: "demo-meridian-sophie",
        name: "Sophie Chen",
        email: "sophie.chen@example.com",
        phone: "+44-7700-100001",
        personality: { "B5-O": 0.78, "B5-C": 0.65, "B5-E": 0.72, "B5-A": 0.85, "B5-N": 0.30, "VARK-VISUAL": 0.80, "VARK-AUDITORY": 0.45, "VARK-READWRITE": 0.70, "VARK-KINESTHETIC": 0.55 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "year_group", value: "Year 9", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Visual learner — prefers diagrams and colour-coded notes", confidence: 0.85 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "Algebra — simultaneous equations", confidence: 0.9 },
        ],
      },
      {
        externalId: "demo-meridian-james",
        name: "James Okafor",
        email: "james.okafor@example.com",
        phone: "+44-7700-100002",
        personality: { "B5-O": 0.60, "B5-C": 0.82, "B5-E": 0.55, "B5-A": 0.70, "B5-N": 0.45, "VARK-VISUAL": 0.50, "VARK-AUDITORY": 0.75, "VARK-READWRITE": 0.80, "VARK-KINESTHETIC": 0.40 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "year_group", value: "Year 11", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Read/write learner — likes structured notes and bullet points", confidence: 0.80 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "GCSE Biology — cell division", confidence: 0.9 },
        ],
      },
      {
        externalId: "demo-meridian-aisha",
        name: "Aisha Patel",
        email: "aisha.patel@example.com",
        phone: "+44-7700-100003",
        personality: { "B5-O": 0.88, "B5-C": 0.55, "B5-E": 0.80, "B5-A": 0.75, "B5-N": 0.25, "VARK-VISUAL": 0.65, "VARK-AUDITORY": 0.60, "VARK-READWRITE": 0.55, "VARK-KINESTHETIC": 0.85 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "year_group", value: "Year 7", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Kinaesthetic learner — engages best through hands-on activities", confidence: 0.82 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "Creative writing — narrative structure", confidence: 0.88 },
        ],
      },
    ],
  },
  {
    slug: "northbridge-business-school",
    playbookName: "Executive Coaching v1",
    playbookDescription: "Leadership development and communication skills coaching for corporate professionals.",
    callers: [
      {
        externalId: "demo-northbridge-david",
        name: "David Armstrong",
        email: "d.armstrong@techcorp.io",
        phone: "+44-7700-200001",
        personality: { "B5-O": 0.70, "B5-C": 0.90, "B5-E": 0.82, "B5-A": 0.60, "B5-N": 0.35, "VARK-VISUAL": 0.55, "VARK-AUDITORY": 0.70, "VARK-READWRITE": 0.85, "VARK-KINESTHETIC": 0.40 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "role", value: "VP Engineering at TechCorp", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "coaching_style", value: "Prefers data-driven frameworks and measurable outcomes", confidence: 0.85 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_focus", value: "Delegation and team empowerment", confidence: 0.88 },
        ],
      },
      {
        externalId: "demo-northbridge-maria",
        name: "Maria Santos",
        email: "maria.santos@globalfin.com",
        phone: "+44-7700-200002",
        personality: { "B5-O": 0.85, "B5-C": 0.75, "B5-E": 0.70, "B5-A": 0.80, "B5-N": 0.30, "VARK-VISUAL": 0.60, "VARK-AUDITORY": 0.80, "VARK-READWRITE": 0.70, "VARK-KINESTHETIC": 0.50 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "role", value: "Head of Product at GlobalFin", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "coaching_style", value: "Responds well to storytelling and case studies", confidence: 0.82 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_focus", value: "Stakeholder communication and influence", confidence: 0.90 },
        ],
      },
      {
        externalId: "demo-northbridge-tom",
        name: "Tom Eriksson",
        email: "tom.eriksson@nordichealth.se",
        phone: "+44-7700-200003",
        personality: { "B5-O": 0.65, "B5-C": 0.85, "B5-E": 0.50, "B5-A": 0.88, "B5-N": 0.40, "VARK-VISUAL": 0.75, "VARK-AUDITORY": 0.55, "VARK-READWRITE": 0.65, "VARK-KINESTHETIC": 0.60 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "role", value: "CTO at NordicHealth", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "coaching_style", value: "Analytical — likes whiteboard exercises and visual mapping", confidence: 0.80 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_focus", value: "Conflict resolution in cross-functional teams", confidence: 0.85 },
        ],
      },
    ],
  },
  {
    slug: "wellspring-institute",
    playbookName: "Resilience Programme v1",
    playbookDescription: "Wellness coaching and resilience building through guided conversational practice.",
    callers: [
      {
        externalId: "demo-wellspring-emma",
        name: "Emma Richardson",
        email: "emma.r@wellnessorg.uk",
        phone: "+44-7700-300001",
        personality: { "B5-O": 0.75, "B5-C": 0.60, "B5-E": 0.55, "B5-A": 0.90, "B5-N": 0.50, "VARK-VISUAL": 0.55, "VARK-AUDITORY": 0.85, "VARK-READWRITE": 0.60, "VARK-KINESTHETIC": 0.70 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "background", value: "Primary school teacher, 8 years", confidence: 0.90 },
          { category: "PREFERENCE", source: "INFERRED", key: "approach", value: "Responds well to reflective journalling prompts", confidence: 0.82 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_focus", value: "Stress management and work-life boundaries", confidence: 0.88 },
        ],
      },
      {
        externalId: "demo-wellspring-michael",
        name: "Michael Torres",
        email: "m.torres@example.com",
        phone: "+44-7700-300002",
        personality: { "B5-O": 0.60, "B5-C": 0.55, "B5-E": 0.65, "B5-A": 0.70, "B5-N": 0.60, "VARK-VISUAL": 0.70, "VARK-AUDITORY": 0.65, "VARK-READWRITE": 0.50, "VARK-KINESTHETIC": 0.75 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "background", value: "Software developer, career transition", confidence: 0.88 },
          { category: "PREFERENCE", source: "INFERRED", key: "approach", value: "Prefers structured exercises with clear steps", confidence: 0.78 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_focus", value: "Building confidence through career change", confidence: 0.85 },
        ],
      },
      {
        externalId: "demo-wellspring-priya",
        name: "Priya Sharma",
        email: "priya.sharma@nhs.net",
        phone: "+44-7700-300003",
        personality: { "B5-O": 0.82, "B5-C": 0.78, "B5-E": 0.72, "B5-A": 0.85, "B5-N": 0.35, "VARK-VISUAL": 0.60, "VARK-AUDITORY": 0.75, "VARK-READWRITE": 0.80, "VARK-KINESTHETIC": 0.50 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "background", value: "NHS nurse, 12 years", confidence: 0.92 },
          { category: "PREFERENCE", source: "INFERRED", key: "approach", value: "Values evidence-based approaches to wellbeing", confidence: 0.85 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_focus", value: "Compassion fatigue and burnout prevention", confidence: 0.90 },
        ],
      },
    ],
  },
  {
    slug: "harbour-languages",
    playbookName: "Conversational Immersion v1",
    playbookDescription: "Language acquisition through adaptive conversational practice and vocabulary building.",
    callers: [
      {
        externalId: "demo-harbour-oliver",
        name: "Oliver Dubois",
        email: "oliver.dubois@example.com",
        phone: "+44-7700-400001",
        personality: { "B5-O": 0.90, "B5-C": 0.65, "B5-E": 0.85, "B5-A": 0.75, "B5-N": 0.20, "VARK-VISUAL": 0.55, "VARK-AUDITORY": 0.90, "VARK-READWRITE": 0.60, "VARK-KINESTHETIC": 0.65 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "target_language", value: "French (B1 level)", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Auditory learner — prefers conversation practice over grammar drills", confidence: 0.88 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "Past tenses — passé composé vs imparfait", confidence: 0.85 },
        ],
      },
      {
        externalId: "demo-harbour-yuki",
        name: "Yuki Tanaka",
        email: "yuki.tanaka@example.com",
        phone: "+44-7700-400002",
        personality: { "B5-O": 0.72, "B5-C": 0.88, "B5-E": 0.50, "B5-A": 0.80, "B5-N": 0.38, "VARK-VISUAL": 0.80, "VARK-AUDITORY": 0.55, "VARK-READWRITE": 0.85, "VARK-KINESTHETIC": 0.40 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "target_language", value: "Spanish (A2 level)", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Visual learner — benefits from written examples and flashcards", confidence: 0.82 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "Travel vocabulary and directions", confidence: 0.88 },
        ],
      },
      {
        externalId: "demo-harbour-sarah",
        name: "Sarah Williams",
        email: "sarah.w@example.com",
        phone: "+44-7700-400003",
        personality: { "B5-O": 0.80, "B5-C": 0.70, "B5-E": 0.78, "B5-A": 0.82, "B5-N": 0.28, "VARK-VISUAL": 0.65, "VARK-AUDITORY": 0.78, "VARK-READWRITE": 0.72, "VARK-KINESTHETIC": 0.58 },
        memories: [
          { category: "FACT", source: "EXTRACTED", key: "target_language", value: "German (B2 level)", confidence: 0.95 },
          { category: "PREFERENCE", source: "INFERRED", key: "learning_style", value: "Balanced learner — enjoys debate topics and cultural discussions", confidence: 0.85 },
          { category: "TOPIC", source: "EXTRACTED", key: "current_topic", value: "Konjunktiv II — subjunctive mood for hypotheticals", confidence: 0.82 },
        ],
      },
    ],
  },
];

// ── Single-domain seeder (used by domain reset API) ──

/**
 * Seed demo data for a single domain by slug.
 * Extracted from main() for use by the domain reset API.
 *
 * @returns true if seeded, false if slug not found in DOMAIN_DEMOS
 */
export async function seedSingleDomain(slug: string, externalPrisma: PrismaClient): Promise<boolean> {
  const client = externalPrisma;
  const domainData = DOMAIN_DEMOS.find((d) => d.slug === slug);
  if (!domainData) return false;

  const domain = await client.domain.findUnique({ where: { slug } });
  if (!domain) return false;

  const identitySpec = await client.analysisSpec.findFirst({ where: { specRole: "IDENTITY" } });
  const extractSpecs = await client.analysisSpec.findMany({ where: { specRole: "EXTRACT" }, take: 3, orderBy: { slug: "asc" } });
  const synthesiseSpecs = await client.analysisSpec.findMany({ where: { specRole: "SYNTHESISE" }, take: 2, orderBy: { slug: "asc" } });

  if (!identitySpec) return false;

  await seedDomainData(client, domain, domainData, identitySpec, extractSpecs, synthesiseSpecs);
  return true;
}

// ── Shared per-domain seeding logic ──────────────────

async function seedDomainData(
  client: PrismaClient,
  domain: { id: string; name: string },
  domainData: DomainDemoData,
  identitySpec: { id: string },
  extractSpecs: Array<{ id: string }>,
  synthesiseSpecs: Array<{ id: string }>,
) {
  console.log(`  Domain: ${domain.name}`);

  // ── Create callers ──
  for (const callerDef of domainData.callers) {
    const caller = await client.caller.upsert({
      where: { externalId: callerDef.externalId },
      create: {
        externalId: callerDef.externalId,
        name: callerDef.name,
        email: callerDef.email,
        phone: callerDef.phone,
        domainId: domain.id,
      },
      update: {
        name: callerDef.name,
        email: callerDef.email,
        domainId: domain.id,
      },
    });

    // Personality profile
    await client.callerPersonalityProfile.upsert({
      where: { callerId: caller.id },
      create: {
        callerId: caller.id,
        parameterValues: callerDef.personality,
        callsUsed: 3,
        specsUsed: 2,
        lastUpdatedAt: new Date(),
      },
      update: {
        parameterValues: callerDef.personality,
        callsUsed: 3,
        specsUsed: 2,
        lastUpdatedAt: new Date(),
      },
    });

    // Memories
    await client.callerMemory.deleteMany({
      where: { callerId: caller.id, extractedBy: "demo-domain-seed" },
    });
    for (const mem of callerDef.memories) {
      await client.callerMemory.create({
        data: {
          callerId: caller.id,
          category: mem.category,
          source: mem.source,
          key: mem.key,
          value: mem.value,
          confidence: mem.confidence,
          extractedBy: "demo-domain-seed",
        },
      });
    }

    // Memory summary
    const facts = callerDef.memories
      .filter((m) => m.category === "FACT")
      .map((m) => ({ key: m.key, value: m.value, confidence: m.confidence }));
    const topics = callerDef.memories
      .filter((m) => m.category === "TOPIC")
      .map((m) => ({ topic: m.value, frequency: 3, lastMentioned: new Date().toISOString() }));

    await client.callerMemorySummary.upsert({
      where: { callerId: caller.id },
      create: {
        callerId: caller.id,
        factCount: facts.length,
        preferenceCount: callerDef.memories.filter((m) => m.category === "PREFERENCE").length,
        eventCount: 0,
        topicCount: topics.length,
        keyFacts: facts,
        topTopics: topics,
        lastMemoryAt: new Date(),
        lastAggregatedAt: new Date(),
      },
      update: {
        factCount: facts.length,
        topicCount: topics.length,
        keyFacts: facts,
        topTopics: topics,
        lastMemoryAt: new Date(),
        lastAggregatedAt: new Date(),
      },
    });

    console.log(`    Caller: ${caller.name} (${callerDef.email})`);
  }

  // ── Create or reuse playbook (idempotent) ──
  let playbook = await client.playbook.findFirst({
    where: { domainId: domain.id, name: domainData.playbookName },
  });

  if (playbook) {
    // Ensure it's published
    if (playbook.status !== "PUBLISHED") {
      playbook = await client.playbook.update({
        where: { id: playbook.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
    }
  } else {
    // Archive any existing published playbooks for this domain
    await client.playbook.updateMany({
      where: { domainId: domain.id, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    });

    playbook = await client.playbook.create({
      data: {
        name: domainData.playbookName,
        description: domainData.playbookDescription,
        domainId: domain.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  // Add specs (skip if playbook already has items — idempotent)
  const existingItems = await client.playbookItem.count({ where: { playbookId: playbook.id } });
  if (existingItems === 0) {
    let sortOrder = 0;

    await client.playbookItem.create({
      data: {
        playbookId: playbook.id,
        itemType: "SPEC",
        specId: identitySpec.id,
        sortOrder: sortOrder++,
        groupLabel: "Identity",
      },
    });

    for (const spec of extractSpecs) {
      await client.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: spec.id,
          sortOrder: sortOrder++,
          groupLabel: "Measurement",
        },
      });
    }

    for (const spec of synthesiseSpecs) {
      await client.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: spec.id,
          sortOrder: sortOrder++,
          groupLabel: "Synthesis",
        },
      });
    }
  }

  const itemCount = await client.playbookItem.count({ where: { playbookId: playbook.id } });
  console.log(`    Playbook: ${playbook.name} (PUBLISHED, ${itemCount} specs)`);
  console.log("");
}

// ── Main ────────────────────────────────────────────

export async function main(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();
  console.log("\n=== Seeding Demo Data for Professional Domains ===\n");

  // Find specs for playbook items
  const identitySpec = await prisma.analysisSpec.findFirst({
    where: { specRole: "IDENTITY" },
  });
  const extractSpecs = await prisma.analysisSpec.findMany({
    where: { specRole: "EXTRACT" },
    take: 3,
    orderBy: { slug: "asc" },
  });
  const synthesiseSpecs = await prisma.analysisSpec.findMany({
    where: { specRole: "SYNTHESISE" },
    take: 2,
    orderBy: { slug: "asc" },
  });

  if (!identitySpec) {
    console.log("  No IDENTITY spec found — run seed-clean.ts first");
    return;
  }

  console.log(`  Found ${1 + extractSpecs.length + synthesiseSpecs.length} specs for playbooks\n`);

  for (const domainData of DOMAIN_DEMOS) {
    const domain = await prisma.domain.findUnique({
      where: { slug: domainData.slug },
    });

    if (!domain) {
      console.log(`  SKIP: Domain "${domainData.slug}" not found`);
      continue;
    }

    await seedDomainData(prisma, domain, domainData, identitySpec, extractSpecs, synthesiseSpecs);
  }

  // Summary
  const callerCount = await prisma.caller.count({ where: { externalId: { startsWith: "demo-" } } });
  const playbookCount = await prisma.playbook.count({ where: { status: "PUBLISHED" } });
  console.log(`=== Done: ${callerCount} demo callers, ${playbookCount} published playbooks ===\n`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("Seed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
