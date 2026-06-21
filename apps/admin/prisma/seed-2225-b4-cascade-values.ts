/**
 * Epic #2225 B4-impl — Seed approved cascade values for 3 wizard-created
 * playbooks (Big Five OCEAN / Spot the Spin / CIO/CTO Standard — Revision
 * Aid). The IELTS Speaking Practice playbook is handled directly in
 * `prisma/seed-ielts-course.ts` (the canonical seed that creates it).
 *
 * Approved values: https://github.com/WANDERCOLTD/HF/issues/2225#issuecomment-4763486228
 * B4 proposal: https://github.com/WANDERCOLTD/HF/issues/2225#issuecomment-4763475679
 *
 * What this seed does (idempotent — conservative "only-if-unset" merge):
 *
 *   For each of the 3 target playbooks, found by `Playbook.name` substring
 *   match, merge the approved cascade values into `Playbook.config` ONLY
 *   when the key is currently absent. We never overwrite an operator's
 *   deliberate choice — mirrors the pattern of
 *   `scripts/backfill-cio-cto-playbook-configs.ts` (#1081).
 *
 *   - Big Five OCEAN              → tierPresetId, skillScoringEmaHalfLifeDays
 *   - Spot the Spin (Seducing…)    → tierPresetId, skillScoringEmaHalfLifeDays
 *   - CIO/CTO Standard Revision Aid → voiceConfig.{maxDurationSeconds,
 *     silenceTimeoutSeconds}, tierPresetId="custom" + skillTierMapping,
 *     skillScoringEmaHalfLifeDays, progressSignals=null (operator-approved
 *     explicit null — disables progress narrator per silent-scoring pedagogy;
 *     see `lib/prompt/composition/scoring-config.ts:80-81` which reads via
 *     optional chain, so `null` resolves to undefined → no signal rendered).
 *
 * Lattice survey result:
 *   - storagePath `playbook.voiceConfig.maxDurationSeconds` → writes to
 *     `Playbook.config.voiceConfig.maxDurationSeconds` per
 *     `lib/journey/storage-path-applier.ts:107` (verified).
 *   - `tierPresetId` + `skillScoringEmaHalfLifeDays` + `skillTierMapping`
 *     are all in `CASCADABLE_KEYS` per
 *     `lib/cascade/resolvers/mastery-policy.ts:75-82` (verified).
 *   - `tierPresetId: "custom"` is a valid TierPresetId per
 *     `lib/banding/presets.ts:170-189` — co-seeded `skillTierMapping`
 *     is the canonical opt-out-of-preset pattern (verified).
 *   - `progressSignals` reader uses optional chain
 *     `config.progressSignals?.lowWater` → `null` survives at runtime
 *     (verified at `lib/prompt/composition/scoring-config.ts:80-81`).
 *
 * Sibling-writer convergence:
 *   - `scripts/seed-ielts-prosody.ts` sets `tierPresetId="ielts-speaking"`
 *     on IELTS playbooks only — disjoint from this script's targets.
 *   - `scripts/backfill-cio-cto-playbook-configs.ts` (#1081) sets
 *     `useFreshMastery` / `maxMasteryTier` on CIO/CTO playbooks — disjoint
 *     keys; safe to coexist on Revision Aid (which gets {} from that
 *     script).
 *   - `scripts/fix-cio-cto-playbooks.ts` writes other Playbook columns
 *     (validationPassed, measureSpecCount, etc.) — does not touch the
 *     keys this script writes.
 *
 * Usage:
 *   npx tsx prisma/seed-2225-b4-cascade-values.ts          # dry-run (default)
 *   npx tsx prisma/seed-2225-b4-cascade-values.ts --apply  # write
 *
 * Idempotent: re-runs report "NOOP" for keys already present. Profiles:
 * post-projection (run after the 3 target playbooks exist on the DB).
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

interface Target {
  /** `Playbook.name` substring match (case-sensitive). */
  playbookNameMatch: string;
  /** Human label for log output. */
  label: string;
  /** Keys to merge into `Playbook.config` when currently unset. */
  expected: Prisma.JsonObject;
}

const TARGETS: Target[] = [
  {
    playbookNameMatch: "Big Five",
    label: "Big Five OCEAN",
    expected: {
      tierPresetId: "generic",
      skillScoringEmaHalfLifeDays: 7,
    },
  },
  {
    playbookNameMatch: "Spot the Spin",
    label: "Spot the Spin (Seducing Strangers)",
    expected: {
      tierPresetId: "generic",
      skillScoringEmaHalfLifeDays: 7,
    },
  },
  {
    playbookNameMatch: "Revision Aid",
    label: "CIO/CTO Standard — Revision Aid",
    expected: {
      voiceConfig: {
        maxDurationSeconds: 1500,
        silenceTimeoutSeconds: 60,
      },
      tierPresetId: "custom",
      skillTierMapping: {
        thresholds: {
          approachingEmerging: 0.25,
          emerging: 0.45,
          developing: 0.7,
          secure: 1.0,
        },
        tierBands: {
          approachingEmerging: 1,
          emerging: 2,
          developing: 3,
          secure: 4,
        },
        tierLabels: {
          approachingEmerging: "Foundation",
          emerging: "Developing",
          developing: "Practitioner",
          secure: "Distinction",
        },
      },
      skillScoringEmaHalfLifeDays: 21,
      // Explicit null per operator decision — disables progress narrator
      // per silent-scoring pedagogy. Reader at
      // `lib/prompt/composition/scoring-config.ts:80-81` uses optional
      // chain (`config.progressSignals?.lowWater`) so null resolves to
      // undefined → no progress signal rendered (verified).
      progressSignals: null,
    },
  },
];

function isJsonObject(v: unknown): v is Prisma.JsonObject {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

interface PatchAction {
  playbookId: string;
  playbookName: string;
  diff: Record<string, { from: unknown; to: unknown }>;
}

export interface SeedReport {
  mode: "DRY-RUN" | "APPLY";
  patches: PatchAction[];
  noops: number;
  missing: number;
}

async function main(): Promise<SeedReport> {
  const apply = process.argv.includes("--apply");
  const mode: "DRY-RUN" | "APPLY" = apply ? "APPLY" : "DRY-RUN";

  console.log(`[seed-2225-b4] mode=${mode}`);
  console.log(`[seed-2225-b4] inspecting ${TARGETS.length} target playbook(s)`);

  const patches: PatchAction[] = [];
  let noops = 0;
  let missing = 0;

  for (const t of TARGETS) {
    const row = await prisma.playbook.findFirst({
      where: { name: { contains: t.playbookNameMatch } },
      select: { id: true, name: true, config: true },
    });
    if (!row) {
      missing++;
      console.warn(
        `  MISSING  "${t.playbookNameMatch}" — no playbook with that substring; skipping ("${t.label}")`,
      );
      continue;
    }

    const current: Prisma.JsonObject = isJsonObject(row.config) ? (row.config as Prisma.JsonObject) : {};
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    for (const [k, v] of Object.entries(t.expected)) {
      if (current[k] === undefined) {
        diff[k] = { from: undefined, to: v };
      }
    }

    if (Object.keys(diff).length === 0) {
      noops++;
      console.log(`  NOOP     ${row.id.slice(0, 8)}  "${row.name}" — all keys already present`);
      continue;
    }

    console.log(`  PATCH    ${row.id.slice(0, 8)}  "${row.name}" (${t.label})`);
    for (const [k, d] of Object.entries(diff)) {
      console.log(`           ${k}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
    }

    patches.push({ playbookId: row.id, playbookName: row.name, diff });

    if (apply) {
      await prisma.$transaction(async (tx) => {
        // Re-read under the transaction to avoid clobbering a concurrent edit.
        const fresh = await tx.playbook.findUnique({
          where: { id: row.id },
          select: { config: true },
        });
        const freshCfg: Prisma.JsonObject = isJsonObject(fresh?.config)
          ? (fresh!.config as Prisma.JsonObject)
          : {};
        const merged: Prisma.JsonObject = { ...freshCfg };
        for (const [k, v] of Object.entries(t.expected)) {
          if (merged[k] === undefined) {
            merged[k] = v as Prisma.JsonValue;
          }
        }
        await tx.playbook.update({
          where: { id: row.id },
          data: { config: merged },
        });
      });
    }
  }

  console.log("");
  console.log(
    `[seed-2225-b4] summary: patch=${patches.length} noop=${noops} missing=${missing}`,
  );
  console.log(
    `[seed-2225-b4] ${apply ? "APPLIED" : "DRY-RUN (no writes); re-run with --apply to commit."}`,
  );

  return { mode, patches, noops, missing };
}

// Run as CLI when invoked directly. Skip when imported (e.g. by tests).
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed-2225-b4] FATAL", err);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { main as runSeed };
