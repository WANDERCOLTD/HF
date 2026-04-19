/**
 * Golden Path Seed — Foundation
 *
 * Creates the Abacus Academy institution and domain with identity spec
 * and onboarding defaults. This is the structural foundation that
 * seed-demo-course.ts builds on.
 *
 * Creates:
 *   1 institution: Abacus Academy (school type)
 *   1 domain: abacus-academy with identity spec + onboarding flow
 *   SUPERADMIN linked to Abacus Academy (for demo flow)
 *
 * All entities tagged with "golden-" externalId prefix for idempotent cleanup.
 * Non-PROD only — refuses to run when NEXT_PUBLIC_APP_ENV=LIVE.
 *
 * Usage:
 *   SEED_PROFILE=golden npx tsx prisma/seed-full.ts --reset
 *   npx tsx prisma/seed-golden.ts          # standalone
 */

import { PrismaClient } from "@prisma/client";

const TAG = "golden-";

// ── Default onboarding flow phases ──
const DEFAULT_FLOW_PHASES = [
  { phase: "greeting", label: "Greeting & welcome" },
  { phase: "rapport", label: "Build rapport" },
  { phase: "assessment", label: "Quick assessment" },
  { phase: "teaching", label: "Teaching interaction" },
  { phase: "summary", label: "Session summary" },
];

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

export async function main(externalPrisma?: PrismaClient, opts?: { skipCleanup?: boolean }): Promise<void> {
  // PROD guard
  const env = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;
  if (env === "LIVE" || env === "production") {
    console.log("  ⛔ Skipping golden seed — PROD environment detected");
    return;
  }

  const prisma = externalPrisma || new PrismaClient();

  console.log("\n  🌟 Seeding Golden Path foundation...\n");

  // ── 1. Cleanup existing golden callers (FK-safe order) ──
  if (!opts?.skipCleanup) {
    const existingCallers = await prisma.caller.findMany({
      where: { externalId: { startsWith: TAG } },
      select: { id: true },
    });
    const callerIds = existingCallers.map((c) => c.id);

    if (callerIds.length > 0) {
      await prisma.callerModuleProgress.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.composedPrompt.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.goal.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerMemory.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerMemorySummary.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerPersonalityProfile.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callScore.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.onboardingSession.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.call.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerPlaybook.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerCohortMembership.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.caller.deleteMany({ where: { id: { in: callerIds } } });
      console.log(`    Cleaned up ${callerIds.length} previous golden callers`);
    }
  }

  // ── 2. Find institution type ──
  const instType = await prisma.institutionType.findUnique({
    where: { slug: "school" },
  });
  if (!instType) {
    console.warn("  ⚠ Institution type 'school' not found — run seed-institution-types first");
    if (!externalPrisma) await prisma.$disconnect();
    return;
  }

  // ── 3. Create institution ──
  const institution = await prisma.institution.upsert({
    where: { slug: "abacus-academy" },
    update: {
      name: "Abacus Academy",
      typeId: instType.id,
      primaryColor: "#166534",
      secondaryColor: "#ca8a04",
      welcomeMessage: "Welcome to Abacus Academy! Our AI tutors help every student build confidence and understanding.",
    },
    create: {
      name: "Abacus Academy",
      slug: "abacus-academy",
      typeId: instType.id,
      primaryColor: "#166534",
      secondaryColor: "#ca8a04",
      welcomeMessage: "Welcome to Abacus Academy! Our AI tutors help every student build confidence and understanding.",
    },
  });
  console.log(`    + Institution: ${institution.name}`);

  // ── 4. Create domain ──
  const domain = await prisma.domain.upsert({
    where: { slug: "abacus-academy" },
    update: {
      name: "Abacus Academy",
      description: "Secondary school with focus on student-centred learning and AI-assisted tutoring.",
      institutionId: institution.id,
      isActive: true,
    },
    create: {
      slug: "abacus-academy",
      name: "Abacus Academy",
      description: "Secondary school with focus on student-centred learning and AI-assisted tutoring.",
      isActive: true,
      institutionId: institution.id,
    },
  });
  console.log(`    + Domain: ${domain.name}`);

  // ── 5. Create identity spec ──
  const archetypeSlug = instType.defaultArchetypeSlug || "TUT-001";
  const identitySlug = "abacus-academy-identity";

  const identitySpec = await prisma.analysisSpec.upsert({
    where: { slug: identitySlug },
    update: {
      name: "Abacus Academy Identity",
      extendsAgent: archetypeSlug,
      isActive: true,
    },
    create: {
      slug: identitySlug,
      name: "Abacus Academy Identity",
      description: "Domain overlay for Abacus Academy — extends the base tutor archetype.",
      outputType: "COMPOSE",
      specRole: "IDENTITY",
      specType: "DOMAIN",
      domain: "identity",
      scope: "DOMAIN",
      isActive: true,
      isDirty: false,
      isDeletable: true,
      extendsAgent: archetypeSlug,
      config: {
        parameters: [
          {
            id: "tutor_role",
            name: "Domain Role Override",
            section: "identity",
            config: {
              roleStatement: "You are a friendly, patient tutor specializing in Abacus Academy. You adapt to each learner's pace and style while maintaining high standards for understanding.",
              primaryGoal: "Help learners build genuine understanding of their subject",
            },
          },
        ],
      },
      triggers: {
        create: [
          {
            given: "An Abacus Academy session",
            when: "The system needs to establish agent identity and tone",
            then: "A consistent, domain-appropriate tutor personality is presented",
            name: "Identity establishment",
            sortOrder: 0,
          },
        ],
      },
    },
  });
  console.log(`    + Identity spec: ${identitySpec.slug}`);

  // ── 6. Configure onboarding on domain ──
  await prisma.domain.update({
    where: { id: domain.id },
    data: {
      onboardingIdentitySpecId: identitySpec.id,
      onboardingFlowPhases: DEFAULT_FLOW_PHASES,
    },
  });
  console.log("    + Onboarding flow phases configured");

  // ── 7. Link SUPERADMIN to Abacus Academy ──
  // SUPERADMIN needs institutionId so the wizard loads with full context
  await prisma.user.updateMany({
    where: { role: "SUPERADMIN" },
    data: { institutionId: institution.id },
  });
  console.log("    + SUPERADMIN linked to Abacus Academy");

  // ── Summary ──
  console.log("\n  ✓ Golden Path foundation complete");
  console.log("    1 institution, 1 domain, 1 identity spec\n");

  if (!externalPrisma) {
    await prisma.$disconnect();
  }
}

// Direct execution
if (require.main === module) {
  main().catch((e) => {
    console.error("Golden seed failed:", e);
    process.exit(1);
  });
}
