# Canary Gate 4 — `ComposedPrompt.inputs.key_memories` is empty — root cause

**Date:** 2026-06-11
**Branch:** `fix/canary-compose-key-memories`
**Tied to:** #1514 (canary) + #1515 (G9 memories) + this fix

## TL;DR

The canary's Gate 4 (`ComposedPrompt.inputs.key_memories` non-null) is failing
because `inputs.key_memories` is **never written** by `persistComposedPrompt`.
The computed key-memory list lives at `llmPrompt._quickStart.key_memories`
(written by `transforms/quickstart.ts:444-470`), and `inputs` is a separate
forensics blob designed before the canary existed. Failure mode (D) from the
brief — "the `key_memories` field has been renamed but the canary asserts on
the old name" — except in this case it was never persisted to `inputs` in the
first place.

Memories themselves are loading fine (the G9 doc confirmed 17-18 CallerMemory
rows per canary run; the memories loader at `SectionDataLoader.ts:553` filters
by `supersededById: null` + `expiresAt` and reads them correctly; the memories
transform deduplicates and ranks them; the quickstart transform pulls the top 4
into `_quickStart.key_memories`). The break is one layer downstream of all
that, in the persistence step that flattens the composition result into the
`ComposedPrompt.inputs` JSON column.

## Data flow trace

```
CallerMemory rows (DB)
  └── SectionDataLoader.ts::registerLoader("memories")   ←── 17-18 rows here
        └── memories transform "deduplicateAndGroupMemories"
              └── context.sections.memories._deduplicated
                    └── transforms/quickstart.ts::computeQuickStart()
                          └── _quickStart.key_memories: [...]     ←── populated
                                └── llmPrompt._quickStart.key_memories  ←── written to ComposedPrompt.llmPrompt
                                                                            ✗ NOT written to ComposedPrompt.inputs
```

The canary then reads `composed.inputs.key_memories` (test file line 327) and
finds `undefined`, so `keyMemoriesArray.length === 0` and the WARN gate trips.

## Evidence

### 1. The transform IS populating `key_memories`

`apps/admin/lib/prompt/composition/transforms/quickstart.ts:444-470` reads
`sections.memories._deduplicated` and returns a `key_memories` string array
(capped at 4). On the canary's transcript (17-18 CallerMemory rows) this
returns a non-empty list — proven by the G9 doc and by the memories transform
producing `totalCount > 0` (which is the data the canary already passes through
Gate 2 via `LEARN — CallerMemory count > 0`).

### 2. `inputs` is a forensics blob, not a reflection of `llmPrompt`

`apps/admin/lib/prompt/composition/persist.ts:110-128` builds `inputs` as:

```ts
inputs: {
  callerContext,            // assembled markdown (separate column-shaped string)
  memoriesCount,            // ← the count IS here (Gate 4 sibling)
  personalityAvailable,
  recentCallsCount,
  behaviorTargetsCount,
  playbooksUsed,
  playbooksCount,
  identitySpec,
  contentSpec,
  specUsed,
  specConfig,
  composition: { sectionsActivated, sectionsSkipped, loadTimeMs, transformTimeMs },
}
```

No `key_memories`. The `llmPrompt` column (also written, but as a separate
column, not under `inputs`) is the canonical shape the voice path reads from.

### 3. Existing `inputs.*` readers all consume forensics-shaped fields

Confirmed via grep across the repo. Every other reader of
`ComposedPrompt.inputs.*` is reading a forensics field
(`memoriesCount`, `composition.sectionsActivated`, `callerContext`,
`behaviorTargetsCount`), not a per-section payload. So adding `key_memories`
under `inputs` is purely additive — no existing reader changes shape.

The complete reader list:

| File | Read |
| --- | --- |
| `app/api/pipeline/runs/route.ts` | `inputs.composition`, `inputs.memoriesCount` |
| `app/api/callers/[callerId]/eval-prompt/route.ts` | `inputs.memoriesCount`, `inputs.composition.sectionsActivated/Skipped` |
| `components/callers/caller-detail/CallsTab.tsx` | `inputs.memoriesCount`, `inputs.callerContext` |
| `components/callers/caller-detail/PromptsSection.tsx` | `inputs.memoriesCount` |
| `tests/integration/journey/adaptive-loop-canary.integration.test.ts` | `inputs.key_memories` ← **the only reader of this field** |

## Why this isn't the same class as #1515 G9

The G9 doc (`docs/audit/g9-callermemory-zero-writes-root-cause.md`) established
that CallerMemory writes were healthy. This canary gate was the next assertion
in the chain — but it's reading from the wrong path. Both findings stack:

1. `CallerMemory` rows exist (G9 disproved zero-writes premise) — confirmed.
2. The memories transform reads them and emits `_deduplicated` — confirmed
   (Gate 2 passes).
3. The quickstart transform pulls them into `_quickStart.key_memories` — works.
4. **`persist.ts` does not surface `key_memories` to `inputs`** — the gap.

So Gate 4 is "downstream of G9" only in the sense that an empty memory set
would also produce an empty `key_memories`. But on a healthy memory write
path, Gate 4 still fails — because `inputs.key_memories` is structurally
absent.

## Fix shape

In `apps/admin/lib/prompt/composition/persist.ts`, read
`composition.llmPrompt?._quickStart?.key_memories` (already computed by the
composition pipeline) and surface it as `inputs.key_memories: string[] | null`.

- Pure additive change — no existing reader of `inputs.*` cares.
- No new transform — uses the already-computed list.
- Default is `[]` (empty array, not null) when no memories were surfaced, so
  the canary's `Array.isArray(...) ? x : []` guard at line 328 is honest.
- Mirrors the `memoriesCount` pattern that's already there — the count is the
  cardinality, `key_memories` is the actual list.

## Why not change the canary instead?

Two reasons:

1. The canary's intent is to observe the chain externally — looking at
   `ComposedPrompt.inputs` is the right architectural surface (the DB row, not
   a deep field of the assembled prompt). Asking the canary to drill into
   `llmPrompt._quickStart.key_memories` makes it brittle to internal layout
   changes.
2. The `inputs` blob is already partially observability-shaped (`memoriesCount`,
   `recentCallsCount`, `behaviorTargetsCount`). Adding `key_memories` is
   consistent — it answers "what did the tutor actually learn this caller's
   key facts as?" alongside "how many did it have to choose from?".

## Verification plan

1. Vitest pinning that `persistComposedPrompt` writes `inputs.key_memories`
   as an array when `llmPrompt._quickStart.key_memories` is populated, and
   writes `[]` when absent.
2. Re-run the canary on hf-dev VM. Gate 4 (`compose.keyMemories`) should
   flip from WARN to PASS.

## Constraints honoured

- DO NOT touch the invariant runner ✓
- DO NOT touch AGGREGATE / EXTRACT runners ✓
- DO NOT change the compose-invariant runner ✓
- DO add a vitest that pins the fix ✓
- `npm run lint`, `npx tsc --noEmit`, `npm run kb:fresh` all green ✓
