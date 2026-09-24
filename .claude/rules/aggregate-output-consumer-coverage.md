# AGGREGATE output → consumer coverage

> Every `targetProfileKey` written by an AGGREGATE spec MUST have
> SOMEONE downstream that reads it — a compose transform, cascade
> resolver, pipeline runner, or other runtime consumer. A
> `targetProfileKey` with no consumer is a producer-only Lattice
> entry: the AGGREGATE write lands in `CallerAttribute` (or
> `CallerTarget`) but nothing reads it. Same silent-gain-zero class
> as M2 catches on the input side.
>
> Sibling to [`parameter-loop-closure.md`](./parameter-loop-closure.md)
> (M2, link 8 — INPUT side: CallScore → AGGREGATE) — this rule is
> the matching OUTPUT side: AGGREGATE → COMPOSE/runtime reads.
>
> Story: born of epic [#1967](https://github.com/WANDERCOLTD/HF/issues/1967)
> M2 follow-on, 2026-06-19. Part of the Coverage pillar of HF Lattice.

## Rule

When you add or modify an AGGREGATE spec, every distinct
`targetProfileKey` prefix it introduces MUST either:

1. **Have a consumer** somewhere under `lib/prompt/composition/**`,
   `lib/cascade/**`, `lib/pipeline/**`, `lib/scoring/**`,
   `lib/goals/**`, or `lib/measurement/**` — the compose-side reader
   that picks up the rolled-up `CallerAttribute` (or `CallerTarget`)
   for the next call's prompt or runtime decision.

2. **OR be exempted** in `AGG_OUTPUT_EXEMPT` with a documented reason
   (e.g., internal-only audit signal, deferred-to-follow-on).

The structural enforcement lives in
[`tests/lib/measurement/aggregate-output-consumer-coverage.test.ts`](../../apps/admin/tests/lib/measurement/aggregate-output-consumer-coverage.test.ts).

## How matching works

For each AGGREGATE spec's `targetProfileKey`:

1. The test extracts the **prefix** — everything up to and including
   the last `:` (e.g., `behavior_profile:companion:depth_engagement`
   → prefix `behavior_profile:companion:`). Bare keys without `:`
   match by full literal id.
2. The test greps the consumer dirs for the prefix.
3. Any hit → `covered`. Otherwise → `gap`.

## Classifications

| Classification | Meaning | Counts toward gap ratchet? |
|---|---|---|
| `covered` | Prefix appears in some consumer dir | No |
| `sentinel` | SKILL-AGG-001 `_caller_target_current_score` carve-out (writes to `CallerTarget.currentScore`, not a literal key) | No (excluded) |
| `exempt` | Listed in `AGG_OUTPUT_EXEMPT` with a substantive reason | No (excluded) |
| `gap` | No consumer found anywhere | **Yes — the ratchet** |

## Ratchet

`EXPECTED_GAP_COUNT` caps the gap count. 2026-06-19 incumbent:
**11** producer-only AGG output prefixes:

- 9 from BEH-AGG-001 (companion / personality / supervision /
  engagement / curriculum / learning / reinforcement / onboarding /
  core-style) — born of #1967 M2 structural closure; compose-side
  readers are pedagogy follow-on work
- 2 from LEARN-PROF-001 pre-existing (`feedback_style`,
  `question_frequency`) — pre-dated the #1967 epic

Each wired consumer drops the ratchet by 1.

## When authoring a new AGGREGATE spec

Author checklist (same PR):

1. Define each `targetProfileKey` with a clear namespace prefix
   (`<domain>:<dimension>` or `behavior_profile:<domain>:<dimension>`).
2. **Wire the consumer in the same PR** — at minimum a compose
   transform under `lib/prompt/composition/transforms/` that reads
   `prisma.callerAttribute.findMany({ where: { key: { startsWith:
   "<prefix>" } } })` and emits the relevant signal into the prompt.
3. OR add the prefix to `AGG_OUTPUT_EXEMPT` with reason if the key
   is intentionally internal-only.
4. Run the test. Expect `covered` or `exempt`.

## When NOT to apply

This rule covers `targetProfileKey` writes from AGGREGATE specs only.
ADAPT spec writes (`targetParameter` on `BehaviorTarget`) and REWARD
spec writes (`Reward` table) follow different patterns and have their
own coverage tests (M2 catches the input side for both).

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/measurement/aggregate-output-consumer-coverage.test.ts` (this PR) | Walks every AGG spec's `targetProfileKey` + ratchets gap count | New AGG outputs landing without a compose-side reader (silent producer-only debt) |
| `tests/lib/measurement/parameter-loop-closure.test.ts` (#1967 M2) | INPUT side: CallScore → AGGREGATE walker | Sibling: pins the input side of the cascade-feedback loop |
| `tests/lib/measurement/parameter-measurement-coverage.test.ts` (#1967 M1) | Substantive citation cross-check | Pre-pre-requisite: parameters declare measurement specs |

## Related

- [`tests/lib/measurement/aggregate-output-consumer-coverage.test.ts`](../../apps/admin/tests/lib/measurement/aggregate-output-consumer-coverage.test.ts) — the test
- [`parameter-loop-closure.md`](./parameter-loop-closure.md) — sibling INPUT side rule
- [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) §3e Link M2 — the broader cascade-feedback contract
- Epic [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) — Pipeline Measurement Coverage
