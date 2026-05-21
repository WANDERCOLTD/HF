/**
 * Proof script for #561 — band descriptors → Parameter.config.bandThresholds
 *
 * The systemic fix called out by #561 was shipped as #564 + 6c0fd172. This
 * script verifies on a live DB that the rubric-only projection pass actually
 * populates `Parameter.config.bandThresholds` for skill parameters.
 *
 * Usage (from apps/admin/):
 *   npx tsx scripts/proof-561-band-thresholds.ts                 # report current state
 *   npx tsx scripts/proof-561-band-thresholds.ts --reproject     # also run rubric pass
 *   npx tsx scripts/proof-561-band-thresholds.ts --playbook ID   # target a specific playbook
 *
 * Output is a per-Parameter table: criterion code, band count, sample band
 * descriptor. PASS = all skill parameters carry ≥10 band entries (typical
 * IELTS rubric). FAIL = any skill parameter has bandThresholds = null/empty.
 */

import { prisma } from "@/lib/prisma";
import { runProjectionForPlaybook } from "@/lib/wizard/run-projection-for-playbook";

type ParamConfig = { bandThresholds?: Record<string, string> | null; [k: string]: unknown };

async function findIeltsLikePlaybook(): Promise<{ id: string; name: string } | null> {
  const candidate = await prisma.playbook.findFirst({
    where: {
      OR: [
        { name: { contains: "IELTS", mode: "insensitive" } },
        { name: { contains: "ielts", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  return candidate ?? null;
}

async function reportSkillParams(): Promise<{
  pass: boolean;
  rows: Array<{ paramId: string; criterionCode: string | null; bandCount: number; sample: string; rubricScored: boolean }>;
}> {
  // Parameter rows are globally scoped (no playbookId column). All skill_*
  // parameters live in one registry; bandThresholds are merged onto their
  // config JSON by writeBandThresholds().
  //
  // PASS criterion is over RUBRIC-SCORED params only. Internal aggregator
  // params (e.g. skill_ema_aggregate) deliberately carry no bandThresholds
  // and would create false negatives.
  const params = await prisma.parameter.findMany({
    where: { parameterId: { startsWith: "skill_" } },
    select: { parameterId: true, config: true },
    orderBy: { parameterId: "asc" },
  });

  const isAggregator = (id: string) => /aggregate|aggregator|_ema$|_meta$/i.test(id);

  const rows = params.map((p) => {
    const cfg = (p.config ?? {}) as ParamConfig;
    const bt = cfg.bandThresholds ?? null;
    const bandCount = bt && typeof bt === "object" ? Object.keys(bt).length : 0;
    const firstKey = bt && bandCount > 0 ? Object.keys(bt)[0] : null;
    const sample = firstKey ? `band ${firstKey}: ${bt![firstKey].slice(0, 60)}...` : "(none)";
    const m = /^skill_([a-z0-9]+)/.exec(p.parameterId);
    return {
      paramId: p.parameterId,
      criterionCode: m ? m[1] : null,
      bandCount,
      sample,
      rubricScored: !isAggregator(p.parameterId),
    };
  });

  const rubricRows = rows.filter((r) => r.rubricScored);
  const pass = rubricRows.length > 0 && rubricRows.every((r) => r.bandCount >= 9);
  return { pass, rows };
}

async function main() {
  const args = process.argv.slice(2);
  const wantReproject = args.includes("--reproject");
  const playbookFlag = args.indexOf("--playbook");
  const targetId = playbookFlag !== -1 ? args[playbookFlag + 1] : null;

  let playbook: { id: string; name: string } | null = null;
  if (targetId) {
    playbook = await prisma.playbook.findUnique({
      where: { id: targetId },
      select: { id: true, name: true },
    });
  } else {
    playbook = await findIeltsLikePlaybook();
  }

  if (!playbook) {
    console.log("[proof-561] No IELTS-like playbook found in DB.");
    console.log("Hint: pass --playbook <id> to target a specific playbook, or create an IELTS course first.");
    process.exit(1);
  }

  console.log(`[proof-561] target playbook: ${playbook.id} (${playbook.name})`);
  console.log();
  console.log("=== BEFORE ===");
  const before = await reportSkillParams();
  console.log(`${before.rows.length} skill parameter(s) found (global registry):`);
  for (const r of before.rows) {
    const tag = r.rubricScored ? "" : "  [aggregator — no bands expected]";
    console.log(`  - ${r.paramId.padEnd(42)} bands=${String(r.bandCount).padStart(2)}  ${r.sample}${tag}`);
  }
  console.log(`  → ${before.pass ? "PASS" : "FAIL"} (need ≥9 bands on every rubric-scored skill param)`);

  if (before.pass) {
    console.log();
    console.log("[proof-561] bandThresholds already populated — #561 verified on this playbook.");
    process.exit(0);
  }

  if (!wantReproject) {
    console.log();
    console.log("[proof-561] bandThresholds NOT populated. Re-run with --reproject to trigger");
    console.log("[proof-561] the rubric pass and verify it lands.");
    process.exit(1);
  }

  console.log();
  console.log("=== RE-PROJECTING ===");
  const result = await runProjectionForPlaybook(playbook.id);
  console.log(`appliedSources: ${result.appliedSources.length}`);
  console.log(`rubricBandsApplied:`);
  for (const r of result.rubricBandsApplied) {
    console.log(`  - source=${r.sourceContentId.slice(0, 8)} (${r.sourceName})`);
    console.log(`    parametersUpdated=${r.parametersUpdated} unmatchedCodes=[${r.unmatchedCodes.join(", ")}]`);
  }

  console.log();
  console.log("=== AFTER ===");
  const after = await reportSkillParams();
  for (const r of after.rows) {
    const tag = r.rubricScored ? "" : "  [aggregator — no bands expected]";
    console.log(`  - ${r.paramId.padEnd(42)} bands=${String(r.bandCount).padStart(2)}  ${r.sample}${tag}`);
  }
  console.log(`  → ${after.pass ? "PASS" : "FAIL"} (need ≥9 bands on every rubric-scored skill param)`);

  process.exit(after.pass ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("[proof-561] error:", err);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
