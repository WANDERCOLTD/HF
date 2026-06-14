/**
 * One-off migration — reseed the `SKILL_MEASURE_V1` DataContract from
 * IELTS-shape (3/4/5.5/7) to Generic 4-tier (1/2/3/4) (#1657).
 *
 * Why a separate script and not the seed JSON:
 *   - The contract is loaded at runtime from `SystemSetting` (key:
 *     `contract:SKILL_MEASURE_V1`). The JSON file at
 *     `docs-archive/bdd-specs/contracts/SKILL_MEASURE_V1.contract.json`
 *     is the SEED source — only writes on fresh-seed paths.
 *   - hf-prod / hf-staging / hf-dev hold the pre-#1657 IELTS values in
 *     `SystemSetting` already; running the seed doesn't stomp them.
 *
 * Safety rules (run-anywhere idempotent):
 *   - Refuses to run if `SystemSetting` row for `contract:SKILL_MEASURE_V1`
 *     doesn't exist (caller must seed first).
 *   - Refuses to run if values already match Generic shape (no-op).
 *   - Preserves every other field on the contract — only replaces
 *     `thresholds` + `tierBands`.
 *   - Adds an audit marker `_reseeded_2026_06_14` documenting the change.
 *   - `--dry-run` (default) prints planned change without writing.
 *   - `--execute` actually writes.
 *
 * CRITICAL: run `migrate-ielts-playbook-mapping.ts --execute` BEFORE this
 * script. Without it, every IELTS course currently relying on the silent
 * IELTS contract fallback will see learner bands shift from 3/4/5.5/7 to
 * 1/2/3/4 the moment this reseed lands.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/reseed-skill-measure-contract-generic.ts
 *   npx tsx apps/admin/scripts/reseed-skill-measure-contract-generic.ts --execute
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY = "contract:SKILL_MEASURE_V1";

const GENERIC_THRESHOLDS = {
  approachingEmerging: 0.25,
  emerging: 0.5,
  developing: 0.75,
  secure: 1.0,
};
const GENERIC_TIER_BANDS = {
  approachingEmerging: 1,
  emerging: 2,
  developing: 3,
  secure: 4,
};

function isGenericShape(
  thresholds: Record<string, unknown> | undefined,
  tierBands: Record<string, unknown> | undefined,
): boolean {
  if (!thresholds || !tierBands) return false;
  return (
    thresholds.approachingEmerging === GENERIC_THRESHOLDS.approachingEmerging &&
    thresholds.emerging === GENERIC_THRESHOLDS.emerging &&
    thresholds.developing === GENERIC_THRESHOLDS.developing &&
    thresholds.secure === GENERIC_THRESHOLDS.secure &&
    tierBands.approachingEmerging === GENERIC_TIER_BANDS.approachingEmerging &&
    tierBands.emerging === GENERIC_TIER_BANDS.emerging &&
    tierBands.developing === GENERIC_TIER_BANDS.developing &&
    tierBands.secure === GENERIC_TIER_BANDS.secure
  );
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`[reseed-skill-measure-contract] running in ${mode} mode`);

  const setting = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  if (!setting) {
    console.error(
      `[reseed-skill-measure-contract] ${KEY} not found — seed it first via the normal seed path.`,
    );
    process.exit(2);
  }

  let contract: Record<string, unknown>;
  try {
    contract = JSON.parse(setting.value);
  } catch (e) {
    console.error(`[reseed-skill-measure-contract] could not parse contract JSON:`, e);
    process.exit(2);
  }

  const currentThresholds = contract.thresholds as Record<string, unknown> | undefined;
  const currentTierBands = contract.tierBands as Record<string, unknown> | undefined;

  if (isGenericShape(currentThresholds, currentTierBands)) {
    console.log(`[reseed-skill-measure-contract] already Generic 4-tier shape — no-op.`);
    return;
  }

  console.log(`[reseed-skill-measure-contract] current shape:`);
  console.log(`  thresholds: ${JSON.stringify(currentThresholds)}`);
  console.log(`  tierBands:  ${JSON.stringify(currentTierBands)}`);
  console.log(`[reseed-skill-measure-contract] target shape (Generic 4-tier):`);
  console.log(`  thresholds: ${JSON.stringify(GENERIC_THRESHOLDS)}`);
  console.log(`  tierBands:  ${JSON.stringify(GENERIC_TIER_BANDS)}`);

  if (!execute) {
    console.log("");
    console.log("[reseed-skill-measure-contract] re-run with --execute to apply.");
    return;
  }

  const next = {
    ...contract,
    thresholds: GENERIC_THRESHOLDS,
    tierBands: GENERIC_TIER_BANDS,
    _reseeded_2026_06_14:
      "Flipped from IELTS-shape (3/4/5.5/7) to Generic 4-tier (1/2/3/4) per #1657. IELTS courses now carry explicit Playbook.config.skillTierMapping written by scripts/migrate-ielts-playbook-mapping.ts. The contract is now the institutional default for non-IELTS courses.",
  };

  await prisma.systemSetting.update({
    where: { key: KEY },
    data: { value: JSON.stringify(next, null, 2) },
  });

  console.log(`[reseed-skill-measure-contract] ✓ contract reseeded to Generic 4-tier.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[reseed-skill-measure-contract] failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
