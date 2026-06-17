/**
 * write-overall-band.ts — pipeline post-write helper that lands
 * `Session.metadata.overallBand` after per-part scoring (#1823).
 *
 * Called once from the pipeline route after `runPerSegmentScoring`
 * returns a non-zero row count. The write is best-effort:
 *  - Loud-skip via AppLog when `Call.sessionId` is null (Slice-3 cutover
 *    contract makes this case unreachable in steady state).
 *  - Loud-skip when zero qualifying per-segment rows exist (segmenter
 *    fallback already logged `prosody.segmentation.fallback`; no need
 *    to double-log).
 *  - JSON merge preserves any sibling keys (`pinnedCard`, `segmentLabels`,
 *    `scoreDeltas`) already written by other producers.
 *
 * No throws — every failure path logs and returns, mirroring the
 * per-segment scoring pass's `non-blocking` discipline.
 */
import { prisma } from "@/lib/prisma";
import { log as appLog } from "@/lib/logger";
import {
  computeOverallBandFromScores,
  type OverallBandInputRow,
} from "@/lib/pipeline/compute-overall-band";
import { getSkillTierMapping } from "@/lib/goals/track-progress";
import type { SessionMetadata } from "@/lib/types/json-fields";

export interface OverallBandWriteResult {
  written: boolean;
  band: number | null;
  reason: "ok" | "no_session" | "no_segment_scores" | "db_error";
}

export async function writeOverallBandForCall(
  callId: string,
  sessionId: string | null,
  playbookId: string | null,
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<OverallBandWriteResult> {
  if (!sessionId) {
    appLog("system", "pipeline.overall_band.no_session", {
      message: "Per-part scoring ran but Call.sessionId is null — overall band not written",
      callId,
    });
    log.warn("Overall band: Call.sessionId is null — skipping", { callId });
    return { written: false, band: null, reason: "no_session" };
  }

  try {
    const [rows, mapping] = await Promise.all([
      prisma.callScore.findMany({
        where: { callId, segmentKey: { not: null } },
        select: { parameterId: true, segmentKey: true, score: true },
      }),
      getSkillTierMapping(playbookId),
    ]);

    const inputRows: OverallBandInputRow[] = rows.map((r) => ({
      parameterId: r.parameterId,
      segmentKey: r.segmentKey,
      score: r.score,
    }));

    const band = computeOverallBandFromScores(inputRows, mapping);
    if (band === null) {
      log.info("Overall band: no qualifying per-segment rows — skipping write", {
        callId,
        sessionId,
        rowsRead: rows.length,
      });
      return { written: false, band: null, reason: "no_segment_scores" };
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const currentMetadata = (session?.metadata ?? {}) as SessionMetadata;
    const nextMetadata: SessionMetadata = { ...currentMetadata, overallBand: band };

    await prisma.session.update({
      where: { id: sessionId },
      data: { metadata: nextMetadata as object },
    });

    appLog("system", "pipeline.overall_band.written", {
      message: "Session.metadata.overallBand written from per-segment scores",
      callId,
      sessionId,
      band,
      bucketCount: new Set(inputRows.map((r) => `${r.parameterId}::${r.segmentKey}`)).size,
    });
    log.info("Overall band: written", { callId, sessionId, band });
    return { written: true, band, reason: "ok" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    appLog("system", "pipeline.overall_band.write_failed", {
      message: "Overall band write failed",
      callId,
      sessionId,
      error: msg,
    });
    log.warn("Overall band: write failed (non-blocking)", { callId, error: msg });
    return { written: false, band: null, reason: "db_error" };
  }
}
