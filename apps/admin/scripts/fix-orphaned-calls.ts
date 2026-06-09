/**
 * Fix orphaned calls by creating callers for them based on externalId pattern
 *
 * Run with: npx tsx scripts/fix-orphaned-calls.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n🔧 FIXING ORPHANED CALLS\n");
  console.log("━".repeat(60));

  // Get all orphaned calls (no callerId)
  const orphanedCalls = await prisma.call.findMany({
    where: { callerId: null },
    select: { id: true, externalId: true, source: true, createdAt: true },
  });

  console.log(`Found ${orphanedCalls.length} orphaned calls\n`);

  if (orphanedCalls.length === 0) {
    console.log("No orphaned calls to fix.");
    return;
  }

  // Get the Mabel domain for new callers
  const domain = await prisma.domain.findUnique({ where: { slug: "mabel" } });

  // Group calls by externalId prefix (assuming VAPI format)
  const callGroups = new Map<string, typeof orphanedCalls>();

  for (const call of orphanedCalls) {
    // Use first 8 chars of externalId as a pseudo caller identifier
    const groupKey = call.externalId?.slice(0, 8) || `unknown-${call.id.slice(0, 8)}`;
    const existing = callGroups.get(groupKey) || [];
    existing.push(call);
    callGroups.set(groupKey, existing);
  }

  console.log(`Grouped into ${callGroups.size} pseudo-callers\n`);

  let callersCreated = 0;
  let callsLinked = 0;

  // Create a single "Imported Calls" caller for all orphaned calls
  // OR create one caller per group - here we'll create one per group for better organization

  for (const [groupKey, calls] of callGroups) {
    // Sort calls by createdAt
    calls.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // Create a caller for this group
    const caller = await prisma.caller.create({
      data: {
        name: `Imported Caller ${groupKey}`,
        domainId: domain?.id,
        externalId: `orphan-fix-${groupKey}`,
      },
    });
    callersCreated++;

    // Link all calls in this group to the caller
    // #1344 Slice 4 — `Call.callSequence` dropped; sequencing lives on
    // `Session.learnerFacingNumber`. Orphan-call recovery now only sets
    // the caller link and the previousCallId chain.
    let previousCallId: string | null = null;

    for (const call of calls) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          callerId: caller.id,
          previousCallId,
        },
      });
      callsLinked++;
      previousCallId = call.id;
    }

    console.log(`   ✓ Created caller "${caller.name}" with ${calls.length} calls`);
  }

  console.log(`\n✅ Done!`);
  console.log(`   Created ${callersCreated} callers`);
  console.log(`   Linked ${callsLinked} calls\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
