/**
 * Drain script — backfill `analysisSpecId` on historical `CallScore` rows.
 *
 * #1539 — every CallScore row from before this PR carries
 * `analysisSpecId = NULL`. The structural fix lands the column write
 * for new rows; this script drains the historical population.
 *
 * ## Attribution rule
 *
 * For each NULL row, look up the active MEASURE specs that resolve the
 * row's `parameterId` (via the spec's trigger.actions chain). When
 * exactly ONE spec resolves to the parameter, attribute the row to that
 * spec. When zero or multiple specs resolve, mark the row with the
 * `LEGACY-UNSPECCED-PRE-1539` sentinel so the lineage is honest about
 * being unrecoverable.
 *
 * Honest about its limits: the script cannot recover the actual spec
 * id that produced a historical row when multiple specs match the
 * parameter today. The legacy sentinel marks those rows so they show
 * up in the I-AL6 dashboard until the operator decides whether to
 * delete or re-extract.
 *
 * ## Safety
 *
 * - **Dry-run by default.** Prints what it would do without writing.
 *   Pass `--apply` to commit.
 * - **Idempotent.** Re-runs skip rows that already have an
 *   `analysisSpecId`. Safe to re-run after a failure.
 * - **Batched** — processes 1000 rows per chunk to keep memory flat.
 *
 * Usage:
 *   npx tsx scripts/backfill-call-score-analysis-spec.ts            # dry-run
 *   npx tsx scripts/backfill-call-score-analysis-spec.ts --apply    # write
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LEGACY_SENTINEL_ID = "LEGACY-UNSPECCED-PRE-1539";
const LEGACY_SENTINEL_SLUG = "LEGACY-UNSPECCED-PRE-1539";

const CHUNK_SIZE = 1000;

interface DrainCounts {
  scanned: number;
  attributed: number;
  legacyMarked: number;
  alreadyStamped: number;
}

async function ensureLegacySentinel(apply: boolean): Promise<void> {
  if (!apply) return;
  await prisma.analysisSpec.upsert({
    where: { id: LEGACY_SENTINEL_ID },
    update: {},
    create: {
      id: LEGACY_SENTINEL_ID,
      slug: LEGACY_SENTINEL_SLUG,
      name: "Legacy CallScore rows pre-#1539 (no recoverable lineage)",
      description:
        "Sentinel for CallScore rows whose original AnalysisSpec is " +
        "unrecoverable — either zero or multiple active MEASURE specs " +
        "resolve to the row's parameter today. The row was scored before " +
        "#1539 added structural spec stamping. Surface via I-AL6 to " +
        "decide whether to delete or re-extract.",
      promptTemplate:
        "No recoverable rubric. The row was scored by runBatchedCallerAnalysis " +
        "before #1539 wired analysisSpecId stamping. The drain script could " +
        "not attribute it because the (parameterId → active MEASURE spec) " +
        "mapping is no longer 1:1.",
      scope: "SYSTEM",
      outputType: "MEASURE",
      specType: "SYSTEM",
      specRole: "EXTRACT",
      isActive: true,
    },
  });
}

async function buildParameterToSpecsMap(): Promise<Map<string, string[]>> {
  const specs = await prisma.analysisSpec.findMany({
    where: {
      isActive: true,
      outputType: { in: ["MEASURE", "LEARN"] },
    },
    include: {
      triggers: {
        include: { actions: true },
      },
    },
  });

  const out = new Map<string, string[]>();
  for (const spec of specs) {
    for (const trigger of spec.triggers) {
      for (const action of trigger.actions) {
        if (!action.parameterId) continue;
        const list = out.get(action.parameterId) ?? [];
        if (!list.includes(spec.id)) list.push(spec.id);
        out.set(action.parameterId, list);
      }
    }
  }
  return out;
}

async function drainChunk(
  paramToSpecs: Map<string, string[]>,
  cursor: string | null,
  counts: DrainCounts,
  apply: boolean,
): Promise<string | null> {
  const rows = await prisma.callScore.findMany({
    where: { analysisSpecId: null },
    select: { id: true, parameterId: true, callId: true },
    orderBy: { id: "asc" },
    take: CHUNK_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  if (rows.length === 0) return null;

  for (const row of rows) {
    counts.scanned++;
    const candidates = paramToSpecs.get(row.parameterId) ?? [];
    if (candidates.length === 1) {
      counts.attributed++;
      if (apply) {
        await prisma.callScore.update({
          where: { id: row.id },
          data: { analysisSpecId: candidates[0] },
        });
      }
    } else {
      counts.legacyMarked++;
      if (apply) {
        await prisma.callScore.update({
          where: { id: row.id },
          data: { analysisSpecId: LEGACY_SENTINEL_ID },
        });
      }
    }
  }

  return rows[rows.length - 1]!.id;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
   
  console.log(
    `[backfill #1539] ${apply ? "APPLY" : "DRY-RUN"} — backfilling CallScore.analysisSpecId on NULL rows.`,
  );

  await ensureLegacySentinel(apply);

  const paramToSpecs = await buildParameterToSpecsMap();
   
  console.log(
    `[backfill #1539] resolved ${paramToSpecs.size} parameters from active MEASURE/LEARN specs.`,
  );

  const counts: DrainCounts = {
    scanned: 0,
    attributed: 0,
    legacyMarked: 0,
    alreadyStamped: 0,
  };

  let cursor: string | null = null;
  while (true) {
    cursor = await drainChunk(paramToSpecs, cursor, counts, apply);
    if (cursor === null) break;
    if (counts.scanned % 5000 === 0) {
       
      console.log(
        `[backfill #1539] progress — scanned=${counts.scanned} attributed=${counts.attributed} legacy=${counts.legacyMarked}`,
      );
    }
  }

   
  console.log(`[backfill #1539] DONE — ${JSON.stringify(counts)}`);
   
  console.log(
    apply
      ? `[backfill #1539] APPLIED — historical NULL rows are drained. Run I-AL6 audit query to verify zero remain.`
      : `[backfill #1539] DRY-RUN — re-run with --apply to commit.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
     
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
