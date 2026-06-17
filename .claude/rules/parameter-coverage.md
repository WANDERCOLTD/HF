# Parameter coverage (Lattice Coverage-pillar member)

> Every Parameter declared in
> `apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`
> MUST have a runtime CONSUMER — a compose transform / pipeline runner /
> cascade resolver / scoring writer / chat-tuner reader. A Parameter row
> with no consumer is producer-only: educators can tune the
> BehaviorTarget but nothing reads the result.
>
> Sibling Coverage-pillar tests:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (journey settings),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md) (route auth/Zod),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md) (route redactors).
> Same generic enumerate→classify→ratchet pattern.

## Why this exists

Parameters drive BehaviorTarget cascades (System → Domain → Course →
Segment → Caller → Call), get scored per call into CallScore, and feed
the `targets.ts` compose transform. Every parameter SHOULD reach the
composed prompt or affect scoring.

The 2026-06-17 audit found **154 parameters in the canonical registry,
36 with runtime consumers (23%), 118 producer-only (77%)**. Many were
seeded with the registry expansion (2026-02 onwards) but never wired —
`learning-adaptation` (23), `curriculum-adaptation` (21), `supervision`
(12), `companion` (11) categories particularly affected.

Convention only — no test pinned the producer↔consumer pairing. This
ratchet freezes the incumbent population at 118 and prevents further
drift; future PRs can only IMPROVE coverage by wiring consumers.

## How matching works

For each parameter in the registry:

1. If `parameterId` is in `PARAMETER_EXEMPT` → `exempt`.
2. Search `CONSUMER_SOURCE` (concat of `lib/prompt/composition/**`,
   `lib/compose/**`, `lib/pipeline/**`, `lib/measurement/**`,
   `lib/cascade/resolvers/**`, `lib/scoring/**`, `lib/tolerance/**`,
   `lib/goals/**`, `lib/voice/**`, `lib/skill-banding/**`,
   `lib/chat/**`, `app/api/**`) for word-boundary matches of:
   - the canonical ID (e.g., `BEH-RESPONSE-LEN`, `abstract-vs-concrete`)
   - the camelCase form (`abstractVsConcrete`)
   - the SCREAMING_SNAKE form (`ABSTRACT_VS_CONCRETE`)
3. Match found → `covered`. Otherwise → `gap`.

The auto-generated `lib/registry/index.ts` is **deliberately excluded**
from consumer dirs — it's the parameter definitions registry, not a
runtime consumer. Mentioning a parameter ID there means "we know it
exists", not "we use it".

## When NOT to apply

- Parameters intentionally landed pre-Phase 2 (the
  `learning-adaptation` / `curriculum-adaptation` categories) — these
  belong in `PARAMETER_EXEMPT` with reason "adaptive transform deferred
  to Phase 2".
- Parameters that drive cascade resolvers but use an UMBRELLA term
  (e.g. all `learning-adaptation` params resolved by a single
  `resolveLearningAdaptation` that doesn't mention each ID) — these
  are correctly classified `covered` by inheritance through the
  umbrella resolver if the resolver's source mentions any one of them.

## When adding a new parameter

Author checklist (same PR or a tracked plan):

1. Add the entry to `behavior-parameters.registry.json` with
   `parameterId` + `name` + `definition` + `domainGroup` +
   `defaultTarget`.
2. Decide consumer surface:
   - **Compose-only** (text directive in prompt) — add the read in the
     appropriate transform (e.g. `targets.ts` for behavior dimensions).
   - **Pipeline-scored** (per-call score) — add an AnalysisSpec that
     measures it + a runner under `lib/pipeline/` that writes
     CallScore against the parameterId.
   - **Cascade-resolved** (multi-layer override) — register in the
     BehaviorTarget cascade family + resolver.
3. Run `npx vitest run tests/lib/measurement/parameter-coverage.test.ts`.
   If green → ship. If `gap` → either wire OR add to
   `PARAMETER_EXEMPT` with `reason` describing what's deferred and
   bump `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/measurement/parameter-coverage.test.ts` (born 2026-06-17, this PR) | 5 vitests: distribution-sanity, ratchet, non-empty-reason, non-stale-exempt, no-contradiction | New parameters seeded without consumers. Exempt list drift. |
| `behavior-parameters.registry.json` itself | Canonical seed — DB source of truth | Parameter definitions stay in sync DB↔code |
| BehaviorTarget cascade (`lib/cascade/resolvers/behavior-target.ts`) | Runtime | Per-Parameter cascade resolution at compose time. Read-side only — doesn't cover the producer↔consumer pairing. |

## Future hardening

When `gap` count drops below ~30, add a build-time pairing check that
specifies, per parameter, WHICH consumer surface should read it (compose
/ pipeline / cascade) and verifies that consumer exists. Same shape as
`coverage-producer-consumer.test.ts` (#1848) at the transform↔renderer
layer, but at the parameter↔transform layer.

## Related

- [`tests/lib/measurement/parameter-coverage.test.ts`](../../apps/admin/tests/lib/measurement/parameter-coverage.test.ts) — the test
- [`apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`](../../apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json) — the canonical seed
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test (same pattern, journey settings surface)
- [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) — pipeline stage invariants
- Memory: `feedback_lattice_5th_pillar_coverage.md`
