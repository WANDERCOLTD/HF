-- #1872 — segmentKey namespace prefix backfill.
--
-- Two writers produce CallScore.segmentKey annotations after #1870 lands:
--   * Text-side Mock segmenter (#1702)         → "text:" prefix
--   * Phase-boundary prosody (#1870 / PR #1877) → "phase:" prefix
--
-- Bare slugs ("part1" / "part2" / "part3") existed in hf_sandbox from
-- Theme 6 runs before the prefix landed. Re-key them to the "text:"
-- namespace so the union-namespace reader (Student Results UI) can
-- distinguish them from phase-keyed rows the prosody runner now writes
-- with a "phase:" prefix.
--
-- The phase writer (`runSegmentedProsody`) has always emitted the
-- prefixed form (`phase:p1`/`phase:p2_*`/`phase:p3`), so the phase side
-- does not require a backfill. We still include a defensive UPDATE for
-- the operator-chosen `p1` / `p2_prep` / `p2_monologue` / `p3` shapes in
-- case any environment captured the bare form before #1877 shipped.
--
-- Idempotency:
--   * The WHERE clause excludes rows that already start with `text:` or
--     `phase:` — re-running this migration is a no-op once the rows are
--     namespaced.
--   * Match is exact on the bare slug set to avoid renaming arbitrary
--     operator-chosen values (course-agnostic segment slugs may exist
--     in non-IELTS courses that this migration must NOT touch).
--
-- Safety:
--   * Production (sandbox / pilot / prod) does not yet carry bare-slug
--     rows — the namespace is born of the same epic that introduces the
--     phase writer. The UPDATEs are therefore safe no-ops on prod, but
--     necessary on hf_sandbox where developer runs have populated the
--     bare-slug shape.
--
-- Reverse (emergency rollback — do NOT auto-apply):
--   UPDATE "CallScore" SET "segmentKey" = SUBSTRING("segmentKey" FROM 6)
--     WHERE "segmentKey" LIKE 'text:%';
--   UPDATE "CallScore" SET "segmentKey" = SUBSTRING("segmentKey" FROM 7)
--     WHERE "segmentKey" LIKE 'phase:%';
-- (collisions in the resulting space are the original #1872 bug; the
-- forward migration is preferred.)

-- Text-segmenter rows: bare "part1" / "part2" / "part3" → "text:part…".
UPDATE "CallScore"
SET "segmentKey" = 'text:' || "segmentKey"
WHERE "segmentKey" IN ('part1', 'part2', 'part3')
  AND "segmentKey" NOT LIKE 'text:%'
  AND "segmentKey" NOT LIKE 'phase:%';

-- Phase-boundary rows (defensive — runner has always prefixed, but a
-- pre-#1877 manual write could have landed bare). IELTS Mock convention
-- only; non-IELTS phase slugs are untouched.
UPDATE "CallScore"
SET "segmentKey" = 'phase:' || "segmentKey"
WHERE "segmentKey" IN ('p1', 'p2_prep', 'p2_monologue', 'p3')
  AND "segmentKey" NOT LIKE 'text:%'
  AND "segmentKey" NOT LIKE 'phase:%';
