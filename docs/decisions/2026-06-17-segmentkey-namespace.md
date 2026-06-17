# `CallScore.segmentKey` namespace prefix (`text:` / `phase:`)

**Date:** 2026-06-17
**Story:** [#1872](https://github.com/WANDERCOLTD/HF/issues/1872) (follow-on to [#1762](https://github.com/WANDERCOLTD/HF/issues/1762))
**Related PR:** [#1877](https://github.com/WANDERCOLTD/HF/pull/1877) — phase-side writer landed with the `phase:` prefix as a string literal ahead of this ADR; this PR centralises the literal in a single source of truth.
**Decision:** Option 2 — namespace prefix (`text:` for text-segmenter writes, `phase:` for cue-scheduler / phase-boundary writes).
**Status:** Accepted

## Context

Two writers produce `CallScore.segmentKey` annotations after epic #1762
lands:

| Writer | Source | segmentKey values |
|---|---|---|
| Text-side Mock segmenter (#1702, shipped Theme 6) | `lib/curriculum/segment-mock-transcript.ts` (regex over transcript text) → consumed by per-segment MEASURE loop in `app/api/calls/[callId]/pipeline/route.ts` | `"part1"` / `"part2"` / `"part3"` |
| Phase-boundary prosody (#1870 / PR #1877) | `lib/voice/cue-scheduler.ts` writes `Session.metadata.phaseBoundaries` from operator-chosen `phase` slugs; `lib/pipeline/prosody-runner.ts::runSegmentedProsody` reads them and emits per-phase CallScore rows | Operator-chosen: `"p1"` / `"p2_prep"` / `"p2_monologue"` / `"p3"` for IELTS Mock; course-agnostic in general |

Both writers go through `writeCallScore(...)` with the same idempotency
shape: `@@unique([callId, parameterId, moduleId])`. The unique key does
**NOT** include `segmentKey` (Epic #1700 Decision 1 — annotation, not part
of the unique key). On any call where both writers ran, the second writer
**overwrote the first** for any `(callId, parameterId, moduleId)` it
touched, with no visible error — silent data loss.

Verified pre-fix at the time of #1872 filing:

- `lib/curriculum/segment-mock-transcript.ts:37-48` — `TranscriptSegment.slug` is the raw `"part1"` / `"part2"` / `"part3"` (Theme 6).
- `app/api/calls/[callId]/pipeline/route.ts:787-788` (pre-PR) — pipeline writer passed `segmentKey: segment.slug` (the raw slug).
- `lib/voice/phase-boundaries.ts` (post-#1866) emits raw `phase` strings ("p1" / "p2_prep" / etc.).
- `prisma/schema.prisma` — `@@unique([callId, parameterId, moduleId])` on `CallScore` does NOT include `segmentKey`.
- `app/x/student/[courseId]/results/[sessionId]/page.tsx:131-133` (pre-PR) — Results UI read bare `segmentKey` values into column headers.

## Options considered

### Option 1 — Unify the namespace

Pick one canonical set (`"part1"` / `"part2"` / `"part3"` since Theme 6
already shipped). The cue-scheduler maps its phase names to the canonical
form at write-time.

| Pro | Con |
|---|---|
| One reader, one writer namespace | Loses Part 2's prep-vs-monologue split (`"p2_prep"` + `"p2_monologue"` collapse to `"part2"`). Operator-chosen granularity becomes silently coarser. |

### Option 2 — Namespace prefix **(chosen)**

Text segmenter writes `"text:" + slug`. Cue-scheduler writes
`"phase:" + phaseKey`. Both prefixes live in
[`lib/pipeline/segment-key-namespace.ts`](../../apps/admin/lib/pipeline/segment-key-namespace.ts);
every other call site goes through `withTextNamespace(...)` /
`withPhaseNamespace(...)` (writers) or `parseSegmentKey(...)` (readers).

| Pro | Con |
|---|---|
| Lossless — Theme 6 keeps its three-part view; cue-scheduler keeps Part 2 fine-grain (`prep` / `monologue`) | Two namespaces in one UI surface; readers must handle both via `parseSegmentKey(...)` |
| Self-documenting in the DB — `"text:part1"` vs `"phase:p1"` is unambiguous in any query result | One-time backfill needed on hf_sandbox (production environments are unaffected — the phase writer was born prefixed) |
| Single source of truth for the prefix strings; future renames are a one-file change | |

### Option 3 — Disjoint scoring contracts

Text segmenter writes against `analysisSpecId: PROSODY` (existing);
cue-scheduler writes against `analysisSpecId: PROSODY_PHASE` (new sentinel).
Unique key includes `analysisSpecId`, so writes don't collide.

| Pro | Con |
|---|---|
| Strongest isolation; readers explicitly opt in | Two sentinel specs to maintain (with parallel seed rows) |
| | UI surfaces double their query shape (every Results-style consumer queries both spec ids) |
| | Loses the unified "this is a prosody score" lineage in the audit trail |

## Decision: Option 2 — namespace prefix

The text-segmenter and cue-scheduler are not really the same kind of data
— one is text-derived, the other recording-derived — but they share the
same column for good reasons (idempotency model, EMA aggregation surface,
Snapshot v3 lens path). A namespace prefix preserves that sharing while
making the writer-origin explicit at every read.

Lossless granularity (vs. Option 1) is the load-bearing tradeoff.
Operators tuned `"p2_prep"` vs `"p2_monologue"` deliberately at the
cue-scheduler level; collapsing them silently for Mock display would hide
that intent. Option 1 also forces every future course author to think
about whether their phase slugs collide with the canonical Mock slugs —
that's an avoidable footgun.

Self-documentation (vs. Option 3) is the second tradeoff. A DB query for
"prosody scores for caller X" should not have to remember which of two
sentinel spec ids each writer used. The prefix makes the origin visible
at the row level without exploding the schema.

## Implementation

Constants live ONCE at
[`apps/admin/lib/pipeline/segment-key-namespace.ts`](../../apps/admin/lib/pipeline/segment-key-namespace.ts).
Helpers:

- `withTextNamespace(slug)` — idempotent wrapper for text-segmenter writes.
- `withPhaseNamespace(phaseKey)` — idempotent wrapper for cue-scheduler / prosody writes.
- `parseSegmentKey(key)` — returns `{ namespace, bare }`; falls through to `{ namespace: "legacy", bare: key }` for un-backfilled rows.
- `segmentKeyLabel(key)` — IELTS-aware human label ("text:part1" → "Part 1"; "phase:p2_monologue" → "Part 2 (monologue)"); course-agnostic fall-through.

Writers updated to call the helpers:

- `app/api/calls/[callId]/pipeline/route.ts` (text segmenter MEASURE loop).
- `lib/pipeline/prosody-runner.ts::runSegmentedProsody` (phase-boundary path — PR #1877's literal `"phase:" + boundary.phase` refactored to `withPhaseNamespace(boundary.phase)`).

Reader updated to render via the helpers:

- `app/x/student/[courseId]/results/[sessionId]/page.tsx` — uses `segmentKeyLabel(...)` for column headers; legacy (un-backfilled) rows still render via the fall-through.

## Backfill

`apps/admin/prisma/migrations/20260617145200_1872_segmentkey_namespace_backfill/migration.sql`:

```sql
UPDATE "CallScore"
SET "segmentKey" = 'text:' || "segmentKey"
WHERE "segmentKey" IN ('part1', 'part2', 'part3')
  AND "segmentKey" NOT LIKE 'text:%'
  AND "segmentKey" NOT LIKE 'phase:%';

UPDATE "CallScore"
SET "segmentKey" = 'phase:' || "segmentKey"
WHERE "segmentKey" IN ('p1', 'p2_prep', 'p2_monologue', 'p3')
  AND "segmentKey" NOT LIKE 'text:%'
  AND "segmentKey" NOT LIKE 'phase:%';
```

Idempotent — the `NOT LIKE 'text:%' AND NOT LIKE 'phase:%'` clauses ensure
a second run changes zero rows. Narrowed by exact bare-slug list (not by
`analysisSpecId`) because the text segmenter writes against `parentSpec`
or the MOCK sentinel — there is no single spec id that scopes the
collision-prone rows.

## Guards against regression

- `apps/admin/tests/lib/pipeline/segment-key-namespace.test.ts` — constants, idempotency, round-trip, label derivation, **grep-based ratchet** (scans `lib/pipeline/` for bare `segmentKey: "partN"` / `segmentKey: "pN_*"` literals outside the helpers and fails if any exist).
- Existing prosody-consumer and prosody-runner segmented tests updated to derive expected strings from `withPhaseNamespace(...)` (not from string literals), so a future namespace change reaches both sides of the assertion atomically.

## Deploy

`/vm-cpp` — code + backfill migration. Cloud Run deploys carry the
migration via the standard `hf-migrate-*` job.
