/**
 * CIO/CTO Standard Variant Trio — BEH-* BehaviorTarget Seed (G4 / #1145)
 *
 * Adds 8 PLAYBOOK-scope BEH-* BehaviorTarget rows to each of the three
 * CIO/CTO sibling Playbooks (Pop Quiz, Revision Aid, Exam Assessment),
 * with values differentiated by funnel role: discover / teach / certify.
 *
 * Idempotent: re-running this script is a no-op when rows already exist
 * with the same value. Identifies Playbooks by name (not raw UUID) so
 * the seed survives a `db:reset` that regenerates Playbook ids.
 *
 * Source: audit G4 (#1145); PAW approved BA-default values 2026-06-06.
 * Reads: `lib/agent-tuner/write-target.ts::writeBehaviorTargets` (canonical
 *        helper — runs `isAdjustable` whitelist, clamps to [0,1], calls
 *        `bumpPlaybookComposeTimestamp`).
 *
 * @see docs/audit/pipeline-measure-adapt-2026-06.md §5 + §6 G4
 * @see docs/CHAIN-CONTRACTS.md §3d (Variant product line CC-A through CC-F)
 */

import { PrismaClient } from "@prisma/client";
import { writeBehaviorTargets } from "../lib/agent-tuner/write-target";

interface VariantTargetSet {
  playbookNamePattern: string;
  funnelRole: "discover" | "teach" | "certify";
  targets: Array<{ parameterId: string; targetValue: number }>;
}

/**
 * BA-proposed values (PAW approved 2026-06-06).
 *
 * Differentiation shape mirrors the existing skill_* pattern:
 *   Pop Quiz       → lower baseline (discover at low stakes)
 *   Revision Aid   → mid-range (teach at the standard)
 *   Exam Assessment → polarised toward examiner role
 *
 * Per CC-G (CHAIN-CONTRACTS.md §3d): the variant funnel uses BOTH
 * skill_* (mastery) AND BEH-* (persona) targets. Cross-sibling values
 * are intentionally differentiated, not flat defaults.
 */
const CIO_CTO_VARIANT_TARGETS: VariantTargetSet[] = [
  {
    playbookNamePattern: "The CIO/CTO Standard — Pop Quiz",
    funnelRole: "discover",
    targets: [
      { parameterId: "BEH-WARMTH", targetValue: 0.65 },
      { parameterId: "BEH-FORMALITY", targetValue: 0.40 },
      { parameterId: "BEH-CHALLENGE-LEVEL", targetValue: 0.35 },
      { parameterId: "BEH-PROBING-QUESTIONS", targetValue: 0.75 },
      { parameterId: "BEH-RESPONSE-LEN", targetValue: 0.40 },
      { parameterId: "BEH-CONVERSATIONAL-TONE", targetValue: 0.65 },
      { parameterId: "BEH-DIRECTNESS", targetValue: 0.50 },
      // BEH-QUESTION-RATE was in the BA proposal but the live Parameter row
      // has parameterType: STATE / isAdjustable: false (it's an observed
      // measurement, not a tunable target). writeBehaviorTargets correctly
      // refuses it. BEH-PROBING-QUESTIONS above covers the AI-led probing
      // dimension. If a tunable question-rate is wanted later, mark the
      // Parameter row isAdjustable=true in lib/registry/index.ts.
    ],
  },
  {
    playbookNamePattern: "The CIO/CTO Standard — Revision Aid",
    funnelRole: "teach",
    targets: [
      { parameterId: "BEH-WARMTH", targetValue: 0.55 },
      { parameterId: "BEH-FORMALITY", targetValue: 0.50 },
      { parameterId: "BEH-CHALLENGE-LEVEL", targetValue: 0.60 },
      { parameterId: "BEH-PROBING-QUESTIONS", targetValue: 0.55 },
      { parameterId: "BEH-RESPONSE-LEN", targetValue: 0.55 },
      { parameterId: "BEH-CONVERSATIONAL-TONE", targetValue: 0.55 },
      { parameterId: "BEH-DIRECTNESS", targetValue: 0.55 },
      // BEH-QUESTION-RATE not adjustable — see note in discover block above.
    ],
  },
  {
    playbookNamePattern: "The CIO/CTO Standard — Exam Assessment",
    funnelRole: "certify",
    targets: [
      { parameterId: "BEH-WARMTH", targetValue: 0.35 },
      { parameterId: "BEH-FORMALITY", targetValue: 0.70 },
      { parameterId: "BEH-CHALLENGE-LEVEL", targetValue: 0.80 },
      { parameterId: "BEH-PROBING-QUESTIONS", targetValue: 0.30 },
      { parameterId: "BEH-RESPONSE-LEN", targetValue: 0.35 },
      { parameterId: "BEH-CONVERSATIONAL-TONE", targetValue: 0.35 },
      { parameterId: "BEH-DIRECTNESS", targetValue: 0.75 },
      // BEH-QUESTION-RATE not adjustable — see note in discover block above.
    ],
  },
];

export async function seedCioCtoBehTargets(prisma: PrismaClient): Promise<{
  playbooksProcessed: number;
  playbooksSkipped: number;
  targetsWritten: number;
}> {
  let playbooksProcessed = 0;
  let playbooksSkipped = 0;
  let targetsWritten = 0;

  for (const set of CIO_CTO_VARIANT_TARGETS) {
    const pb = await prisma.playbook.findFirst({
      where: { name: set.playbookNamePattern },
      select: { id: true, name: true, status: true },
    });

    if (!pb) {
      console.log(
        `   ⚠ CIO/CTO BEH-*: playbook "${set.playbookNamePattern}" not found — skipping (this is expected on fresh seeds before CIO/CTO playbooks are created)`,
      );
      playbooksSkipped++;
      continue;
    }

    // FK pre-flight: confirm each Parameter row exists before insert.
    // (writeBehaviorTargets validates against the in-memory whitelist; the
    // explicit DB check here gives a clearer error on first-seed when
    // a Parameter row hasn't been inserted yet via the spec-driven flow.)
    for (const t of set.targets) {
      const exists = await prisma.parameter.findUnique({
        where: { parameterId: t.parameterId },
        select: { parameterId: true },
      });
      if (!exists) {
        throw new Error(
          `seed-cio-cto-beh-targets: Parameter row "${t.parameterId}" missing. ` +
            `Run the spec-driven parameter seed first (apps/admin/lib/registry/index.ts populates these via spec-sync).`,
        );
      }
    }

    const results = await writeBehaviorTargets(pb.id, set.targets, {
      source: "SEED",
    });
    const written = results.filter(
      (r) => r.ok && (r.action === "created" || r.action === "updated"),
    ).length;
    targetsWritten += written;
    playbooksProcessed++;

    console.log(
      `   ✓ CIO/CTO ${set.funnelRole} (${pb.id.slice(0, 8)} "${pb.name}"): ${written}/${set.targets.length} BEH-* targets written`,
    );
  }

  return { playbooksProcessed, playbooksSkipped, targetsWritten };
}

// CLI entry point — run standalone for ad-hoc reseed:
// `npx tsx apps/admin/prisma/seed-cio-cto-beh-targets.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  seedCioCtoBehTargets(prisma)
    .then((res) => {
      console.log(
        `\nDone: ${res.playbooksProcessed} playbook(s) processed, ${res.playbooksSkipped} skipped, ${res.targetsWritten} target rows written.`,
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
