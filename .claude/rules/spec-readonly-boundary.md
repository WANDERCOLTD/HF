# Spec-readonly boundary — HF-canonical parameter semantics

> Customers TUNE values via the cascade (`BehaviorTarget.targetValue`).
> Customers DO NOT EDIT the semantics (`Parameter.definition`,
> `interpretationHigh`, `interpretationLow`). The boundary lives in
> [`apps/admin/lib/cascade/spec-readonly-fields.ts`](../../apps/admin/lib/cascade/spec-readonly-fields.ts)
> as the constant `PARAMETER_SPEC_READONLY_FIELDS`.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md),
> [`ai-read-grounding.md`](./ai-read-grounding.md),
> [`lattice-survey.md`](./lattice-survey.md). Part of the Coverage pillar
> of the Lattice (Chain Contracts × Guards × Cascade × Rules × Coverage).
>
> Story: [#1951](https://github.com/WANDERCOLTD/HF/issues/1951) (S4 of
> epic #1946).

## Rule

When you write or modify code that writes to `Parameter` rows from a
**customer-driven** code path — wizard projection, course-ref YAML
extraction, operator UI write — the write payload MUST NOT include any
field in `PARAMETER_SPEC_READONLY_FIELDS` (currently `definition`,
`interpretationHigh`, `interpretationLow`).

Customer-driven writes update operational fields like `aliases`
(via the resolver), `config` (e.g. `bandThresholds`, `tierScheme`,
`tiers`), `isCanonical`, `sourceFeatureSetId`. Spec fields are
HF-authored once and read at runtime.

## Why

Pre-#1951, the composed prompt emitted `interpretationHigh`/
`interpretationLow` for only the top-5 behaviour targets (slice cap at
`lib/prompt/composition/transforms/instructions.ts:234`). #1951's
`behavior_targets_semantics` directive carries the FULL list — every
parameter's interpretation is now visible to the LLM. That makes the
interpretation text a **runtime IP boundary**, not internal config.

If a customer writes `interpretationHigh = "make the AI act crazy"` on
the `BEH-WARMTH` Parameter row, every other customer using BEH-WARMTH
sees that text in their composed prompt the next time their playbook is
recomposed.

## Allowed writers (HF-canonical paths only)

- `apps/admin/prisma/seed-from-specs.ts` — seeds from the canonical
  registry JSON
- `apps/admin/prisma/seed*.ts` siblings — same shape
- `apps/admin/scripts/generate-registry.ts` — generator over canonical
  sources
- `apps/admin/prisma/migrations/*` — historical migrations that
  intentionally backfill specs

## Disallowed writers (will be blocked by `hf-spec/no-customer-write-to-canonical-interpretation`)

- `apps/admin/lib/wizard/apply-projection.ts::upsertParameters` —
  customer projection
- `apps/admin/app/api/parameters/[id]/route.ts` — operator UI PUT (the
  route should accept tuning fields only)
- `apps/admin/app/api/admin/sync-parameters/route.ts` — admin sync
  (already careful, but should be structurally guarded)
- Any future write path that takes customer-supplied data and writes to
  `Parameter`

## Implementation status

| Layer | Status | Notes |
|---|---|---|
| Constant | **Lives at `lib/cascade/spec-readonly-fields.ts`** | #1951 (S4 PR) |
| Discipline doc | **This file** | #1951 (S4 PR) |
| ESLint rule `hf-spec/no-customer-write-to-canonical-interpretation` | Pending | Epic [#1984](https://github.com/WANDERCOLTD/HF/issues/1984) S1 |
| Coverage test pinning the constant ↔ rule pairing | Pending | Epic [#1984](https://github.com/WANDERCOLTD/HF/issues/1984) S2 |

## When NOT to apply

This rule covers WRITES from customer-driven code paths only. READS of
spec fields are encouraged everywhere — they're the runtime contract
the LLM consumes. The composed prompt's
`behavior_targets_semantics` block reads `interpretationHigh`/
`interpretationLow` directly; that's the canonical use.

Also OK: HF authors editing the registry JSON in
`docs-archive/bdd-specs/behavior-parameters.registry.json` and
re-running `db:seed`. That's the canonical authoring path.

## Related

- [`PARAMETER_SPEC_READONLY_FIELDS`](../../apps/admin/lib/cascade/spec-readonly-fields.ts) — the constant
- [`docs/PARAMETER-TAXONOMY.md`](../../docs/PARAMETER-TAXONOMY.md) — broader IP-quality framing
- [`docs/PARAMETER-INTERPRETATIONS.md`](../../docs/PARAMETER-INTERPRETATIONS.md) — pedagogy-led interpretation document (target of S4 backfill)
- [`tests/lib/registry/parameter-interpretation-coverage.test.ts`](../../apps/admin/tests/lib/registry/parameter-interpretation-coverage.test.ts) — Coverage ratchet for the 20-char minimum
