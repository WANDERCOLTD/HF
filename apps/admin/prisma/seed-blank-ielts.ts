/**
 * Blank IELTS Seed — Foundation only, no courses, no callers
 *
 * Creates the "IELTS Prep Lab" institution + matching domain and links all
 * existing SUPERADMIN users to it. Intended for the partner-test environment:
 * teachers log in, see one clean institution, and build courses from scratch
 * via the wizard.
 *
 * Creates:
 *   1 institution: "IELTS Prep Lab" (school type, slug: ielts-prep-lab)
 *   1 domain:      "IELTS Prep Lab" (slug: ielts-prep-lab)
 *   SUPERADMIN users linked (institutionId + activeInstitutionId)
 *
 * Does NOT create: playbooks, curricula, callers, demo content.
 *
 * Non-PROD only — refuses to run when NEXT_PUBLIC_APP_ENV=LIVE.
 *
 * Usage:
 *   SEED_PROFILE=blank-ielts npx tsx prisma/seed-full.ts --reset
 *   npx tsx prisma/seed-blank-ielts.ts          # standalone
 */

import { PrismaClient } from "@prisma/client";

const INSTITUTION_NAME = "IELTS Prep Lab";
const INSTITUTION_SLUG = "ielts-prep-lab";

const DEFAULT_FLOW_PHASES = [
  { phase: "greeting", label: "Greeting & welcome" },
  { phase: "rapport", label: "Build rapport" },
  { phase: "assessment", label: "Quick assessment" },
  { phase: "teaching", label: "Teaching interaction" },
  { phase: "summary", label: "Session summary" },
];

export async function main(externalPrisma?: PrismaClient): Promise<void> {
  const env = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;
  if (env === "LIVE" || env === "production") {
    console.log("  ⛔ Skipping blank-ielts seed — PROD environment detected");
    return;
  }

  const prisma = externalPrisma || new PrismaClient();

  console.log(`\n  🧪 Seeding blank ${INSTITUTION_NAME} foundation...\n`);

  const instType = await prisma.institutionType.findUnique({ where: { slug: "school" } });
  if (!instType) {
    console.warn("  ⚠ Institution type 'school' not found — run seed-institution-types first");
    if (!externalPrisma) await prisma.$disconnect();
    return;
  }

  const institution = await prisma.institution.upsert({
    where: { slug: INSTITUTION_SLUG },
    update: {
      name: INSTITUTION_NAME,
      typeId: instType.id,
      welcomeMessage:
        `Welcome to ${INSTITUTION_NAME}! Build a course, invite learners, and watch them progress.`,
    },
    create: {
      name: INSTITUTION_NAME,
      slug: INSTITUTION_SLUG,
      typeId: instType.id,
      primaryColor: "#1F1B4A",
      secondaryColor: "#F5B856",
      welcomeMessage:
        `Welcome to ${INSTITUTION_NAME}! Build a course, invite learners, and watch them progress.`,
    },
  });
  console.log(`    + Institution: ${institution.name}`);

  const domain = await prisma.domain.upsert({
    where: { slug: INSTITUTION_SLUG },
    update: {
      name: INSTITUTION_NAME,
      description: "IELTS Speaking preparation — Parts 1, 2, 3 and full mock exam.",
      institutionId: institution.id,
      isActive: true,
      onboardingFlowPhases: DEFAULT_FLOW_PHASES,
    },
    create: {
      slug: INSTITUTION_SLUG,
      name: INSTITUTION_NAME,
      description: "IELTS Speaking preparation — Parts 1, 2, 3 and full mock exam.",
      isActive: true,
      institutionId: institution.id,
      onboardingFlowPhases: DEFAULT_FLOW_PHASES,
    },
  });
  console.log(`    + Domain: ${domain.name}`);

  const linkCount = await prisma.user.updateMany({
    where: { role: "SUPERADMIN" },
    data: { institutionId: institution.id, activeInstitutionId: institution.id },
  });
  console.log(`    + SUPERADMIN users linked: ${linkCount.count}`);

  console.log(`\n  ✓ Blank ${INSTITUTION_NAME} ready — partners can now build courses via the wizard\n`);

  if (!externalPrisma) {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Blank IELTS seed failed:", e);
    process.exit(1);
  });
}
