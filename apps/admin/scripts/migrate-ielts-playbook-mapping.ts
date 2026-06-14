/**
 * One-off migration — write explicit IELTS Speaking tier mapping on
 * Playbooks that are IELTS-signal but rely on the silent IELTS fallback
 * (null `Playbook.config.skillTierMapping`) (#1657).
 *
 * Why a separate script and not the seed:
 *   - The pre-#1657 IELTS default lived in two layers below the per-Playbook
 *     override: SKILL_MEASURE_V1 contract (layer 2) and SKILL_TIER_DEFAULTS
 *     (layer 3). Both flip to Generic 4-tier in the same PR — so any
 *     IELTS course that was relying on either silent fallback will lose
 *     its IELTS bands the moment the reseed lands.
 *   - Running this script BEFORE the reseed pins IELTS bands per-course
 *     so IELTS scoring is unaffected by the SYSTEM-default change.
 *
 * Identification signals (any single signal is sufficient):
 *   1. Joined Subject name (via PlaybookSubject) contains "IELTS" (case-insensitive).
 *   2. `Playbook.config.tierPresetId === "ielts-speaking"`.
 *   3. `Playbook.config.assessmentMode === "ielts-speaking"`.
 *
 * Safety rules (run-anywhere idempotent):
 *   - Touches every Playbook row but only mutates when (a) it matches an
 *     IELTS signal AND (b) `config.skillTierMapping` is null/missing.
 *   - Rows with an explicit mapping already are left alone.
 *   - `--dry-run` (default) prints planned changes without writing.
 *   - `--execute` actually writes.
 *   - Re-runs are no-ops.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/migrate-ielts-playbook-mapping.ts
 *   npx tsx apps/admin/scripts/migrate-ielts-playbook-mapping.ts --execute
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const IELTS_MAPPING = {
  thresholds: {
    approachingEmerging: 0.3,
    emerging: 0.55,
    developing: 0.7,
    secure: 1.0,
  },
  tierBands: {
    approachingEmerging: 3,
    emerging: 4,
    developing: 5.5,
    secure: 7,
  },
  tierLabels: {
    approachingEmerging: "Band 3",
    emerging: "Band 4",
    developing: "Band 5.5",
    secure: "Band 7",
  },
} as const;

interface ConfigBlob {
  skillTierMapping?: unknown;
  tierPresetId?: unknown;
  assessmentMode?: unknown;
  [key: string]: unknown;
}

interface MappingShape {
  thresholds?: { secure?: unknown };
  tierBands?: { secure?: unknown };
}

function hasExplicitMapping(cfg: ConfigBlob): boolean {
  const m = cfg.skillTierMapping as MappingShape | null | undefined;
  if (!m || typeof m !== "object") return false;
  const thresholds = m.thresholds;
  const tierBands = m.tierBands;
  return (
    !!thresholds &&
    !!tierBands &&
    typeof thresholds.secure === "number" &&
    typeof tierBands.secure === "number"
  );
}

interface PlaybookRow {
  id: string;
  name: string;
  config: ConfigBlob | null;
  subjects: { subject: { name: string } }[];
}

function identifyIeltsSignal(p: PlaybookRow): string | null {
  const subjectNames = p.subjects.map((s) => s.subject.name);
  if (subjectNames.some((n) => /ielts/i.test(n))) {
    return `subject:${subjectNames.find((n) => /ielts/i.test(n))}`;
  }
  const cfg = p.config ?? {};
  if (cfg.tierPresetId === "ielts-speaking") return "config.tierPresetId=ielts-speaking";
  if (cfg.assessmentMode === "ielts-speaking") return "config.assessmentMode=ielts-speaking";
  return null;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`[migrate-ielts-mapping] running in ${mode} mode`);

  const rows = await prisma.playbook.findMany({
    select: {
      id: true,
      name: true,
      config: true,
      subjects: { select: { subject: { select: { name: true } } } },
    },
  });

  console.log(`[migrate-ielts-mapping] scanning ${rows.length} playbooks…`);

  let migrated = 0;
  let skippedAlreadyExplicit = 0;
  let skippedNotIelts = 0;

  for (const p of rows as PlaybookRow[]) {
    const cfg = p.config ?? {};
    const signal = identifyIeltsSignal(p);
    if (!signal) {
      skippedNotIelts++;
      continue;
    }
    if (hasExplicitMapping(cfg)) {
      skippedAlreadyExplicit++;
      console.log(
        `  - SKIP (already explicit) ${p.name} (id=${p.id.slice(0, 8)}) — signal: ${signal}`,
      );
      continue;
    }
    console.log(
      `  - ${execute ? "WRITE" : "WOULD WRITE"} IELTS mapping on ${p.name} (id=${p.id.slice(
        0,
        8,
      )}) — signal: ${signal}`,
    );
    if (execute) {
      const nextConfig = {
        ...cfg,
        skillTierMapping: IELTS_MAPPING,
      };
      await prisma.playbook.update({
        where: { id: p.id },
        data: { config: nextConfig as Prisma.InputJsonValue },
      });
    }
    migrated++;
  }

  console.log("");
  console.log("[migrate-ielts-mapping] summary:");
  console.log(`  ${execute ? "migrated" : "would migrate"}:    ${migrated}`);
  console.log(`  skipped (already explicit): ${skippedAlreadyExplicit}`);
  console.log(`  skipped (no IELTS signal):  ${skippedNotIelts}`);
  if (!execute && migrated > 0) {
    console.log("");
    console.log("[migrate-ielts-mapping] re-run with --execute to apply.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[migrate-ielts-mapping] failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
