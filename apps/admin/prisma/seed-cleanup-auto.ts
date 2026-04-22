/**
 * Cleanup Auto-Seeded Data
 *
 * Removes all auto-seeded domains, institutions, callers, and related data
 * while preserving manually-created courses.
 *
 * Targets data from these seed scripts:
 *   - seed-golden        (abacus-academy)
 *   - seed-demo-course   (demo-psych-* callers, Intro to Psychology)
 *   - seed-e2e           (e2e-test-domain)
 *   - seed-holographic   (aldermoor-college, curiosity-circle, greenfield-academy)
 *   - seed-educator-demo (oakwood-primary, st-marys-ce-primary + edu-demo-* callers)
 *   - seed-school-institutions (oakwood-primary, st-marys-ce-primary, riverside-academy)
 *   - seed-demo-domains  (meridian-academy, northbridge-business-school, wellspring-institute, harbour-languages)
 *
 * DRY RUN by default. Pass --execute to actually delete.
 *
 * Usage:
 *   npx tsx prisma/seed-cleanup-auto.ts            # Dry run — shows what would be deleted
 *   npx tsx prisma/seed-cleanup-auto.ts --execute   # Actually delete
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── Seeded domain slugs — DELETE these entirely ──────────
// NOTE: abacus-academy is KEPT (has manual courses like "Secret Garden 1001")
const SEEDED_DOMAIN_SLUGS_TO_DELETE = [
  // seed-e2e
  "e2e-test-domain",
  // seed-holographic-demo
  "aldermoor-college",
  "curiosity-circle",
  "greenfield-academy",
  // seed-educator-demo (creates domains matching institution slugs)
  "oakwood-primary",
  "st-marys-ce-primary",
  // seed-demo-domains (+ seed-domains prerequisite)
  "meridian-academy",
  "northbridge-business-school",
  "wellspring-institute",
  "harbour-languages",
];

// ── Seeded playbook names — DELETE these specifically ─────
// (targets seeded playbooks on kept domains like abacus-academy)
const SEEDED_PLAYBOOK_NAMES = [
  "Introduction to Psychology",  // seed-demo-course
  "E2E Adaptive v1",             // seed-e2e
];

// ── Seeded institution slugs ─────────────────────────────
// NOTE: abacus-academy is KEPT (has manual courses)
const SEEDED_INSTITUTION_SLUGS = [
  "aldermoor-college",
  "curiosity-circle",
  "greenfield-academy",
  "oakwood-primary",
  "st-marys-ce-primary",
  "riverside-academy",
  // seed-domains creates a "humanfirst" institution
  "humanfirst",
];

// ── Seeded caller externalId prefixes ────────────────────
const SEEDED_CALLER_PREFIXES = [
  "golden-",
  "demo-psych-",
  "e2e-",
  "holo-demo",
  "edu-demo-",
  "edu-teacher-",
  "demo-",       // seed-demo-domains
];

async function main(): Promise<void> {
  const dryRun = !process.argv.includes("--execute");

  if (dryRun) {
    console.log("🔍 DRY RUN — pass --execute to actually delete\n");
  } else {
    console.log("🗑️  EXECUTING cleanup — this will delete seeded data\n");
  }

  // ── 1. Find domains to DELETE entirely ──
  const domainsToDelete = await prisma.domain.findMany({
    where: { slug: { in: SEEDED_DOMAIN_SLUGS_TO_DELETE } },
    select: { id: true, slug: true, name: true },
  });
  const domainIdsToDelete = domainsToDelete.map((d) => d.id);

  console.log(`Domains to DELETE entirely: ${domainsToDelete.length}`);
  for (const d of domainsToDelete) {
    console.log(`  - ${d.slug} (${d.name})`);
  }

  // ── 2. Find specific seeded playbooks to DELETE (on kept domains) ──
  const namedPlaybooks = await prisma.playbook.findMany({
    where: { name: { in: SEEDED_PLAYBOOK_NAMES } },
    select: { id: true, name: true, domain: { select: { slug: true } } },
  });
  // Also grab all playbooks on domains being deleted
  const domainPlaybooks = await prisma.playbook.findMany({
    where: { domainId: { in: domainIdsToDelete } },
    select: { id: true, name: true, domain: { select: { slug: true } } },
  });
  // Merge and dedupe
  const allPlaybooksToDelete = [...namedPlaybooks, ...domainPlaybooks];
  const seenPbIds = new Set<string>();
  const playbooksToDelete = allPlaybooksToDelete.filter((p) => {
    if (seenPbIds.has(p.id)) return false;
    seenPbIds.add(p.id);
    return true;
  });
  const playbookIds = playbooksToDelete.map((p) => p.id);

  console.log(`\nPlaybooks to DELETE: ${playbooksToDelete.length}`);
  for (const p of playbooksToDelete) {
    console.log(`  - ${p.name} (on ${p.domain?.slug ?? "no domain"})`);
  }

  // ── 3. Find seeded callers ──
  const seededCallers = await prisma.caller.findMany({
    where: {
      OR: SEEDED_CALLER_PREFIXES.map((prefix) => ({
        externalId: { startsWith: prefix },
      })),
    },
    select: { id: true, externalId: true },
  });
  const callerIds = seededCallers.map((c) => c.id);

  console.log(`\nSeeded callers found: ${seededCallers.length}`);
  if (seededCallers.length <= 20) {
    for (const c of seededCallers) {
      console.log(`  - ${c.externalId}`);
    }
  } else {
    console.log(`  (showing first 10 of ${seededCallers.length})`);
    for (const c of seededCallers.slice(0, 10)) {
      console.log(`  - ${c.externalId}`);
    }
  }

  // ── 4. Find seeded institutions ──
  const seededInstitutions = await prisma.institution.findMany({
    where: { slug: { in: SEEDED_INSTITUTION_SLUGS } },
    select: { id: true, slug: true, name: true },
  });

  console.log(`\nSeeded institutions found: ${seededInstitutions.length}`);
  for (const i of seededInstitutions) {
    console.log(`  - ${i.slug} (${i.name})`);
  }

  // ── 5. Find calls from seeded callers ──
  const seededCalls = await prisma.call.findMany({
    where: { callerId: { in: callerIds } },
    select: { id: true },
  });
  const callIds = seededCalls.map((c) => c.id);

  console.log(`\nCalls from seeded callers: ${callIds.length}`);

  if (dryRun) {
    console.log("\n✅ Dry run complete. Run with --execute to delete.");
    await prisma.$disconnect();
    return;
  }

  // ── EXECUTE: Delete in FK-safe order ──────────────────

  console.log("\nDeleting in FK-safe order...");

  // 6a. Caller-linked tables
  if (callerIds.length > 0) {
    const del = async (model: string, count: number) => {
      if (count > 0) console.log(`  ✓ ${model}: ${count} deleted`);
    };

    del("CallerModuleProgress", (await prisma.callerModuleProgress.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("ComposedPrompt", (await prisma.composedPrompt.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("Goal", (await prisma.goal.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("CallerMemory", (await prisma.callerMemory.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("CallerMemorySummary", (await prisma.callerMemorySummary.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("CallerPersonalityProfile", (await prisma.callerPersonalityProfile.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("CallScore", (await prisma.callScore.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("OnboardingSession", (await prisma.onboardingSession.deleteMany({ where: { callerId: { in: callerIds } } })).count);
  }

  // 6b. Call-linked tables
  if (callIds.length > 0) {
    const del = async (model: string, count: number) => {
      if (count > 0) console.log(`  ✓ ${model}: ${count} deleted`);
    };

    del("RewardScore", (await prisma.rewardScore.deleteMany({ where: { callId: { in: callIds } } })).count);
    del("CallTarget", (await prisma.callTarget.deleteMany({ where: { callId: { in: callIds } } })).count);
    del("BehaviorMeasurement", (await prisma.behaviorMeasurement.deleteMany({ where: { callId: { in: callIds } } })).count);
    del("Call", (await prisma.call.deleteMany({ where: { id: { in: callIds } } })).count);
  }

  // 6c. Caller enrollment + cohort tables
  if (callerIds.length > 0) {
    const del = async (model: string, count: number) => {
      if (count > 0) console.log(`  ✓ ${model}: ${count} deleted`);
    };

    del("CallerPlaybook", (await prisma.callerPlaybook.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    del("CallerCohortMembership", (await prisma.callerCohortMembership.deleteMany({ where: { callerId: { in: callerIds } } })).count);
    // Cohorts owned by seeded callers
    del("CohortPlaybook", (await prisma.cohortPlaybook.deleteMany({ where: { cohortGroup: { ownerId: { in: callerIds } } } })).count);
    del("CohortGroup", (await prisma.cohortGroup.deleteMany({ where: { ownerId: { in: callerIds } } })).count);
    del("Caller", (await prisma.caller.deleteMany({ where: { id: { in: callerIds } } })).count);
  }

  // 6d. Playbook-linked tables
  if (playbookIds.length > 0) {
    const del = async (model: string, count: number) => {
      if (count > 0) console.log(`  ✓ ${model}: ${count} deleted`);
    };

    // Helper: try deleteMany, skip if table doesn't exist (P2021)
    const tryDel = async (model: string, fn: () => Promise<{ count: number }>) => {
      try {
        const { count } = await fn();
        if (count > 0) console.log(`  ✓ ${model}: ${count} deleted`);
      } catch (e: any) {
        if (e.code === "P2021") {
          console.log(`  ⊘ ${model}: table not yet migrated, skipping`);
        } else throw e;
      }
    };
    const tryUpdate = async (label: string, fn: () => Promise<any>) => {
      try { await fn(); } catch (e: any) {
        if (e.code === "P2021" || e.code === "P2009") {
          console.log(`  ⊘ ${label}: column/table not yet migrated, skipping`);
        } else throw e;
      }
    };

    // Direct FK children of Playbook
    await tryDel("PlaybookItem", () => prisma.playbookItem.deleteMany({ where: { playbookId: { in: playbookIds } } }));
    await tryDel("PlaybookSubject", () => prisma.playbookSubject.deleteMany({ where: { playbookId: { in: playbookIds } } }));
    await tryDel("PlaybookSource", () => prisma.playbookSource.deleteMany({ where: { playbookId: { in: playbookIds } } }));
    await tryDel("CallerPlaybook (remaining)", () => prisma.callerPlaybook.deleteMany({ where: { playbookId: { in: playbookIds } } }));
    await tryDel("CohortPlaybook (remaining)", () => prisma.cohortPlaybook.deleteMany({ where: { playbookId: { in: playbookIds } } }));
    // Unlink nullable FKs (may not exist on older schemas)
    await tryUpdate("Curriculum.playbookId", () => prisma.curriculum.updateMany({ where: { playbookId: { in: playbookIds } }, data: { playbookId: null } }));
    await tryUpdate("Call.playbookId", () => prisma.call.updateMany({ where: { playbookId: { in: playbookIds } }, data: { playbookId: null } }));
    await tryUpdate("Goal.playbookId", () => prisma.goal.updateMany({ where: { playbookId: { in: playbookIds } }, data: { playbookId: null } }));
    // Delete playbooks
    del("Playbook", (await prisma.playbook.deleteMany({ where: { id: { in: playbookIds } } })).count);
  }

  // 6e. Domain-linked tables (only for domains being fully deleted)
  if (domainIdsToDelete.length > 0) {
    const del = async (model: string, count: number) => {
      if (count > 0) console.log(`  ✓ ${model}: ${count} deleted`);
    };

    // Content assertions created by demo seeds
    del("ContentAssertion (demo)", (await prisma.contentAssertion.deleteMany({ where: { createdBy: "demo-course-seed" } })).count);
    // Subject-Domain links (many-to-many)
    del("SubjectDomain", (await prisma.subjectDomain.deleteMany({ where: { domainId: { in: domainIdsToDelete } } })).count);
    // PlaybookGroups on deleted domains
    const groupIds = (await prisma.playbookGroup.findMany({ where: { domainId: { in: domainIdsToDelete } }, select: { id: true } })).map(g => g.id);
    if (groupIds.length > 0) {
      del("PlaybookGroupSubject", (await prisma.playbookGroupSubject.deleteMany({ where: { groupId: { in: groupIds } } })).count);
      del("PlaybookGroup", (await prisma.playbookGroup.deleteMany({ where: { id: { in: groupIds } } })).count);
    }
    // CohortGroups on deleted domains
    del("CohortGroup", (await prisma.cohortGroup.deleteMany({ where: { domainId: { in: domainIdsToDelete } } })).count);
    // Callers on deleted domains (nullify FK)
    await prisma.caller.updateMany({ where: { domainId: { in: domainIdsToDelete } }, data: { domainId: null } });
    // Domains
    del("Domain", (await prisma.domain.deleteMany({ where: { id: { in: domainIdsToDelete } } })).count);
  }

  // 6f. Institutions (last — domains FK to these)
  if (seededInstitutions.length > 0) {
    const instIds = seededInstitutions.map((i) => i.id);
    // Unlink users from seeded institutions
    await prisma.user.updateMany({
      where: { institutionId: { in: instIds } },
      data: { institutionId: null },
    });
    const { count } = await prisma.institution.deleteMany({
      where: { id: { in: instIds } },
    });
    console.log(`  ✓ Institution: ${count} deleted`);
  }

  // 6g. Seeded demo subjects not on any domain
  await prisma.subject.deleteMany({
    where: { slug: { in: ["demo-psych-intro-psychology", "creative-comprehension", "spag"] } },
  });

  console.log("\n✅ Cleanup complete. Manually-created courses are preserved.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
