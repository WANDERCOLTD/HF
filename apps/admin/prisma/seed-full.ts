/**
 * Full Seed Orchestrator
 *
 * Runs seed scripts in dependency order, filtered by SEED_PROFILE.
 * Shares a single PrismaClient across all steps.
 *
 * Usage:
 *   npx tsx prisma/seed-full.ts              # Full seed (additive, all steps)
 *   npx tsx prisma/seed-full.ts --reset      # Clear DB first, then full seed
 *   SEED_PROFILE=core npx tsx prisma/seed-full.ts     # PROD — specs only
 *   SEED_PROFILE=test npx tsx prisma/seed-full.ts     # TEST — core + e2e fixtures
 *   SEED_PROFILE=full npx tsx prisma/seed-full.ts     # DEV/VM — everything (default)
 *   SEED_PROFILE=demo npx tsx prisma/seed-full.ts     # DEMO — clean demo data, no e2e junk
 *   SEED_PROFILE=golden npx tsx prisma/seed-full.ts   # Golden path — clean minimal demo data
 *
 * Profiles:
 *   core    — Specs, archetypes, institution types, run configs, dedup (PROD)
 *   demo    — Core + golden school + demo course + demo logins, NO e2e fixtures
 *   test    — Everything in core + e2e fixtures + demo logins (TEST)
 *   full    — Everything in test + golden school + demo course (DEV/VM)
 *   golden  — Specs + institution types + 1 clean institution (demo golden path)
 *
 * Steps (full profile):
 *   1.  seed-clean              → 51 specs, 160 params, admin user, contracts
 *   2.  seed-identity-archetypes → 7 communication style archetypes
 *   3.  seed-institution-types  → 6 institution types
 *   4.  seed-run-configs        → 8 analysis run config templates
 *   5.  seed (dedup)            → Parameter deduplication cleanup
 *   6.  seed-golden             → Abacus Academy institution + domain     [golden, full]
 *   7.  seed-demo-course        → Intro to Psychology, 8 learners          [full only]
 *   8.  seed-e2e                → E2E test fixtures                       [test, full]
 *   9.  seed-demo-logins        → Demo login accounts (non-PROD)          [test, full]
 */

import { PrismaClient } from "@prisma/client";

import { main as seedClean } from "./seed-clean";
import { main as seedRunConfigs } from "./seed-run-configs";
import { main as seedDedup } from "./seed";
import { main as seedE2E } from "./seed-e2e";
import { main as seedInstitutionTypes } from "./seed-institution-types";
import { main as seedDemoLogins } from "./seed-demo-logins";
import { main as seedGolden } from "./seed-golden";
import { main as seedIdentityArchetypes } from "./seed-identity-archetypes";
import { main as seedDemoCourse } from "./seed-demo-course";

type Profile = "core" | "demo" | "test" | "full" | "golden";

interface Step {
  name: string;
  fn: (prisma: PrismaClient, opts?: any) => Promise<void>;
  /** Which profiles include this step. Omit = all profiles. */
  profiles?: Profile[];
}

const ALL_STEPS: Step[] = [
  // ── Foundation (runs in every profile including golden) ─
  { name: "seed-clean", fn: seedClean },
  { name: "seed-identity-archetypes", fn: seedIdentityArchetypes },
  { name: "seed-institution-types", fn: seedInstitutionTypes },

  // ── Core (runs in core/demo/test/full but NOT golden) ───
  { name: "seed-run-configs", fn: seedRunConfigs, profiles: ["core", "demo", "test", "full"] },
  { name: "seed (dedup)", fn: seedDedup, profiles: ["core", "demo", "test", "full"] },

  // ── Golden (Abacus Academy — additive when in full/demo, cleanup skipped) ──
  { name: "seed-golden", fn: seedGolden, profiles: ["golden", "demo", "full"] },

  // ── Demo + Full (demo course with 8 learners) ──────────
  { name: "seed-demo-course", fn: seedDemoCourse, profiles: ["demo", "full"] },

  // ── Test + Full only (e2e fixtures — NOT in demo) ──────
  { name: "seed-e2e", fn: seedE2E, profiles: ["test", "full"] },

  // ── Demo + Test + Full (demo logins) ───────────────────
  { name: "seed-demo-logins", fn: seedDemoLogins, profiles: ["demo", "test", "full"] },
];

function getProfile(): Profile {
  const val = process.env.SEED_PROFILE || "full";
  if (val === "core" || val === "demo" || val === "test" || val === "full" || val === "golden") return val;
  console.warn(`Invalid SEED_PROFILE "${val}", defaulting to "full"`);
  return "full";
}

function filterSteps(profile: Profile): Step[] {
  return ALL_STEPS.filter((step) => {
    if (!step.profiles) return true; // no restriction = all profiles
    return step.profiles.includes(profile);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const shouldReset = args.includes("--reset") || args.includes("-r");
  const profile = getProfile();
  const steps = filterSteps(profile);

  // Golden/demo profiles force SEED_MODE=prod so seed-clean skips transcript imports
  if ((profile === "golden" || profile === "demo") && !process.env.SEED_MODE) {
    process.env.SEED_MODE = "prod";
  }

  const prisma = new PrismaClient();
  const t0 = Date.now();

  console.log("\n" + "=".repeat(60));
  console.log("  FULL SEED ORCHESTRATOR");
  console.log("=".repeat(60));
  console.log(`\n  Profile: ${profile.toUpperCase()}`);
  console.log(`  Steps:   ${steps.length} / ${ALL_STEPS.length}`);
  console.log(`  Reset:   ${shouldReset ? "YES" : "no (additive)"}\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  [${i + 1}/${steps.length}] ${step.name}`);
    console.log("─".repeat(60));

    const stepStart = Date.now();

    // seed-clean accepts opts for reset
    if (step.name === "seed-clean") {
      await step.fn(prisma, { reset: shouldReset });
    // seed-golden skips its own cleanup when embedded in full/test profile
    } else if (step.name === "seed-golden" && profile !== "golden") {
      await step.fn(prisma, { skipCleanup: true });
    } else {
      await step.fn(prisma);
    }

    const stepElapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
    console.log(`  done ${step.name} (${stepElapsed}s)`);
  }

  // Verification table
  const [specs, params, domains, institutions, users, callers, calls, scores, memories, goals, profiles_count] =
    await Promise.all([
      prisma.analysisSpec.count(),
      prisma.parameter.count(),
      prisma.domain.count(),
      prisma.institution.count(),
      prisma.user.count(),
      prisma.caller.count(),
      prisma.call.count(),
      prisma.callScore.count(),
      prisma.callerMemory.count(),
      prisma.goal.count(),
      prisma.analysisProfile.count(),
    ]);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("  SEED COMPLETE");
  console.log("=".repeat(60));
  console.log(`
  Profile:        ${profile.toUpperCase()}
  Specs:          ${specs}
  Parameters:     ${params}
  Domains:        ${domains}
  Institutions:   ${institutions}
  Users:          ${users}
  Callers:        ${callers}
  Calls:          ${calls}
  CallScores:     ${scores}
  Memories:       ${memories}
  Goals:          ${goals}
  Profiles:       ${profiles_count}
  Time:           ${elapsed}s
`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("\nFull seed failed:", e);
  process.exit(1);
});
