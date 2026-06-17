/**
 * SegmentKey namespace prefixes — single source of truth (#1872).
 *
 * Two writers produce `CallScore.segmentKey` annotations after #1870 lands:
 *
 *   - Text-side Mock segmenter (#1702) — writes `segmentKey = "text:" + slug`
 *     where slug is `"part1"` / `"part2"` / `"part3"` (Theme 6).
 *     Producer: `app/api/calls/[callId]/pipeline/route.ts` (per-segment MEASURE loop).
 *
 *   - Phase-boundary scheduler-derived prosody (#1870) — writes
 *     `segmentKey = "phase:" + phaseKey` where phaseKey is operator-chosen
 *     (`"p1"` / `"p2_prep"` / `"p2_monologue"` / `"p3"` for IELTS, but
 *     course-agnostic). Producer: `lib/pipeline/prosody-runner.ts`
 *     (`runSegmentedProsody`); consumer that propagates the prefix:
 *     `lib/pipeline/prosody-consumer.ts` (bySegment branch).
 *
 * The `(callId, parameterId, moduleId)` unique key on `CallScore` does NOT
 * include `segmentKey` (Epic #1700 Decision 1 — `segmentKey` is annotation,
 * not part of the unique key). Without prefixes the two writers can
 * silently overwrite each other's rows on a single call where both ran.
 *
 * Decision (Option 2 — namespace prefix) recorded in
 * [`docs/decisions/2026-06-17-segmentkey-namespace.md`](../../docs/decisions/2026-06-17-segmentkey-namespace.md).
 * Issue: [#1872](https://github.com/WANDERCOLTD/HF/issues/1872).
 *
 * NO HARDCODING: every other call site that writes a prefixed segmentKey
 * goes through `withTextNamespace(...)` / `withPhaseNamespace(...)`; every
 * reader that wants the bare value goes through `parseSegmentKey(...)`.
 * The string literals `"text:"` and `"phase:"` MUST appear exactly once —
 * here.
 */

export const SEGMENT_KEY_NAMESPACE = {
  TEXT: "text:",
  PHASE: "phase:",
} as const;

export type SegmentKeyNamespace =
  (typeof SEGMENT_KEY_NAMESPACE)[keyof typeof SEGMENT_KEY_NAMESPACE];

/**
 * Wrap a text-segmenter slug with the `text:` namespace prefix.
 *
 * Idempotent — re-wrapping an already-prefixed value returns the input
 * unchanged. This keeps the backfill migration safe to re-run.
 */
export function withTextNamespace(slug: string): string {
  if (slug.startsWith(SEGMENT_KEY_NAMESPACE.TEXT)) return slug;
  return `${SEGMENT_KEY_NAMESPACE.TEXT}${slug}`;
}

/**
 * Wrap a cue-scheduler phaseKey with the `phase:` namespace prefix.
 *
 * Idempotent — re-wrapping an already-prefixed value returns the input
 * unchanged.
 */
export function withPhaseNamespace(phaseKey: string): string {
  if (phaseKey.startsWith(SEGMENT_KEY_NAMESPACE.PHASE)) return phaseKey;
  return `${SEGMENT_KEY_NAMESPACE.PHASE}${phaseKey}`;
}

/**
 * Parse a `CallScore.segmentKey` value into its namespace + bare slug.
 *
 * Returns `{ namespace: "legacy", bare: key }` for any value that doesn't
 * carry one of the canonical prefixes — necessary tolerance for rows
 * written before the namespace landed (the hf-dev backfill migration
 * re-keys them but other environments may have legacy data until
 * deploy + backfill).
 */
export function parseSegmentKey(
  key: string,
): { namespace: SegmentKeyNamespace | "legacy"; bare: string } {
  if (key.startsWith(SEGMENT_KEY_NAMESPACE.TEXT)) {
    return {
      namespace: SEGMENT_KEY_NAMESPACE.TEXT,
      bare: key.slice(SEGMENT_KEY_NAMESPACE.TEXT.length),
    };
  }
  if (key.startsWith(SEGMENT_KEY_NAMESPACE.PHASE)) {
    return {
      namespace: SEGMENT_KEY_NAMESPACE.PHASE,
      bare: key.slice(SEGMENT_KEY_NAMESPACE.PHASE.length),
    };
  }
  return { namespace: "legacy", bare: key };
}

/**
 * Human-readable label for a parsed segmentKey. Course-agnostic — handles
 * the IELTS Mock convention (`part1` → "Part 1"; `p2_monologue` →
 * "Part 2 (monologue)") and falls through to the raw bare value for any
 * unrecognised shape.
 *
 * Used by the Student Results UI to render column headers. Kept in the
 * namespace module (rather than in JSX) so the IELTS-specific mappings
 * are derived from a single canonical set rather than hardcoded inline.
 */
export function segmentKeyLabel(key: string): string {
  const parsed = parseSegmentKey(key);
  return labelForBareValue(parsed.bare);
}

function labelForBareValue(bare: string): string {
  // IELTS text-segmenter convention: `part1` / `part2` / `part3`
  const partMatch = /^part(\d+)$/i.exec(bare);
  if (partMatch) return `Part ${partMatch[1]}`;

  // IELTS phase-boundary convention: `p1` / `p2_prep` / `p2_monologue` / `p3`
  const phaseMatch = /^p(\d+)(?:_(.+))?$/i.exec(bare);
  if (phaseMatch) {
    const partNum = phaseMatch[1];
    const qualifier = phaseMatch[2];
    if (qualifier) return `Part ${partNum} (${qualifier.replace(/_/g, " ")})`;
    return `Part ${partNum}`;
  }

  // Fall-through — return the bare value (caller may further humanise).
  return bare;
}
