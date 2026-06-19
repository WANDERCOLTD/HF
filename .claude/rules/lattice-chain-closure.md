# Lattice chain-closure (6th Coverage-pillar gate)

> Per-link gates pin each step of a Lattice chain. This gate pins the
> ADJACENT-link CONTRACT: every producer's `outputKey` MUST literally
> match the next consumer's `consumesKey`. A chain can pass every
> per-link gate yet die semantically because two adjacent links use
> mismatched key shapes. This is the 6th Coverage-pillar member of
> HF Lattice.
>
> Sibling Coverage-pillar gates:
> [`registry-schema-coverage.md`](./registry-schema-coverage.md),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md),
> [`parameter-measurement-coverage.md`](./parameter-measurement-coverage.md),
> [`parameter-loop-closure.md`](./parameter-loop-closure.md).
>
> Cross-link:
> [`lattice-survey.md`](./lattice-survey.md) — pre-coding survey before
> touching any chain;
> [`lattice-self-maintenance.md`](./lattice-self-maintenance.md) — the
> meta-gate that keeps `docs/lattice-chains.md` AND
> `docs/lattice-chains.json` paired with each other and with reality.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as the 6th Coverage-pillar member.
>
> Story: [#2057](https://github.com/WANDERCOLTD/HF/issues/2057).

## Rule

Every Lattice chain declared in `docs/lattice-chains.json` MUST close
on the KEY contract at every adjacent-link pair. For each pair
`(link[N], link[N+1])`:

```
link[N].outputKey  ===  link[N+1].consumesKey
```

(after `{placeholder}` substitution to a wildcard sentinel)

If two adjacent links use mismatched keys today and the underlying
drift can't be fixed in the same PR, add an entry to that chain's
`tolerated_drift[]` array with a one-line reason AND bump
`EXPECTED_TOLERATED_DRIFT_TOTAL` in
`tests/lib/lattice-chain-closure.test.ts` by 1.

The ratchet starts at **0 at land time** (2026-06-19). Future PRs may
ONLY drop it (by fixing a drift + removing the entry) — they may not
silently grow it.

## Why this exists

Per-link Coverage gates (registry-schema, registry-consumer,
route-auth-zod, tier-visibility, parameter-coverage,
parameter-loop-closure, …) pin each step of a chain individually.
Each gate enumerates one set of producers, classifies its consumers,
and ratchets the gap count. The per-link guarantee: "this individual
producer is paired with at least one consumer".

What the per-link gates do NOT catch is when two adjacent links each
have their own consumer but those consumers read different keys. The
chain looks healthy from every per-link gate's vantage point and still
dies semantically.

Worked example (from #2057's body):

```
MEASURE writes:    CallScore.parameterId = "BEH-ABSTRACT-CONCRETE"
AGGREGATE reads:   sourceParameter = "BEH-ABSTRACT-CONCRETE"     ✓ link 1
AGGREGATE writes:  behavior_profile:engagement:abstract_concrete
ADAPT reads:       behavior_profile:engagement:abstractness      ✗ DRIFT
ADAPT writes:      directive in instructions section
Renderer pushes:   instructions section                          ✓ but empty
```

Every link passes its own per-link gate. The chain dies between
AGGREGATE → ADAPT because one renamed key. None of the existing
Coverage gates catch it. This gate does.

## When this applies

Any PR that:

1. Adds, removes, or modifies a chain in `docs/lattice-chains.json`, OR
2. Renames a column / field / spec rule shape / contract id that's
   cited as an `outputKey` or `consumesKey` in any existing chain, OR
3. Introduces a new Lattice chain (mutates a shared DB column,
   crosses a chain-stage boundary, registers a new spec/contract — see
   `lattice-survey.md`'s "When this applies" trigger list).

## When NOT to apply

- Per-link integrity is the job of the per-link Coverage gates — don't
  duplicate their work in chain manifests. Chain entries should
  document the KEY contract between links, not the per-link
  enumeration.
- Single-link "chains" don't exist — every chain has at least 2 links
  (test pins this). A trivial single-producer surface belongs in a
  per-link Coverage gate, not the chain manifest.

## Author checklist — adding a new chain

Run the `lattice-survey.md` survey first. Then:

1. **Identify the chain's anchor links.** Walk the data flow:
   producer → producer's output → consumer → consumer's output → next
   consumer → … → terminal. Each WRITER/READER pair is one link.
2. **For each link, write down the key**:
   - `outputKey` — the column / column path / contract-id / jsonb
     shape / parameterId / storagePath segment the link writes. Use
     `{placeholder}` tokens for templated segments (e.g.
     `behavior_profile:{group}:{key}`).
   - `consumesKey` — what this link reads from the PREVIOUS link.
     Often the previous link's `outputKey` verbatim — if it's not, the
     test fires.
3. **Pick canonical labels.** If the same column is referenced by two
   chains, use the same string. The closure test compares literally
   (modulo placeholder substitution).
4. **Run the test**:
   ```bash
   npx vitest run tests/lib/lattice-chain-closure.test.ts
   ```
   - If green, ship.
   - If "adjacent-link KEY drift detected", either:
     - **Best**: fix the upstream/downstream key on both sides to
       match (the chain is now closed in reality).
     - **Acceptable**: add a `tolerated_drift[]` entry to the chain
       with `from_link_index`, `to_link_index`, and a one-line reason
       describing why the drift is intentional. Then bump
       `EXPECTED_TOLERATED_DRIFT_TOTAL` by 1.
5. **Add a row to `docs/lattice-chains.md`** if the chain doesn't
   already appear there. The self-maintenance test
   (`lattice-self-maintenance.test.ts`) asserts every chain id in the
   JSON also appears in the .md and vice versa.

## How to fix a failure

| Failure shape | Fix |
|---|---|
| "Chain manifest cites files that don't exist" | Either fix the producer/consumer path (file was renamed/moved) OR remove the chain (the cited surface was deleted). |
| "Adjacent-link KEY drift detected" | Either (best) align the upstream and downstream keys, or add a `tolerated_drift[]` entry with reason + bump `EXPECTED_TOLERATED_DRIFT_TOTAL`. |
| "Tolerated-drift ratchet drifted" | Either a drift was fixed without removing its entry (drop the entry + drop the ratchet by 1), OR a new drift was added without conscious acknowledgement (decide: fix it or bump the ratchet). |
| "tolerated_drift entries with empty/short reason" | Write a real reason (>20 chars). The reason is enforcement: it's the conscious acknowledgement of debt. |
| "stale tolerated_drift — entry but keys NOW match" | The drift was fixed but the entry wasn't removed. Remove the entry + drop ratchet by 1. |
| "Invalid tolerated_drift indices" | `from_link_index` and `to_link_index` must point at a valid adjacent pair in the chain. `to_link_index === from_link_index + 1` is required. |
| "Chains without terminal_reaches" | Add a one-line description of where the chain's last output lands at runtime (e.g. "voicePrompt prose"). Informational — helps future authors locate the consumer surface. |

## Drift hunting — how to spot it before the test catches it

Before adding/modifying a link:

1. Read the previous link's `outputKey` literally.
2. Search the codebase for that exact string token (use `qmd search`
   first per CLAUDE.md).
3. Confirm the consumer code reads THAT token, not a synonym.

Common drift sources:
- Column rename without spec.json update (e.g. AGGREGATE column was
  renamed but the ADAPT spec still references the old name).
- ParameterId aliasing — registry entry has aliases, but one
  consumer hard-codes the canonical form, another hard-codes an alias.
- jsonb shape change — producer wrote `{group, key}`, consumer reads
  `{group, name}`.
- StoragePath segment rename in the registry without sweeping the
  consumer transforms.

## When to use `tolerated_drift`

ONLY in these cases:

1. **In-transition rename** — you're migrating from old key shape to
   new; both writers exist for a deprecation window. Document the
   target date.
2. **Resolver-mediated read** — the consumer uses a cascade resolver
   (e.g. `getCascadedTargets()`) instead of a literal key read; the
   resolver IS the consumer but the test can't see it. Document
   which sibling gate enforces the actual coverage.
3. **Per-link gate already covers it** — the sibling per-link
   Coverage gate (e.g. `parameter-loop-closure.test.ts`) carries the
   detailed enforcement; the chain-closure test only asserts the
   chain shape exists. Document the sibling.

Never:
- "I'll fix it later" without a tracking issue
- "It works at runtime, ignore the test" — closure asserts the
  CONTRACT, not the runtime path. A working runtime via an implicit
  resolver is fine — add the resolver to the chain as its own link
  OR use case 2 above.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `apps/admin/tests/lib/lattice-chain-closure.test.ts` (born 2026-06-19, this PR) | 11 vitests: schema-load, kebab-case-id, ≥2-links, file-existence, adjacent-key-consistency, drift-ratchet, non-empty-reason, valid-indices, no-stale-drift, terminal-reaches-set, distribution-sanity | Adjacent-link KEY drift — the failure mode per-link Coverage gates can't see |
| `docs/lattice-chains.json` (born 2026-06-19, this PR) | Machine-readable manifest | The substrate this gate operates on; parity-checked against the .md inventory by `lattice-self-maintenance.test.ts` |
| `apps/admin/tests/lib/lattice-self-maintenance.test.ts` (#1862, extended this PR) | .md ↔ .json parity check | Inventory drift between human-readable + machine-readable forms |
| Sibling per-link Coverage gates | Per-link enumeration + ratchet | Per-link absence (different failure mode than this gate) |

## Future hardening

- **More chains**: the seed manifest declares 4 (`beh-aggregate-cascade`,
  `parameter-loop`, `compose-producer-consumer`,
  `journey-setting-coverage`). Add more as new chains land. Target:
  every chain in `docs/lattice-chains.md` has a JSON entry within 3
  months of this PR.
- **Schema validation**: today the test parses raw JSON. Adding a
  proper JSON-schema validation pass (e.g. via `ajv`) would catch
  schema-shape drift at the manifest layer (currently caught only by
  TS-cast errors at test load).
- **Drift detector**: when the ratchet stays at 0 for 6 months,
  consider lowering the maximum allowed `tolerated_drift_total` to a
  hard 0 (no `>= 0` floor — any future drift must be fixed, never
  tolerated). This converts the gate from ratchet to invariant.

## Related

- [`apps/admin/tests/lib/lattice-chain-closure.test.ts`](../../apps/admin/tests/lib/lattice-chain-closure.test.ts) — the test
- [`docs/lattice-chains.json`](../../docs/lattice-chains.json) — the manifest
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — the human-readable inventory
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- [`.claude/rules/lattice-self-maintenance.md`](./lattice-self-maintenance.md) — the meta-gate this gate's manifest pairs with
- Memory: `feedback_lattice_5th_pillar_coverage.md` — the Coverage pillar this gate extends to 6
