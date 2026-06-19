/**
 * Data Migration: CallerPersonality OCEAN → parameterValues
 *
 * Migrates CallerPersonality records from hardcoded OCEAN fields
 * to dynamic parameterValues JSON field.
 *
 * Run: npx tsx scripts/migrate-caller-personality.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Migrating CallerPersonality data to parameterValues...\n");

  // Get all caller personalities with OCEAN values
  const personalities = await prisma.callerPersonality.findMany({
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

  console.log(`Found ${personalities.length} personalities with OCEAN data`);

  let migrated = 0;
  let skipped = 0;

  for (const personality of personalities) {
    // Build parameterValues from OCEAN fields
    const parameterValues: Record<string, number> = {};

    if (personality.openness !== null) parameterValues["BEH-B5-O"] = personality.openness;
    if (personality.conscientiousness !== null) parameterValues["BEH-B5-C"] = personality.conscientiousness;
    if (personality.extraversion !== null) parameterValues["BEH-B5-E"] = personality.extraversion;
    if (personality.agreeableness !== null) parameterValues["BEH-B5-A"] = personality.agreeableness;
    if (personality.neuroticism !== null) parameterValues["BEH-B5-N"] = personality.neuroticism;

    // Check if already migrated
    const existing = personality.parameterValues as Record<string, number> | null;
    if (existing && Object.keys(existing).length > 0) {
      skipped++;
      continue;
    }

    // Update to use parameterValues
    await prisma.callerPersonality.update({
      where: { id: personality.id },
      data: { parameterValues },
    });

    migrated++;

    if (migrated % 100 === 0) {
      console.log(`  Migrated ${migrated} personalities...`);
    }
  }

  console.log(`\n✅ Migration complete!`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Skipped (already migrated): ${skipped}`);
  console.log(`   Total: ${personalities.length}`);
}

main()
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
