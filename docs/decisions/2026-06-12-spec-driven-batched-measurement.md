# ADR — Spec-driven batched measurement (close the spec-lineage gap)

**Date:** 2026-06-12
**Status:** Accepted
**Epic:** [#1539](https://github.com/WANDERCOLTD/HF/issues/1539) — Measurement runtime contract reconciliation
**Sibling:** [#1538](https://github.com/WANDERCOLTD/HF/issues/1538) — IELTS-specific MEASURE specs (waits on this contract)

## Context

A live audit on hf_sandbox on 2026-06-12 showed every `CallScore` row in the
last 14 days (1125/1125) carries `analysisSpecId = NULL`. The schema column
exists with a foreign key to `AnalysisSpec` and an index — it was wired for
this exact purpose and never populated.

Phase 1 investigation (`docs/audit/spec-lineage-gap-2026-06-12.md`) traced
the gap into two structural defects in `runBatchedCallerAnalysis` (the
production EXTRACT scorer):

1. **Rubric is never injected.** `buildBatchedCallerPrompt` builds a prompt
   body from `parameterId:name` pairs only:

   ```ts
   const paramList = measureParams.map(p => `${p.parameterId}:${p.name}`).join("|");
   ```

   The LLM scores `IELTS-FLUENCY` based on its own internalised idea of
   "fluency" — it never sees the IELTS band 1-9 descriptors stored in
   `AnalysisSpec.promptTemplate`. The MEASURE spec is loaded, then dropped.

2. **Spec lineage is never written.** Every `CallScore` row created by
   either the mock branch or the real-engine branch omits `analysisSpecId`.
   No structural trace exists from a stored band to the rubric that
   produced it. The same defect repeats in the PROSODY consumer and the
   per-segment scorer.

Net effect: measurement is *unspecced*. The calibration question — "do
the scores track the IELTS bands?" — presumes the model knows what an
IELTS band is. It doesn't.

## Decision

**Every `CallScore` row written by the production pipeline carries the
`analysisSpecId` of the `AnalysisSpec` whose rubric (`promptTemplate`)
graded that parameter.** When the spec carries a `promptTemplate`, the
batched prompt body interpolates it verbatim into a per-parameter rubric
block. The interpolation contract and the write contract are enforced by
a single chokepoint helper plus an ESLint rule, mirroring the
`createCallEnteringPipeline` + `no-bare-call-create` pattern from #1333.

Concrete shape:

- New helper `lib/measurement/write-call-score.ts::writeCallScore({...,
  analysisSpecId})` — `analysisSpecId` is **required** in the TypeScript
  type and the function asserts non-empty at runtime. Wraps the existing
  `(callId, parameterId, moduleId)` unique index via `upsert`.
- New helper `lib/measurement/parameter-spec-map.ts::buildParameterSpecMap`
  — keeps the spec→parameter mapping (lost today by `batchLoadParameters`).
  Returns `Map<parameterId, { parameterId, name, definition, analysisSpecId,
  specSlug, promptTemplate }>` and prefers the highest-`priority` spec on
  collision.
- New helper `lib/measurement/build-batched-measure-prompt.ts` — extracted
  from `route.ts::buildBatchedCallerPrompt`. Accepts the param-with-spec
  array, emits one `RUBRIC[<parameterId>]:\n<promptTemplate>` block per
  parameter that has a rubric, falls back to definition-only for params
  with `promptTemplate = null` and logs a `[measure] unspecced` warning.
- ADAPT delta writes (`<parameterId>-DELTA` rows) inherit the parent
  parameter's spec — the same `analysisSpecId` is stamped so cohort-level
  lineage stays consistent.
- PROSODY writes stamp the PROSODY adapter's logical spec id (a system
  marker `PROSODY-SCORE-V1`) until the PROSODY spec model lands. This is
  honest "produced by PROSODY, not LLM" lineage rather than NULL.

## Enforcement

| Layer | Mechanism | What it blocks |
|---|---|---|
| Type system | `WriteCallScoreInput.analysisSpecId: string` (required) | A future write that forgets the column |
| Runtime | `writeCallScore` throws on empty string / undefined cast | A type-cast that smuggles NULL through |
| ESLint | `eslint-rules/no-bare-call-score-write.mjs` (error) | New `prisma.callScore.create/update/upsert` outside the helper allow-list |
| Test | `tests/lib/measurement/write-call-score.test.ts` | Helper accepts valid input, rejects missing spec id |
| Test | `tests/lib/measurement/build-batched-measure-prompt.test.ts` | Rubric is byte-identical in prompt body; unspecced params log a warning |
| Test | `tests/integration/journey/adaptive-loop-canary.integration.test.ts` | E2E canary asserts `analysisSpecId IS NOT NULL` on every CallScore row after EXTRACT |
| Invariant | `adaptive-loop-invariants.ts::I-AL6` (`CallScore.analysisSpecId NOT NULL post-EXTRACT`) | Production observability — fires WARN until the drain completes, then promote to FAIL |
| Drain | `scripts/backfill-call-score-analysis-spec.ts` (idempotent, dry-run default) | Historical NULL rows — attribute by parameter→active MEASURE-spec when 1:1, mark `LEGACY_UNSPECCED_PRE_1539` otherwise |

## Why the helper, not a Prisma extension

A Prisma `$extends({ query })` interceptor on `callScore.create` would
work, but the failure mode is silent (rejected at runtime after a
write-shaped argument is already built). The helper signature surfaces
the requirement at the call site — every author who writes a CallScore
sees `analysisSpecId` in the type, in the import, and in the
auto-complete. Belt-and-braces: the ESLint rule blocks the bare
`prisma.callScore.create` so the helper is the only path.

## Alternatives considered

| Option | Why rejected |
|---|---|
| **A — Retire batched scoring; one LLM call per spec** | ~7× cost increase on IELTS (7 MEASURE specs). The audit already shows the calibration problem is not "batched vs per-spec" — it's "no rubric in the prompt at all". Cheaper to fix the prompt. |
| **B — Two-tier hybrid (batched for "thin" specs, per-spec for rubric-heavy)** | Adds a routing decision (`config.scoringMode`) that doesn't exist today. Worth revisiting if a single batched body exceeds the AI window when interpolating ~10 rubrics. Empirically: IELTS-V1.0 has 7 MEASURE specs at avg ~800 chars each = +5.6KB on top of a 4KB transcript window. Well within budget. **If budget is breached later, B is the migration path — the helper already takes per-parameter rubrics, so swapping the dispatcher is local.** |
| **C — Leave NULL, document the gap** | Calibration story (#1539) cannot answer "do scores track IELTS bands?" without lineage. Trading "honest unknown" for "false signal" is what the chase-prevention rule explicitly forbids. |
| **D — Prisma extension intercepting `callScore.create`** | Silent failure mode; doesn't surface the requirement at write sites. Adopted as a secondary belt for the helper instead — see "Why the helper" above. |

## Revisit triggers

Re-open this decision when:

- A single batched prompt body exceeds the configured transcript-context
  budget on >5% of calls (move to Option B — two-tier hybrid).
- A new MEASURE spec lands with `promptTemplate` of size >2KB (consider
  per-spec call for that one).
- The drain script reports >5% of historical NULL rows can't be
  attributed by 1:1 mapping — indicates we had multi-spec-per-parameter
  in flight and need a join table, not a scalar column.

## Migration

1. **Land contract** (this PR): helper + prompt builder + ESLint rule +
   tests + I-AL6 WARN + drain script (not yet run).
2. **Drain on hf_sandbox**: `npx tsx scripts/backfill-call-score-analysis-spec.ts`,
   capture counts (`{attributed, marker, unresolvable}`).
3. **Verify on canary**: re-run the adaptive-loop canary, confirm every
   CallScore row has `analysisSpecId` non-NULL.
4. **Promote I-AL6 WARN → FAIL** in a follow-on PR once the drain
   reports `unresolvable = 0`.
5. **Flip column to NOT NULL** in a final Prisma migration once
   I-AL6 has been FAIL-severity for one sprint without firing.

## Out of scope

- Mock-engine attribution sentinel design (`MOCK-V1` system-marker spec) —
  the helper accepts any non-empty spec id; the seed for that sentinel
  lands in this PR but the broader "mark all mock writes" follow-on is
  separate.
- #1538 IELTS-specific spec content. The contract here is generic. IELTS
  band descriptors as `promptTemplate` content land in #1538 once this
  contract is the contract.
- Drain rollout to hf_staging / Cloud Run prod — separate operator
  approval gate (data-touching script).
