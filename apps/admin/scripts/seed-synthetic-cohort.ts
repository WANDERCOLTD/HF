/**
 * Synthetic cohort seed — populates `CallerTarget` rows across the CTO
 * playbooks so the Skills Framework Cohort Heatmap shows real colour
 * distribution instead of mostly-AWAITING.
 *
 * Why this exists: hf_sandbox today has only Cyrus Horváth with cross-call
 * data (and only on Unit 04). The Cohort Heatmap renders an interesting
 * shape only when a cohort has measured CallerTargets across the
 * playbook's 10 skill_* parameters. Without this seed, smoke-testing
 * SP3-A Rubric Calibration + SP4 Attainment surfaces means staring at
 * grey "Awaiting" cells.
 *
 * What it writes:
 *   - 6 synthetic Caller rows on a configurable playbook
 *   - CallerPlaybook enrolment for each
 *   - One CallerTarget per (synthetic caller, skill_* parameter) with
 *     a deterministic score distribution that fills every tier bucket
 *     (Foundation/Developing/Practitioner/Distinction) at least once
 *
 * Idempotent: re-running upserts by `externalId` prefix `synth-cohort-`
 * and `(callerId, parameterId)` uniqueness on CallerTarget.
 *
 * Cleanup: pass `--cleanup` to delete all `synth-cohort-*` rows.
 *
 * Auth: this is a tsx script — runs with prisma client only. Not exposed
 * as an HTTP endpoint. Don't run in production.
 *
 * Run:
 *   npx tsx scripts/seed-synthetic-cohort.ts                   # default playbook (CTO Revision Aid)
 *   npx tsx scripts/seed-synthetic-cohort.ts --playbook <id>   # other playbook
 *   npx tsx scripts/seed-synthetic-cohort.ts --cleanup         # drop the synthetic cohort
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_PLAYBOOK_ID = "5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0"; // CTO Revision Aid on hf_sandbox

const SYNTH_PREFIX = "synth-cohort-";

const SYNTH_LEARNERS = [
  { suffix: "alex",     name: "Alex Foundation"     },
  { suffix: "bea",      name: "Bea Developing"      },
  { suffix: "cam",      name: "Cam Practitioner"    },
  { suffix: "dax",      name: "Dax Distinction"     },
  { suffix: "elin",     name: "Elin Mixed"          },
  { suffix: "fenn",     name: "Fenn Above-Target"   },
];

/**
 * Per-learner score profile that walks the 0-1 range. For each skill the
 * learner gets a score from their profile array, cycled. This guarantees
 * every tier bucket gets at least one learner per skill.
 */
const SCORE_PROFILES: Record<string, number[]> = {
  alex:  [0.18, 0.22, 0.20, 0.15, 0.25, 0.18, 0.22, 0.20, 0.15, 0.25],  // Foundation
  bea:   [0.42, 0.45, 0.40, 0.48, 0.44, 0.42, 0.45, 0.40, 0.48, 0.44],  // Developing
  cam:   [0.62, 0.68, 0.65, 0.70, 0.66, 0.62, 0.68, 0.65, 0.70, 0.66],  // Practitioner
  dax:   [0.82, 0.88, 0.85, 0.92, 0.86, 0.82, 0.88, 0.85, 0.92, 0.86],  // Distinction
  elin:  [0.25, 0.45, 0.65, 0.85, 0.35, 0.55, 0.75, 0.30, 0.50, 0.70],  // Mixed across tiers
  fenn:  [0.95, 0.98, 0.92, 0.97, 0.94, 0.96, 0.95, 0.93, 0.99, 0.97],  // Above target
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const playbookId = arg("--playbook") ?? DEFAULT_PLAYBOOK_ID;
  const cleanup = process.argv.includes("--cleanup");

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, domainId: true },
  });
  if (!playbook) {
    console.error(`Playbook not found: ${playbookId}`);
    process.exit(1);
  }
  console.log(`Target playbook: ${playbook.name} (${playbookId.slice(0, 8)})`);

  if (cleanup) {
    const synthCallers = await prisma.caller.findMany({
      where: { externalId: { startsWith: SYNTH_PREFIX } },
      select: { id: true, name: true },
    });
    console.log(`Cleanup: removing ${synthCallers.length} synthetic callers + their CallerTargets + CallerPlaybook rows`);
    if (synthCallers.length === 0) return;
    const ids = synthCallers.map((c) => c.id);
    await prisma.callerTarget.deleteMany({ where: { callerId: { in: ids } } });
    await prisma.callerPlaybook.deleteMany({ where: { callerId: { in: ids } } });
    await prisma.caller.deleteMany({ where: { id: { in: ids } } });
    console.log("Cleanup done.");
    return;
  }

  // Find the playbook's skill_* parameters via BehaviorTarget — same approach
  // as `resolveAllSkillsForPlaybook` so the seed targets the live skill list.
  const behaviorTargets = await prisma.behaviorTarget.findMany({
    where: {
      playbookId,
      skillRef: { startsWith: "SKILL-" },
      effectiveUntil: null,
    },
    select: { parameterId: true, skillRef: true },
    orderBy: { skillRef: "asc" },
  });
  if (behaviorTargets.length === 0) {
    console.error(
      `No SKILL-* BehaviorTargets on this playbook. Run backfill-cto-projection.ts first.`,
    );
    process.exit(1);
  }
  console.log(`Skills found: ${behaviorTargets.length}`);

  // Upsert callers + enrollments + CallerTargets per learner per skill.
  let createdCallers = 0;
  let upsertedTargets = 0;
  for (const learner of SYNTH_LEARNERS) {
    const externalId = `${SYNTH_PREFIX}${learner.suffix}`;
    const caller = await prisma.caller.upsert({
      where: { externalId_domainId: { externalId, domainId: playbook.domainId } } as any,
      update: { name: learner.name },
      create: {
        externalId,
        name: learner.name,
        domainId: playbook.domainId,
        role: "LEARNER",
      },
    }).catch(async () => {
      // Compound unique not available on this schema variant — fall back
      // to findFirst + create/update.
      const existing = await prisma.caller.findFirst({
        where: { externalId, domainId: playbook.domainId },
      });
      if (existing) return prisma.caller.update({ where: { id: existing.id }, data: { name: learner.name } });
      createdCallers++;
      return prisma.caller.create({
        data: {
          externalId,
          name: learner.name,
          domainId: playbook.domainId,
          role: "LEARNER",
        },
      });
    });

    // Enrol
    const enrol = await prisma.callerPlaybook.findFirst({
      where: { callerId: caller.id, playbookId },
    });
    if (!enrol) {
      await prisma.callerPlaybook.create({
        data: { callerId: caller.id, playbookId },
      });
    }

    // CallerTargets — one per skill_* parameter
    const profile = SCORE_PROFILES[learner.suffix] ?? [0.5];
    for (let i = 0; i < behaviorTargets.length; i++) {
      const bt = behaviorTargets[i];
      const score = profile[i % profile.length];
      await prisma.callerTarget.upsert({
        where: {
          callerId_parameterId: {
            callerId: caller.id,
            parameterId: bt.parameterId,
          },
        },
        update: {
          currentScore: score,
          callsUsed: 5,
          targetValue: 1.0,
        },
        create: {
          callerId: caller.id,
          parameterId: bt.parameterId,
          currentScore: score,
          callsUsed: 5,
          targetValue: 1.0,
        },
      });
      upsertedTargets++;
    }
  }

  console.log(
    `Synthetic cohort ready: ${SYNTH_LEARNERS.length} callers (${createdCallers} created), ${upsertedTargets} CallerTarget rows upserted.`,
  );
  console.log(
    `Smoke: GET /api/courses/${playbookId}/skills-cohort-heatmap should now show varied tier buckets.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
