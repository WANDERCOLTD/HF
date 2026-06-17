/**
 * compute-overall-band.ts — canonical Mock overall band derivation.
 *
 * Single source of truth for the computation that produces
 * `Session.metadata.overallBand`. Both the pipeline writer
 * (`write-overall-band.ts`) and the Results-screen reader
 * (`/api/student/[courseId]/results/[sessionId]/route.ts`) call this
 * helper so the canonical metadata value and the on-the-fly fallback
 * cannot disagree (Lattice — sibling-writer convergence on a derived
 * value: same algorithm in both places). See #1823.
 *
 * Algorithm — mirrors the Theme 13a reader's mean-of-12 fallback:
 *   1. Bucket non-null-segmentKey CallScore rows by `(parameterId, segmentKey)`.
 *   2. Per bucket: mean of `score` values.
 *   3. Convert each bucket mean to a band via `scoreToTier(mean, mapping)`.
 *   4. Overall band = arithmetic mean of bucket bands, half-band rounded.
 *
 * Bucket selection — only rows with a non-null `segmentKey` contribute.
 * Whole-call / bound-module rows (`segmentKey === null`) feed the
 * existing weakSkill / diagnostic readers and are deliberately excluded
 * from the Mock overall band (Theme 6 / #1702 boundary).
 *
 * Returns `null` when there are zero qualifying rows — caller decides
 * whether to skip the write or write a sentinel.
 */
import { scoreToTier, type SkillTierMapping } from "@/lib/goals/track-progress";

export interface OverallBandInputRow {
  parameterId: string;
  segmentKey: string | null;
  score: number;
}

export function roundHalfBand(value: number): number {
  return Math.round(value * 2) / 2;
}

export function computeOverallBandFromScores(
  rows: ReadonlyArray<OverallBandInputRow>,
  mapping: SkillTierMapping,
): number | null {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    if (row.segmentKey === null) continue;
    const key = `${row.parameterId}::${row.segmentKey}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.sum += row.score;
      bucket.count += 1;
    } else {
      buckets.set(key, { sum: row.score, count: 1 });
    }
  }
  if (buckets.size === 0) return null;

  let bandSum = 0;
  for (const b of buckets.values()) {
    const mean = b.sum / b.count;
    const { band } = scoreToTier(mean, mapping);
    bandSum += band;
  }
  const meanBand = bandSum / buckets.size;
  return roundHalfBand(meanBand);
}
