/**
 * seed-source-derived-skill-banding.ts — #1630 backfill.
 *
 * Slim variant of the source-derivation logic in `runProjectionForPlaybook`.
 * Instead of re-running projection from PDFs, this script reads the
 * persisted `Parameter.config.tierScheme` (already written by the applier)
 * and seeds `Playbook.config.skillTierMapping` directly.
 *
 * Use this when the projection has already run (Parameters exist with
 * tierScheme populated) but the new #1630 derivation hadn't shipped yet —
 * so `Playbook.config.skillTierMapping` is null on courses that should have
 * a non-IELTS scheme.
 *
 * The script honours the SAME cascade gate as the live orchestrator:
 * suppresses the write when `resolveMasteryPolicyKnob` returns DOMAIN or
 * PLAYBOOK as the effective layer.
 *
 * Idempotent. Safe to re-run.
 *
 * Run:   npx tsx scripts/seed-source-derived-skill-banding.ts [--dry-run]
 *        npx tsx scripts/seed-source-derived-skill-banding.ts --playbook-id=<id>
 */

import { prisma } from "@/lib/prisma";
import { deriveSkillTierMappingFromSkills } from "@/lib/banding/derive-skill-tier-mapping-from-source";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { resolveMasteryPolicyKnob } from "@/lib/cascade/resolvers/mastery-policy";
import type { ParsedSkill } from "@/lib/wizard/project-course-reference";

interface RunOptions {
  dryRun: boolean;
  playbookId?: string;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const opts: RunOptions = { dryRun: false };
  for (const a of args) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--playbook-id=")) opts.playbookId = a.split("=")[1];
  }
  return opts;
}

async function loadParsedSkillsForPlaybook(
  playbookId: string,
): Promise<ParsedSkill[]> {
  const targets = await prisma.behaviorTarget.findMany({
    where: {
      playbookId,
      effectiveUntil: null,
      parameter: { parameterId: { startsWith: "skill_" } },
    },
    select: {
      skillRef: true,
      parameter: { select: { config: true, name: true } },
    },
  });

  const parsed: ParsedSkill[] = [];
  for (const t of targets) {
    const cfg = (t.parameter?.config ?? {}) as Record<string, unknown>;
    const tierScheme = cfg.tierScheme;
    if (!Array.isArray(tierScheme) || tierScheme.length === 0) continue;
    if (!tierScheme.every((s) => typeof s === "string")) continue;
    parsed.push({
      ref: t.skillRef ?? "",
      name: t.parameter?.name ?? "",
      tiers: {},
      tierScheme: tierScheme as string[],
    });
  }
  return parsed;
}

async function processPlaybook(
  playbook: { id: string; name: string },
  opts: RunOptions,
): Promise<{ status: string; reason?: string; scheme?: string }> {
  const skills = await loadParsedSkillsForPlaybook(playbook.id);
  if (skills.length === 0) {
    return { status: "NO_SKILLS_WITH_TIER_SCHEME" };
  }

  const derived = deriveSkillTierMappingFromSkills(skills);
  if (!derived) {
    return {
      status: "NO_DERIVATION",
      reason: `${skills.length} skill(s) — disagreement / unrecognised / 3-tier`,
    };
  }

  let effective;
  try {
    effective = await resolveMasteryPolicyKnob(
      { playbookId: playbook.id },
      "skillTierMapping",
    );
  } catch (err) {
    return {
      status: "CASCADE_READ_FAILED",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (effective.source !== "SYSTEM") {
    return {
      status: "CASCADE_PINNED",
      reason: `already set at ${effective.source}`,
      scheme: derived.derivedFromScheme,
    };
  }

  if (opts.dryRun) {
    return {
      status: "WOULD_WRITE",
      scheme: derived.derivedFromScheme,
    };
  }

  await updatePlaybookConfig(
    playbook.id,
    (cfg) => ({
      ...cfg,
      skillTierMapping: {
        thresholds: derived.mapping.thresholds,
        tierBands: derived.mapping.tierBands,
        tierLabels: derived.tierLabels,
      },
    }),
    { reason: `#1630 backfill source-derived (${derived.derivedFromScheme})` },
  );

  return { status: "WROTE", scheme: derived.derivedFromScheme };
}

async function main() {
  const opts = parseArgs();
  console.log(
    `[#1630 backfill] dryRun=${opts.dryRun} playbookId=${opts.playbookId ?? "<all>"}`,
  );

  const playbooks = opts.playbookId
    ? await prisma.playbook.findMany({
        where: { id: opts.playbookId },
        select: { id: true, name: true },
      })
    : await prisma.playbook.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

  console.log(`[#1630 backfill] processing ${playbooks.length} playbook(s)\n`);

  const counts: Record<string, number> = {};
  for (const pb of playbooks) {
    const result = await processPlaybook(pb, opts);
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    const schemeTag = result.scheme ? ` [${result.scheme}]` : "";
    const reasonTag = result.reason ? ` — ${result.reason}` : "";
    console.log(`  ${pb.name}${schemeTag} → ${result.status}${reasonTag}`);
  }

  console.log(`\n[#1630 backfill] summary:`);
  for (const [status, n] of Object.entries(counts).sort()) {
    console.log(`  ${status}: ${n}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[#1630 backfill] fatal:", err);
  process.exit(1);
});
