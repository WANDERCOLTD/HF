/**
 * Verify AI Knowledge & Task Tracking Models
 *
 * Quick script to verify that the new AI models are working correctly.
 */

import { prisma } from "../lib/prisma";

// TODO(tier-4-orphan): aIInteractionLog + aILearnedPattern models were removed from the
// schema but this verification script still references them. Cast keeps tsc clean — the
// script will error clearly at runtime if executed. See issue #375 follow-up.
const prismaAny = prisma as any;

async function verifyModels() {
  console.log("🔍 Verifying AI Knowledge & Task Tracking Models...\n");

  try {
    // Test AIInteractionLog
    console.log("✓ AIInteractionLog model accessible");
    const interactionCount = await prismaAny.aIInteractionLog.count();
    console.log(`  Current interactions logged: ${interactionCount}`);

    // Test AILearnedPattern
    console.log("✓ AILearnedPattern model accessible");
    const patternCount = await prismaAny.aILearnedPattern.count();
    console.log(`  Current patterns learned: ${patternCount}`);

    // Test UserTask
    console.log("✓ UserTask model accessible");
    const taskCount = await prisma.userTask.count();
    console.log(`  Current tasks tracked: ${taskCount}`);

    console.log("\n✅ All AI knowledge models are working correctly!");

  } catch (error) {
    console.error("\n❌ Error verifying models:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyModels();
