/**
 * Seed Demo Login Accounts
 *
 * Creates one EDUCATOR user per institution type with a known password (6 types).
 * Non-PROD only — refuses to run when NEXT_PUBLIC_APP_ENV=LIVE.
 *
 * Accounts:
 *   teach@abacus.com   / hff       → School educator
 *   corporate@hff.com  / hff2026  → Corporate educator
 *   training@hff.com   / hff2026  → Training educator
 *   community@hff.com  / hff2026  → Community facilitator
 *   coaching@hff.com   / hff2026  → Coaching educator
 *   healthcare@hff.com / hff2026  → Healthcare educator
 *
 * Idempotent: uses upsert on email.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const DEMO_PASSWORD = "hff2026";
const ABACUS_PASSWORD = "hff";

interface DemoAccount {
  email: string;
  name: string;
  typeSlug: string;
  institutionName: string;
  password?: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "teach@abacus.com", name: "Abacus Teacher", typeSlug: "school", institutionName: "Abacus Academy", password: ABACUS_PASSWORD },
  { email: "corporate@hff.com", name: "Demo Trainer", typeSlug: "corporate", institutionName: "Demo Organization" },
  { email: "training@hff.com", name: "Demo Instructor", typeSlug: "training", institutionName: "Demo Training Co" },
  { email: "community@hff.com", name: "Demo Facilitator", typeSlug: "community", institutionName: "Demo Community Hub" },
  { email: "coaching@hff.com", name: "Demo Coach", typeSlug: "coaching", institutionName: "Demo Practice" },
  { email: "healthcare@hff.com", name: "Demo Provider", typeSlug: "healthcare", institutionName: "Demo Facility" },
];

export async function main(externalPrisma?: PrismaClient): Promise<void> {
  // PROD guard
  const env = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;
  if (env === "LIVE" || env === "production") {
    console.log("  ⛔ Skipping demo logins — PROD environment detected");
    return;
  }

  const prisma = externalPrisma || new PrismaClient();
  const defaultHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log("  Seeding demo login accounts...");

  for (const account of DEMO_ACCOUNTS) {
    const passwordHash = account.password
      ? await bcrypt.hash(account.password, 10)
      : defaultHash;
    // Find institution type
    const instType = await prisma.institutionType.findUnique({
      where: { slug: account.typeSlug },
    });

    if (!instType) {
      console.warn(`  ⚠ Institution type "${account.typeSlug}" not found — skipping ${account.email}`);
      continue;
    }

    // Find or create institution
    let institution = await prisma.institution.findFirst({
      where: { name: account.institutionName },
    });

    if (!institution) {
      const slug = account.institutionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      institution = await prisma.institution.create({
        data: {
          name: account.institutionName,
          slug,
          typeId: instType.id,
        },
      });
      console.log(`  + Institution: ${account.institutionName}`);
    } else if (!institution.typeId) {
      // Link existing institution to type if not yet linked
      await prisma.institution.update({
        where: { id: institution.id },
        data: { typeId: instType.id },
      });
    }

    // Upsert user
    await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        passwordHash,
        role: "EDUCATOR",
        isActive: true,
        institutionId: institution.id,
      },
      create: {
        email: account.email,
        name: account.name,
        passwordHash,
        role: "EDUCATOR",
        isActive: true,
        institutionId: institution.id,
      },
    });

    console.log(`  + User: ${account.email} (${account.name})`);
  }

  console.log(`  ✓ ${DEMO_ACCOUNTS.length} demo accounts seeded`);

  if (!externalPrisma) {
    await prisma.$disconnect();
  }
}

// Direct execution
if (require.main === module) {
  main().catch((e) => {
    console.error("Demo login seed failed:", e);
    process.exit(1);
  });
}
