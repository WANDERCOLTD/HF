# Lattice chain closure (6th Coverage pillar)

> Every Lattice chain declared in `docs/lattice-chains.json` MUST walk
> end-to-end: each link's consumer reads what it claims to read, and
> adjacent links agree on the keys they pass. The chain-closure test
> catches the **drift-between-passing-links** class that per-link gates
> miss.
>
> Sibling to the other Coverage-pillar tests
> ([`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`registry-schema-coverage.md`](./registry-schema-coverage.md),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md),
> [`aggregate-output-consumer-coverage.md`](./aggregate-output-consumer-coverage.md))
> — same generic enumerate→classify→ratchet pattern, but applied across
> ADJACENT LINKS of a chain rather than within a single producer↔consumer
> pair.
>
> Story: [#2057](https://github.com/WANDERCOLTD/HF/issues/2057). Part of
> the Coverage pillar of HF Lattice.

## Rule

When you add or modify a Lattice chain (a sequence of pipeline stages
that pass data link-by-link from raw signal to composed prompt), you
MUST add a row to `docs/lattice-chains.json` declaring:

- `id` + `title` + `description`
- Each link's `stage`, `kind`, `producer` / `consumer` / `runner` paths,
  `consumesKey` + `consumesKeySamples`, `outputKey` + `outputKeySamples`
- `knownGaps[]` for any tolerated drift, each with `ratchetKey`

The structural enforcement lives in
[`tests/lib/lattice-chain-closure.test.ts`](../../apps/admin/tests/lib/lattice-chain-closure.test.ts).

## What the test pins

1. **Schema sanity** — every chain has id / title / description / 2+
   links; every link has stage / kind / outputKey.
2. **File existence** — every cited `producer` / `consumer` / `runner`
   path must exist on disk.
3. **Consumer self-consistency** — every `consumesKeySample` declared
   must literally appear in the consumer source. (Catches: manifest
   says the consumer reads X but the consumer was refactored to read
   Y.)
4. **Adjacent-link key overlap** — producer's `outputKeySamples` must
   overlap with consumer's `consumesKeySamples` UNLESS the consumer is
   scope-based or pattern-based (in which case the per-key overlap
   doesn't apply). This is the canonical drift catch story #2057 was
   filed to ship.
5. **Ratcheted gaps** — tolerated gaps (chains in transition) must
   stay declared. New gaps fail the test until they're either fixed
   or added to the chain's `knownGaps[]`.

## What drift looks like

The story's canonical example:

```
MEASURE writes:    CallScore.parameterId = "BEH-ABSTRACT-CONCRETE"
AGGREGATE reads:   sourceParameter = "BEH-ABSTRACT-CONCRETE"     ✓
AGGREGATE writes:  behavior_profile:engagement:abstract_concrete
ADAPT reads:       behavior_profile:engagement:abstractness      ✗ DRIFT
ADAPT writes:      directive in instructions section
Renderer pushes:   instructions section                          ✓ but empty
```

Per-link tests all pass — each producer / consumer / renderer is
individually wired. The chain dies semantically between AGGREGATE →
ADAPT because of one renamed key. The chain-closure test catches it
by walking link-by-link and demanding adjacent-link key agreement.

## When NOT to apply

- Producer-side `outputKeySamples` are intentionally NOT asserted to
  appear in the producer's source — for runtime-driven keys
  (CallScore.parameterId etc.) the producer chokepoint
  (`write-call-score.ts`) is parameterised and doesn't carry literal
  parameter ids. The literals live in the consuming spec.json files
  (asserted via the NEXT link's `consumesKeySamples`).
- Scope-based or pattern-based consumers skip per-key overlap (the
  consumer doesn't pick keys individually — it filters by scope or
  matches a wildcard). The schema check + consumer-side
  self-consistency check still apply.

## When adding a new chain

Author checklist (same PR):

1. Add the chain to `docs/lattice-chains.json` with all links + any
   `knownGaps[]`.
2. Run `npx vitest run tests/lib/lattice-chain-closure.test.ts`.
3. If a known gap is declared, add its `ratchetKey` to
   `EXPECTED_TOLERATED_GAPS` in the test.
4. If a row in `docs/lattice-chains.md` documents the same chain,
   keep both in sync — `lattice-self-maintenance.test.ts` cross-checks
   the JSON manifest's link surface against the prose inventory.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/lattice-chain-closure.test.ts` (story #2057) | Chain walker + adjacent-link key consistency + ratchet | Drift between passing per-link gates — the silent chain-death class |
| `tests/lib/lattice-self-maintenance.test.ts` | Pairs `docs/lattice-chains.json` ↔ `docs/lattice-chains.md` | Manifest / prose divergence |
| Per-link Coverage tests (5 existing) | Single producer↔consumer per surface | Producer-only debt within a single link |

## Related

- [`docs/lattice-chains.json`](../../docs/lattice-chains.json) — the manifest
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — human-readable inventory (parent / paired)
- [`tests/lib/lattice-chain-closure.test.ts`](../../apps/admin/tests/lib/lattice-chain-closure.test.ts) — the test
- Story [#2057](https://github.com/WANDERCOLTD/HF/issues/2057)
- Epic [#1909](https://github.com/WANDERCOLTD/HF/issues/1909) — parent (Lattice Coverage extensions)
