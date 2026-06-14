/**
 * detect-silent-writers.ts (#1622 / Epic #1618 Slice 1)
 *
 * Reads the rolling 24h window of `AppLog` rows emitted by
 * `write-count-logger.ts` and identifies (stage, table) pairs that have
 * received zero rows over the window. Fires a `pipeline.stage.silent_writer`
 * alarm row per silent pair.
 *
 * Distinction:
 *   - "unset" (the field is absent in every row over the window) →
 *     the stage doesn't write this table. NOT a silent writer.
 *   - "always-zero" (the field appears with `count === 0` in every row
 *     over the window) → the stage IS supposed to write this table but
 *     produced 0 rows over the window. ALARM.
 *
 * The detector runs on a schedule (Cloud Scheduler / cron, or
 * operator-invoked via the admin route in
 * `app/api/system/pipeline-health/route.ts`). Cron wiring is operator
 * deploy work; this module is pure detection logic.
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import {
  WRITE_COUNT_STAGE_PREFIX,
  SILENT_WRITER_ALARM_STAGE,
  type PipelineStageWriteCounts,
} from "./write-count-logger";

/** Default rolling-window size for the detector. */
export const DEFAULT_DETECTOR_WINDOW_HOURS = 24;

/** Result row — one per (stage, table) pair the detector evaluated. */
export interface SilentWriterFinding {
  stage: string;
  table: keyof PipelineStageWriteCounts;
  /** Total non-zero rows in the window — if 0 + samplesInWindow > 0, this is the alarm condition. */
  nonZeroRowCount: number;
  /** Total log rows where this stage was sampled (with this table present). */
  samplesInWindow: number;
  /** Sum of writes across the window. 0 + samplesInWindow > 0 = silent. */
  totalWrites: number;
  /** ISO timestamp of the most recent non-zero observation, if any. */
  lastNonZeroAt: string | null;
  /** True when samplesInWindow > 0 && totalWrites === 0 — the alarm condition. */
  silent: boolean;
}

/**
 * Walk the AppLog rows over the window, compute per-(stage, table) verdicts,
 * write `pipeline.stage.silent_writer` rows for every silent pair, and
 * return the full findings array so callers (admin UI tile + API route)
 * can render the current state without re-querying.
 */
export async function detectSilentWriters(args: {
  windowHours?: number;
} = {}): Promise<{
  windowHours: number;
  rowsScanned: number;
  findings: SilentWriterFinding[];
  alarmsFired: number;
}> {
  const windowHours = args.windowHours ?? DEFAULT_DETECTOR_WINDOW_HOURS;
  const windowMs = windowHours * 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  // Pull every write-count row from the window. The `stage` LIKE filter is
  // narrow — only rows emitted by `logStageWriteCounts` carry the prefix.
  const rows = await prisma.appLog.findMany({
    where: {
      stage: { startsWith: WRITE_COUNT_STAGE_PREFIX },
      createdAt: { gte: since },
    },
    select: { id: true, stage: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "desc" },
  });

  // Aggregate per (stage, table). The stage field on the metadata payload
  // is authoritative (canonical case); the AppLog `stage` column carries
  // lowercase for grep purposes.
  type Agg = {
    samples: number;
    totalWrites: number;
    nonZeroSamples: number;
    lastNonZeroAt: string | null;
  };
  const buckets = new Map<string, Map<keyof PipelineStageWriteCounts, Agg>>();

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as { stage?: string; writeCounts?: PipelineStageWriteCounts };
    const stage = meta.stage ?? row.stage.slice(WRITE_COUNT_STAGE_PREFIX.length).toUpperCase();
    const writeCounts = meta.writeCounts ?? {};
    let stageBucket = buckets.get(stage);
    if (!stageBucket) {
      stageBucket = new Map();
      buckets.set(stage, stageBucket);
    }
    for (const [tableKey, count] of Object.entries(writeCounts)) {
      const t = tableKey as keyof PipelineStageWriteCounts;
      const n = typeof count === "number" ? count : 0;
      const agg = stageBucket.get(t) ?? {
        samples: 0,
        totalWrites: 0,
        nonZeroSamples: 0,
        lastNonZeroAt: null,
      };
      agg.samples += 1;
      agg.totalWrites += n;
      if (n > 0) {
        agg.nonZeroSamples += 1;
        // rows come ordered desc, so the first non-zero we see is the latest
        if (agg.lastNonZeroAt === null) agg.lastNonZeroAt = row.createdAt.toISOString();
      }
      stageBucket.set(t, agg);
    }
  }

  const findings: SilentWriterFinding[] = [];
  for (const [stage, stageBucket] of buckets.entries()) {
    for (const [table, agg] of stageBucket.entries()) {
      const silent = agg.samples > 0 && agg.totalWrites === 0;
      findings.push({
        stage,
        table,
        nonZeroRowCount: agg.nonZeroSamples,
        samplesInWindow: agg.samples,
        totalWrites: agg.totalWrites,
        lastNonZeroAt: agg.lastNonZeroAt,
        silent,
      });
    }
  }

  // Fire one alarm per silent finding. Fire-and-forget through `log()`
  // — the alarm row is its own AppLog entry consumable by /x/logs and
  // by ops dashboards.
  let alarmsFired = 0;
  for (const f of findings) {
    if (!f.silent) continue;
    log("system", SILENT_WRITER_ALARM_STAGE, {
      message: `Silent writer: stage=${f.stage} table=${f.table} samples=${f.samplesInWindow} totalWrites=0`,
      level: "warn",
      stage: f.stage,
      table: f.table,
      windowHours,
      samplesInWindow: f.samplesInWindow,
      lastNonZeroAt: f.lastNonZeroAt,
    });
    alarmsFired += 1;
  }

  return {
    windowHours,
    rowsScanned: rows.length,
    findings,
    alarmsFired,
  };
}
