/**
 * Seed school-specific Institution records and reassign users + cohorts.
 *
 * Usage: npx tsx prisma/seed-school-institutions.ts
 *
 * Creates 3 institutions with distinct branding:
 *   - Oakwood Primary School (green/gold, woodland theme)
 *   - St Mary's CE Primary School (navy/burgundy, traditional)
 *   - Riverside Academy (sky blue/teal, water theme)
 *
 * Then reassigns users by email domain and cohorts by owner.
 */

import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

const SCHOOLS = [
  {
    name: "Oakwood Primary School",
    slug: "oakwood-primary",
    emailDomain: "@oakwood.sch.uk",
    typeSlug: "school",
    primaryColor: "#166534",    // Forest green
    secondaryColor: "#ca8a04",  // Warm gold
    welcomeMessage:
      "Welcome to Oakwood Primary! Our AI tutors help Year 5 pupils develop strong comprehension and language skills ready for their 11+ exams.",
    logoUrl: null,
  },
  {
    name: "St Mary's CE Primary School",
    slug: "st-marys-ce-primary",
    emailDomain: "@stmarys.sch.uk",
    typeSlug: "school",
    primaryColor: "#1e3a5f",    // Navy blue
    secondaryColor: "#b45309",  // Warm gold/burgundy
    welcomeMessage:
      "Welcome to St Mary's! We use AI-assisted practice sessions to help each child grow in confidence with reading comprehension and grammar.",
    logoUrl: null,
  },
  {
    name: "Riverside Academy",
    slug: "riverside-academy",
    emailDomain: "@riverside.sch.uk",
    typeSlug: "school",
    primaryColor: "#0284c7",    // Sky blue
    secondaryColor: "#0d9488",  // Teal
    welcomeMessage:
      "Welcome to Riverside Academy! We're excited to start our AI tutoring programme. Your teachers are trained and ready.",
    logoUrl: null,
  },
];

export async function main(externalPrisma?: PrismaClient) {
  prisma = externalPrisma || new PrismaClient();
  console.log("Seeding school institutions...\n");

  for (const school of SCHOOLS) {
    // Look up institution type by slug
    const instType = school.typeSlug
      ? await prisma.institutionType.findUnique({ where: { slug: school.typeSlug } })
      : null;

    // Upsert institution
    const institution = await prisma.institution.upsert({
      where: { slug: school.slug },
      update: {
        name: school.name,
        primaryColor: school.primaryColor,
        secondaryColor: school.secondaryColor,
        welcomeMessage: school.welcomeMessage,
        logoUrl: school.logoUrl,
        ...(instType ? { typeId: instType.id } : {}),
      },
      create: {
        name: school.name,
        slug: school.slug,
        primaryColor: school.primaryColor,
        secondaryColor: school.secondaryColor,
        welcomeMessage: school.welcomeMessage,
        logoUrl: school.logoUrl,
        ...(instType ? { typeId: instType.id } : {}),
      },
    });

    console.log(`Institution: ${institution.name} (${institution.id})`);
    console.log(`  Colors: ${institution.primaryColor} / ${institution.secondaryColor}`);

    // Link domain to institution (if a domain with matching slug exists)
    const linkedDomain = await prisma.domain.findUnique({
      where: { slug: school.slug },
    });
    if (linkedDomain) {
      await prisma.domain.update({
        where: { slug: school.slug },
        data: { institutionId: institution.id },
      });
      console.log(`  Linked domain: ${linkedDomain.name}`);
    }

    // Reassign users by email domain
    const userResult = await prisma.user.updateMany({
      where: {
        email: { endsWith: school.emailDomain },
      },
      data: { institutionId: institution.id },
    });
    console.log(`  Assigned ${userResult.count} users (${school.emailDomain})`);

    // Reassign cohorts: find cohorts owned by users at this school
    const schoolUsers = await prisma.user.findMany({
      where: { email: { endsWith: school.emailDomain } },
      select: { id: true },
    });
    const userIds = schoolUsers.map((u) => u.id);

    if (userIds.length > 0) {
      // Find callers belonging to these users (educators own cohorts via Caller)
      const schoolCallers = await prisma.caller.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      });
      const callerIds = schoolCallers.map((c) => c.id);

      if (callerIds.length > 0) {
        const cohortResult = await prisma.cohortGroup.updateMany({
          where: { ownerId: { in: callerIds } },
          data: { institutionId: institution.id },
        });
        console.log(`  Assigned ${cohortResult.count} cohorts`);
      } else {
        console.log("  Assigned 0 cohorts (no callers found)");
      }
    } else {
      console.log("  Assigned 0 cohorts (no users found)");
    }

    console.log();
  }

  // Also reassign pupil callers to institution via their cohort
  console.log("Reassigning pupil users via cohort membership...");
  for (const school of SCHOOLS) {
    const institution = await prisma.institution.findUnique({
      where: { slug: school.slug },
    });
    if (!institution) continue;

    // Find all cohorts belonging to this institution
    const cohorts = await prisma.cohortGroup.findMany({
      where: { institutionId: institution.id },
      select: { id: true },
    });
    const cohortIds = cohorts.map((c) => c.id);

    if (cohortIds.length > 0) {
      // Find callers in those cohorts and get their userIds
      const pupils = await prisma.caller.findMany({
        where: {
          cohortGroupId: { in: cohortIds },
          userId: { not: null },
        },
        select: { userId: true },
      });

      const pupilUserIds = pupils
        .map((p) => p.userId)
        .filter((id): id is string => id !== null);

      if (pupilUserIds.length > 0) {
        const pupilResult = await prisma.user.updateMany({
          where: {
            id: { in: pupilUserIds },
            institutionId: { not: institution.id }, // Only update if not already set
          },
          data: { institutionId: institution.id },
        });
        console.log(`  ${school.name}: ${pupilResult.count} pupil users assigned`);
      }
    }
  }

  console.log("\nDone!");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("Seed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
