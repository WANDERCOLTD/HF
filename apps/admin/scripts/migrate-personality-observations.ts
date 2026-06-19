/**
 * Data Migration: PersonalityObservation OCEAN → parameterValues
 *
 * Migrates PersonalityObservation records from hardcoded OCEAN fields
 * to dynamic parameterValues JSON field.
 *
 * Run: npx tsx scripts/migrate-personality-observations.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Migrating PersonalityObservation data to parameterValues...\n");

  // Get all observations with OCEAN values
  const observations = await prisma.personalityObservation.findMany({
    where: {
      OR: [
        { openness: { not: null } },
        { conscientiousness: { not: null } },
        { extraversion: { not: null } },
        { agreeableness: { not: null } },
        { neuroticism: { not: null } },
      ],
    },
    select: {
      id: true,
      openness: true,
      conscientiousness: true,
      extraversion: true,
      agreeableness: true,
      neuroticism: true,
      parameterValues: true,
    },
  });

  console.log(`Found ${observations.length} observations with OCEAN data`);

  let migrated = 0;
  let skipped = 0;

  for (const obs of observations) {
    // Build parameterValues from OCEAN fields
    const parameterValues: Record<string, number> = {};

    if (obs.openness !== null) parameterValues["BEH-B5-O"] = obs.openness;
    if (obs.conscientiousness !== null) parameterValues["BEH-B5-C"] = obs.conscientiousness;
    if (obs.extraversion !== null) parameterValues["BEH-B5-E"] = obs.extraversion;
    if (obs.agreeableness !== null) parameterValues["BEH-B5-A"] = obs.agreeableness;
    if (obs.neuroticism !== null) parameterValues["BEH-B5-N"] = obs.neuroticism;

    // Check if already migrated
    const existing = obs.parameterValues as Record<string, number> | null;
    if (existing && Object.keys(existing).length > 0) {
      skipped++;
      continue;
    }

    // Update to use parameterValues
    await prisma.personalityObservation.update({
      where: { id: obs.id },
      data: { parameterValues },
    });

    migrated++;

    if (migrated % 100 === 0) {
      console.log(`  Migrated ${migrated} observations...`);
    }
  }

  console.log(`\n✅ Migration complete!`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Skipped (already migrated): ${skipped}`);
  console.log(`   Total: ${observations.length}`);
}

main()
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
