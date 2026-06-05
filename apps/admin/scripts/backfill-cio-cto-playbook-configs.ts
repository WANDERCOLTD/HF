/**
 * Backfill — #1081 Slice 1 — promote the three existing CIO/CTO Playbooks'
 * `config` to the Slice 1 mastery-discipline keys.
 *
 * Slice 1 introduced `Playbook.config.useFreshMastery` and
 * `Playbook.config.maxMasteryTier` as the live AGGREGATE-write knobs. New
 * variants created via `create-variant.ts` get them automatically from
 * `PRESET_CONFIGS`. The three Playbooks below were created BEFORE the wire-up
 * and need a one-shot config merge.
 *
 * Rule applied (per-Playbook, all fields ONLY set when currently unset —
 * we never overwrite an operator's deliberate choice):
 *   - Revision Aid 5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0 → no change
 *     (intentionally uncapped; this is the funnel's mastery anchor).
 *   - Pop Quiz    405b210f-9a2b-4aca-b906-edcc758534a2 → maxMasteryTier="DEVELOPING"
 *   - Exam Assess 2d04ded7-19dc-46d3-afa5-b85d073778b4 → useFreshMastery=true
 *
 * Idempotent — re-runs find the keys already set and report "no-op".
 *
 * Usage:
 *   npx tsx scripts/backfill-cio-cto-playbook-configs.ts          # dry-run (default)
 *   npx tsx scripts/backfill-cio-cto-playbook-configs.ts --apply  # write
 *
 * Exit codes: 0 success / no-op, 1 unexpected error, 2 validation abort.
 */

import { prisma } from "../lib/prisma";
import type { Prisma } from "@prisma/client";

interface Target {
  id: string;
  label: string;
  expected: Prisma.JsonObject; // keys we want present
}

const TARGETS: Target[] = [
  {
    id: "5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0",
    label: "Revision Aid",
    expected: {}, // intentionally no discipline keys
  },
  {
    id: "405b210f-9a2b-4aca-b906-edcc758534a2",
    label: "Pop Quiz",
    expected: { maxMasteryTier: "DEVELOPING" },
  },
  {
    id: "2d04ded7-19dc-46d3-afa5-b85d073778b4",
    label: "Exam Assessment",
    expected: { useFreshMastery: true },
  },
];

function isJsonObject(v: unknown): v is Prisma.JsonObject {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  console.log(`[backfill-1081] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[backfill-1081] inspecting ${TARGETS.length} Playbook(s)`);

  let toWrite = 0;
  let noops = 0;
  let missing = 0;

  for (const t of TARGETS) {
    const row = await prisma.playbook.findUnique({
      where: { id: t.id },
      select: { id: true, name: true, config: true },
    });
    if (!row) {
      missing++;
      console.warn(`  MISSING  ${t.id.slice(0, 8)}  "${t.label}" — skipping`);
      continue;
    }

    const current: Prisma.JsonObject = isJsonObject(row.config) ? row.config : {};
    const proposed: Prisma.JsonObject = { ...current };
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    for (const [k, v] of Object.entries(t.expected)) {
      // Only set if currently unset — never overwrite an operator's choice.
      if (current[k] === undefined) {
        proposed[k] = v as Prisma.JsonValue;
        diff[k] = { from: undefined, to: v };
      }
    }

    if (Object.keys(diff).length === 0) {
      noops++;
      console.log(`  NOOP     ${t.id.slice(0, 8)}  "${row.name}"`);
      continue;
    }

    toWrite++;
    console.log(`  PATCH    ${t.id.slice(0, 8)}  "${row.name}"`);
    for (const [k, d] of Object.entries(diff)) {
      console.log(`           ${k}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
    }

    if (apply) {
      await prisma.$transaction(async (tx) => {
        // Re-read under the transaction to avoid clobbering a concurrent edit.
        const fresh = await tx.playbook.findUnique({
          where: { id: t.id },
          select: { config: true },
        });
        const freshCfg: Prisma.JsonObject = isJsonObject(fresh?.config) ? (fresh!.config as Prisma.JsonObject) : {};
        const merged: Prisma.JsonObject = { ...freshCfg };
        for (const [k, v] of Object.entries(t.expected)) {
          if (merged[k] === undefined) merged[k] = v as Prisma.JsonValue;
        }
        await tx.playbook.update({
          where: { id: t.id },
          data: { config: merged },
        });
      });
    }
  }

  console.log("");
  console.log(`[backfill-1081] summary: patch=${toWrite} noop=${noops} missing=${missing}`);
  console.log(`[backfill-1081] ${apply ? "APPLIED" : "DRY-RUN (no writes); re-run with --apply to commit."}`);

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[backfill-1081] FATAL", err);
    process.exit(1);
  });
