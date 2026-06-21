# Cascade value-presence Coverage (Data Presence sub-pillar instance)

> Every (cascade-eligible knob × cascade layer × published Playbook)
> cell — 21 knobs × 3 layers × 4 playbooks = 252 cells — MUST be
> classified `present` (a value is seeded at this layer for this
> playbook) or `absent-by-design` (listed with a >20-char reason
> explaining why no value applies). Unclassified cells fail the gate.
>
> Parent sub-pillar:
> [`data-presence-coverage.md`](./data-presence-coverage.md) — the
> umbrella meta-rule. This is the second non-test-fixture instance
> of the Data Presence sub-pillar after
> [#2166](https://github.com/WANDERCOLTD/HF/issues/2166) (soft
> source-ref → ContentSource).
>
> Sibling Data Presence instance gates:
> [`source-ref-coverage.md`](./source-ref-coverage.md) (JSON soft-ref
> → DB-row resolution — first instance, same enumerate→classify→ratchet
> shape applied to a different surface).
>
> Sibling Producer↔Consumer Coverage gates (sibling sub-pillar, same
> generic shape on the code-pairing surface):
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`mode-ui-coverage.md`](./mode-ui-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md).
>
> Story: [#2225](https://github.com/WANDERCOLTD/HF/issues/2225) B5
> (epic body — RHS Inspector Robustness umbrella). Born of the
> 2026-06-21 operator audit finding that the RHS Inspector cascade
> chip silently renders nothing on 89 of 105 contracts because no
> value exists at ANY layer for the 4 published playbooks.

## Rule: every cascade cell classifies

When you add or modify a code path that:

1. Reads a cascade-eligible knob via `useEffectiveValue(knobKey, scope)`
   or `resolveEffective({knobKey, scopeChain})`, AND
2. Depends on that knob resolving to a real (non-null) value at SOME
   layer for SOME published playbook,

then the corresponding cell in the
[`tests/lib/journey/cascade-value-presence.test.ts`](../../apps/admin/tests/lib/journey/cascade-value-presence.test.ts)
matrix MUST be classified `present` (real seeded value exists) or
`absent-by-design` (with a >20-char reason explaining why the cascade
correctly resolves to null OR to a downstream fallback layer).

```
Cascade knob × layer × playbook → matrix classification →
  if present  : ratchet decreases (good)
  if exempt   : ratchet stays (deferred consciously)
  if gap      : gate fails — author classifies before merge
```

## Why this exists

The Lattice's 4 original pillars (Chain Contracts × Guards × Cascade
× Rules) plus the 5th (Coverage) catch CODE drift — bypassed
chokepoints, missing transforms, undeclared producers/consumers. They
do NOT catch the structural DATA-absence failure mode this gate
closes:

- `useEffectiveValue("welcomeMessage", {courseId})` returns
  `{unresolvable: true}` AND the Inspector's static-fallback path
  also has no value AND the operator sees a blank Inspector card
  with no information about WHY it's blank or where to set the value.

Per the epic #2225 audit (2026-06-21):
- 89 of 105 cascade-eligible contracts had `cascadeSources: []` and
  no FAMILIES entry — the chip silently renders nothing.
- `Domain.config` is `{}` for every domain (`prisma/seed-domains.ts`
  doesn't write any cascade values) — B3 NOOP finding confirmed.
- Per-course IELTS `Playbook.config` seeds 7 keys, NONE of which are
  cascade-resolved knobs.
- Net effect: 252 (knob × layer × playbook) cells across the cascade
  surface, with only ~62 having real seeded values.

Without this gate, follow-on PRs can add a new cascade knob (or a
new published playbook) without classifying its presence at every
layer — the silent-null failure mode persists.

## How matching works

The matrix is **hand-maintained** rather than parsed from seed
scripts. Two reasons:

1. **Wizard-created playbooks** (Big Five OCEAN, Spot the Spin,
   CIO/CTO Standard Revision Aid) do NOT ship their cascade values
   via seed scripts — operators apply them post-create per the course
   README (`docs/courses/big-five-personality/README.md` + siblings).
   Static seed-script grepping would miss these cells entirely.
2. **Per-layer cascade values** (e.g. `Domain.config`) lifecycle
   independently of seed scripts on hosted DBs — the live state
   diverges from what seed scripts write. The B1 inventory comment
   on epic #2225 captured the authoritative observed state; this
   matrix mirrors it.

For each (knob, layer, playbook) cell:

| Classification | Meaning |
|---|---|
| `present` | A value is observed at this layer for this playbook (per B1 inventory + B4-impl post-merge state) |
| `absent-by-design` | The cell carries a >20-char reason — e.g. "Domain layer intentionally empty per B3 NOOP finding" or "Course inherits System default — no override needed" |
| `gap` | No matrix entry AND no exempt entry → fails the gate |

## Ratchets

Two ratchets, both `toBe(exact)` matches:

- **`EXPECTED_GAP_COUNT`** — incumbent uncovered cell count. Frozen
  at 0 at land time. New cells MUST be classified consciously
  (present or absent-by-design); the matrix cannot drift silently.
- **`EXPECTED_EXEMPT_COUNT`** — count of explicitly-exempt cells.
  Today's incumbent (per the matrix at land): **190**. Drops by 1
  each time B4-impl follow-on PRs land a real seed value at a cell
  previously marked `absent-by-design`.

## Today's incumbent distribution (matrix at land, 2026-06-22)

| Distribution | Count |
|---|---|
| `present` | 62 |
| `absent-by-design` | 190 |
| `gap` | 0 |
| **Total** | **252** |

Present cells:
- **System layer (52)** — voice-config 8 knobs × 4 playbooks (32) +
  session-flow 4 knobs × 4 playbooks (16) + teachingStyle × 4
  playbooks (4)
- **Domain layer (0)** — B3 NOOP confirmed: `Domain.config` is `{}`
  universally
- **Course layer (10)** — IELTS skillScoringEmaHalfLifeDays +
  tierPresetId (2) + Big Five same (2) + Spot the Spin same (2) +
  CIO/CTO welcomeMessage + skillScoringEmaHalfLifeDays +
  skillTierMapping + tierPresetId (4)

## When this applies

Any PR that touches:

- `lib/cascade/effective-value.ts::FAMILIES` (adds / changes / removes
  a cascade family or extends FAMILIES with new knobs)
- `lib/journey/setting-contracts.entries.ts` or
  `lib/settings/voice-setting-contracts.ts` (adds a contract that
  uses `cascadeSources[]` or `cascadeKnobKey`)
- `prisma/seed-domains.ts` or `prisma/seed-ielts-course.ts` or
  sibling seed scripts that mutate `Playbook.config` or
  `Domain.config` (changes the presence layer for an existing knob)
- The 4 published Playbook catalogue (publishing a 5th playbook
  → 21 × 3 = 63 new cells to classify)

## When NOT to apply

The gate is structural — it always runs. What's exempted is specific
cells via the matrix's `absentByDesign(reason)` entries. The
following cell shapes are LEGITIMATELY absent-by-design and the
matrix declares them with explicit reason templates:

| Cell shape | Reason template |
|---|---|
| Domain layer for any (knob, playbook) | "Domain layer intentionally empty per B3 NOOP finding — abacus-academy.config is `{}` by design" |
| System layer for knobs without a System fallback (welcomeMessage / mastery-policy / language) | "No System default — resolver returns null when neither Domain nor Course supplies a value" |
| Course layer where the System default suffices | "Course inherits System default — no per-course override required for this knob today" |
| Course layer where cascade falls through to a tier-preset-derived default | "Course leaves NULL by design — tier-preset-derived threshold is the canonical default" |
| Per-course knobs that legitimately don't apply (e.g. silent-scoring courses don't surface progressSignals) | "<course-name> intentionally does not surface <knob> to the learner per <pedagogy-source>" |

## When adding a new cascade knob

Author checklist (same PR):

1. Add the knob to `CASCADE_KNOBS` in
   `tests/lib/journey/cascade-value-presence.test.ts`.
2. Add a `VALUE_PRESENCE[knobName]` entry classifying all 12 cells
   (3 layers × 4 playbooks) — either `PRESENT` or
   `absentByDesign("<>20-char reason>")`.
3. Update `EXPECTED_EXEMPT_COUNT` to reflect the new total exempt
   count.
4. Run
   `npx vitest run tests/lib/journey/cascade-value-presence.test.ts`.
   Green → ship.

## When adding a new published Playbook

Author checklist (same PR):

1. Add the playbook slug to `PLAYBOOKS` in the test file.
2. Add an override entry for every knob in `VALUE_PRESENCE` declaring
   the new playbook's cell at each of the 3 layers.
3. Update `EXPECTED_EXEMPT_COUNT` accordingly (typically +63 cells
   minus the present-count for the new playbook).
4. Run the test. Green → ship.

## When closing a gap (the expected drift direction)

Author checklist (same PR):

1. Land the seed value in the matching seed script's
   `config: { ... }` block (per B4-impl pattern) OR via a
   `prisma.<model>.update` migration helper.
2. Flip the matrix entry from `absentByDesign(...)` to `PRESENT`.
3. Drop `EXPECTED_EXEMPT_COUNT` by 1.
4. Run the test. Green → ship.

## When the layers disagree (debugging)

| Symptom | Likely cause | Where to look |
|---|---|---|
| Gate fires "gap" on a cell | Author added a knob/playbook to the axis tuples but forgot a matrix entry | `VALUE_PRESENCE` in the test |
| Gate fires "exempt count drifted" | Matrix entry flipped from present to absent-by-design (or vice versa) without ratchet bump | Diff the matrix vs `EXPECTED_EXEMPT_COUNT` |
| Gate fires "Domain not entirely absent" | Someone wired a Domain.config seed value | Decide consciously: did we ship the cascade layer? Update the matrix + assertion framing |
| Inspector chip blank but matrix says `present` | Matrix drifted from observed state | Re-audit the live DB; either update matrix OR mark the cell `absent-by-design` |

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/cascade-value-presence.test.ts` (born 2026-06-22, this PR) | 8 vitests: axis-product sanity, gap-check, gap ratchet, exempt ratchet, non-empty reason, distribution sanity, Domain-NOOP assertion, declaration sanity | New cells shipping unclassified. Silent matrix drift in either direction. Domain-layer accidentally non-empty. |
| `tests/lib/wizard/source-ref-coverage.test.ts` (epic #2166) | Sibling Data Presence Coverage instance | Soft source-ref → ContentSource resolution; same generic enumerate→classify→ratchet shape applied to a different surface |
| `.claude/rules/data-presence-coverage.md` | Parent sub-pillar discipline | Generic absence-of-row failure modes — this rule is one of its instances |
| `lib/cascade/effective-value.ts::FAMILIES` | Runtime dispatch table | The chokepoint that resolves cascade values; this gate pins the DATA the resolver depends on |

## Future hardening

- **Promote ratchet to strict 0 on `present`-only cells** when
  B4-impl ships every operator-approved seed value. At that point
  the matrix's only legitimate `absent-by-design` cells are
  structurally-NULL cells (e.g. Domain NOOP, no-System-default
  knobs).
- **Add per-environment cross-check** when this gate ships its
  runtime sibling — an AppLog subject like
  `data_presence.cascade.unresolved` emitted whenever
  `useEffectiveValue` returns `{unresolvable: true}` for a non-exempt
  cell. The runtime trace closes the loop between the build-time
  matrix and observed production behaviour.
- **Auto-derive `PLAYBOOKS` from DB** when a `seed-domains.ts`-equivalent
  declares "published Playbooks" canonically (today the list is
  hand-maintained from the 2026-06-19 hf_staging prune).

## Related

- [`tests/lib/journey/cascade-value-presence.test.ts`](../../apps/admin/tests/lib/journey/cascade-value-presence.test.ts) — the gate
- [`.claude/rules/data-presence-coverage.md`](./data-presence-coverage.md) — parent sub-pillar meta-rule
- [`.claude/rules/source-ref-coverage.md`](./source-ref-coverage.md) — sibling Data Presence instance (first one shipped)
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage gate (Producer↔Consumer sub-pillar)
- [`apps/admin/lib/cascade/effective-value.ts`](../../apps/admin/lib/cascade/effective-value.ts) — FAMILIES dispatch table
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — Data Presence (Coverage sub-pillar) inventory
- Epic [#2225](https://github.com/WANDERCOLTD/HF/issues/2225) — RHS Inspector Robustness umbrella (parent)
- Epic [#2168](https://github.com/WANDERCOLTD/HF/issues/2168) — Data Presence Coverage umbrella (parent sub-pillar)
- B1 inventory comment on #2225 — authoritative cell-level observed state at land
