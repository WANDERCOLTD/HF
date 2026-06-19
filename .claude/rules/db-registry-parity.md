# DB ↔ JSON registry parity (Lattice multi-pillar discipline)

> When a DB column carries a value drawn from a canonical JSON registry
> (or any HF-canonical source of truth), the parity between the live DB
> and the registry MUST be protected by **all 5 Lattice pillars where
> they apply** — not only the JSON source side. Protecting one side
> only is how silent multi-year drift happens.
>
> Sibling to [`parameter-coverage.md`](./parameter-coverage.md) (per-row
> consumer coverage), [`parameter-measurement-coverage.md`](./parameter-measurement-coverage.md)
> (per-row measurement coverage), [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (journey-setting storagePath consumer coverage), and
> [`registry-schema-coverage.md`](./registry-schema-coverage.md)
> (schema↔registry bidirectional coverage).
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> and [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) as
> a Coverage-pillar discipline (cross-pillar — touches Coverage, Guards,
> and Chain Contracts).

## Rule

When a DB column's value set is drawn from a canonical SoT (JSON
registry, TypeScript constant, spec catalogue), the column MUST be
protected by **every Lattice pillar that applies** to the surface:

| Pillar | Mechanism | Question it answers |
|---|---|---|
| **Coverage (source)** | Test pins every JSON / TS / spec entry against the canonical set | "Does the SOURCE conform to the canonical taxonomy?" |
| **Coverage (DB)** | Test pins every LIVE DB row against the canonical set | "Does the DB conform to the canonical taxonomy?" |
| **Guards (write-time)** | ESLint rule blocks bare writes outside canonical chokepoints | "Can a new bare write re-introduce off-canonical drift?" |
| **Guards (DB)** | Postgres CHECK constraint (or trigger / FK) | "Can a write reach the column at all without conforming?" |
| **Cascade** | N/A unless the column is cascadable | "Does the cascade resolver respect the canonical set?" |
| **Chain Contracts** | Invariant row in `docs/CHAIN-CONTRACTS.md` | "Is the parity contract documented at the chain layer?" |
| **Rules** | This file (or a sibling) | "Is the multi-pillar discipline discoverable?" |

A column protected by ≤2 pillars is **structurally fragile**. The
2026-06-19 PR #2036 audit surfaced exactly this shape on
`Parameter.domainGroup` — the JSON source had a Coverage test
(`parameter-domain-group-taxonomy.test.ts`, #1948), but the DB had no
ratchet, no CHECK constraint, and no parity test. Result: 46% drift on
hf_sandbox and 70% on hf_staging, undetected for ~6 months.

## When this applies

Any column where ALL of the following are true:

1. The value set is bounded and HF-canonical (i.e. not a free-form
   string, not customer-tunable).
2. The canonical set is sourced from a registry JSON, a TypeScript
   constant, or a spec catalogue.
3. The column is persisted in Postgres (not a derived value computed at
   read time).

Concrete examples in HF:

- `Parameter.domainGroup` — 12-tuple canonical, sourced from
  `lib/registry/canonical-domain-group.ts` (the case study below).
- `AnalysisSpec.outputType` — bounded enum, currently convention-only
  (flagged ❌ GAP HIGH in `lattice-chains.md`).
- `CallScore.parameterId` — soft-FK to `Parameter.parameterId` set,
  protected by `check-fk-consistency.ts` Query 11 plus the per-row
  `parameter-measurement-coverage.test.ts` cross-check.
- `PlaybookConfig.<setting>` keys — sourced from the JOURNEY_SETTINGS
  registry, protected by `registry-schema-coverage.test.ts` (bidirectional).

When this does NOT apply:

- Customer-tunable values (e.g. `BehaviorTarget.targetValue` numeric —
  customers set the value within a range; there's no canonical "right"
  set).
- Free-form strings (e.g. `AnalysisSpec.domain` — closed as won't-fix
  in PR #2032).
- Derived values not persisted in DB.

## The worked example — `Parameter.domainGroup`

Post-S3a/S3b/S3c, every pillar that applies is wired:

| Pillar | Mechanism | Location | Story |
|---|---|---|---|
| Coverage (source) | JSON registry canonical check | `apps/admin/tests/lib/registry/parameter-domain-group-taxonomy.test.ts` | #1948 |
| Coverage (DB) | Live-DB parity ratchet | `apps/admin/tests/lib/registry/parameter-domain-group-db-parity.test.ts` | #2040 (S7) |
| Guards (write-time) | ESLint chokepoint | `apps/admin/eslint-rules/no-bare-parameter-write.mjs` | #2034 (S1) |
| Guards (DB) | Postgres CHECK constraint | `apps/admin/prisma/migrations/<ts>_2031_s3c_parameter_domain_group_check/migration.sql` | #2031 S3c |
| Cascade | N/A — `domainGroup` is presentation metadata, not cascadable | — | (per `PARAMETER-TAXONOMY.md` §"Customer override boundary") |
| Chain Contracts | "DB `Parameter.domainGroup` mirrors JSON canonical 12-tuple" | `docs/CHAIN-CONTRACTS.md` Link §<TBD> | follow-on |
| Rules | This file | `.claude/rules/db-registry-parity.md` | #2041 (S8 — this file) |

Five pillars on a single column. Each pillar catches a distinct
failure mode:

- **Pillar 1 alone** caught nothing for ~6 months — the JSON registry
  stayed canonical while the DB drifted via legitimate write paths that
  predated the runtime canonical-helper (S1 #2034 closed that).
- **Pillar 3 alone** (the ESLint chokepoint) prevents NEW drift from
  today but says nothing about INCUMBENT debt.
- **Pillar 2** (DB parity ratchet) freezes incumbent debt and refuses
  to grow it.
- **Pillar 4** (DB CHECK) is the final structural backstop — once
  ratchet hits 0, the CHECK prevents resurrection.
- **Pillar 7** (this rule) makes the multi-pillar discipline
  discoverable so the next column-protection PR doesn't repeat the
  one-pillar mistake.

## The anti-pattern this rule names

> "I added a Coverage test on the canonical JSON. Done."

The 2026-06-19 audit's central finding: the existing
`parameter-domain-group-taxonomy.test.ts` ratchet validated the JSON
SOURCE perfectly. But the DB write path could (and did) bypass it via
runtime code that didn't read the registry. The test never queried the
DB. So the SOURCE stayed clean while the DB drifted independently.

The structural fix wasn't "make the test smarter" — it was "add the
4 sibling pillars." This rule encodes that lesson.

## When adding a new column with a canonical value set

Author checklist (same PR, or tracked as a multi-slice epic):

1. Source: write the canonical set as a TypeScript constant
   (`lib/registry/canonical-<name>.ts`) + JSON registry if applicable.
2. Pillar 1: pin every registry entry against the canonical constant
   (`tests/lib/registry/<name>-taxonomy.test.ts`).
3. Pillar 2: pin every live DB row against the canonical constant
   (`tests/lib/registry/<name>-db-parity.test.ts`) — ratchet at
   incumbent count if non-zero; drop to 0 once data is clean.
4. Pillar 3: ESLint chokepoint that blocks bare
   `prisma.<Model>.{create,update,upsert}({data: {...<column>...}})`
   outside the canonical writers
   (`eslint-rules/no-bare-<model>-write.mjs`).
5. Pillar 4: Postgres CHECK constraint via migration after pillars 2+3
   bring incumbent debt to 0.
6. Pillar 6: row in `docs/CHAIN-CONTRACTS.md` naming the producer,
   consumer, and the structural invariant.
7. Pillar 7: row in `docs/lattice-chains.md`'s matrix referencing all
   pillars above. Update this rule file's "worked example" or add a
   sibling worked example.

You may LAND THESE INCREMENTALLY — the rule is about the END STATE.
A new column that ships with only Pillar 3 (the ESLint chokepoint) is
acceptable IF it carries a follow-on filing for Pillars 1, 2, 4, 6.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/registry/parameter-domain-group-taxonomy.test.ts` (#1948) | JSON-source ratchet | Source-side drift |
| `tests/lib/registry/parameter-domain-group-db-parity.test.ts` (#2040 S7) | Live-DB ratchet | DB drift beyond incumbent |
| `eslint-rules/no-bare-parameter-write.mjs` (#2034 S1) | Edit-time block | New bare writes outside canonical chokepoints |
| `eslint-rules/no-bare-behavior-target-write.mjs` (#2042 S2) | Edit-time block | Sibling write-surface drift |
| `prisma/migrations/<ts>_2031_s3c_parameter_domain_group_check/migration.sql` (S3c, planned) | DB CHECK constraint | Schema-level structural backstop |
| `lib/registry/canonical-domain-group.ts::resolveCanonicalDomainGroup()` | Runtime chokepoint | Silent fallback to non-canonical value (the #2029 / #2030 bug class) |
| `docs/lattice-chains.md` (#1863) | Inventory | Author discoverability when adding a new column |
| `docs/kb/guard-registry.md` | Per-guard catalogue | Operator discoverability when triaging a CI fail |

## When NOT to apply

This rule is about **bounded canonical sets persisted in DB**. It does
NOT apply to:

- Free-form string columns (the rule's WHEN-THIS-APPLIES gate excludes
  them).
- Customer-tunable values (cascade-managed; sibling discipline in
  [`cascade-reuse.md`](./cascade-reuse.md)).
- Soft-FK columns that point at row IDs (sibling discipline in
  `check-fk-consistency.ts`).
- Derived columns computed at read time (no DB row to drift).
- One-off enum columns where the value set is structurally encoded by
  Prisma's `enum` type — Prisma's enum is itself Pillar 4, so the
  multi-pillar wiring is automatic.

The reason to NOT use a Prisma enum on `Parameter.domainGroup` (and
to instead carry a `String` column with these guard layers) is that
the canonical set is **operator-visible curation**, not a developer-set
schema constant. Adding a 13th canonical group should be a curation
decision documented in `PARAMETER-TAXONOMY.md`, not a `schema.prisma`
edit-time decision. The multi-pillar discipline this rule documents
accepts that trade-off and replaces the Prisma-enum guarantee with the
5-pillar guarantee.

## Cross-references

- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — the
  inventory this rule's worked-example row belongs to.
- [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) — the
  per-guard catalogue.
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding
  survey that should reference this rule when touching a canonical-set
  column.
- [`.claude/rules/parameter-coverage.md`](./parameter-coverage.md) —
  per-row consumer coverage sibling.
- [`.claude/rules/parameter-measurement-coverage.md`](./parameter-measurement-coverage.md) — per-row measurement coverage sibling.
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — registry storagePath sibling.
- [`.claude/rules/registry-schema-coverage.md`](./registry-schema-coverage.md) — schema↔registry sibling.
- Epic [#2031](https://github.com/WANDERCOLTD/HF/issues/2031) — the
  chokepoint guards extension that surfaced this multi-pillar pattern.
- PR [#2036](https://github.com/WANDERCOLTD/HF/pull/2036) — the audit
  block that found 46% / 70% drift and triggered the S3a/S3b/S3c/S7/S8
  chain.
- Story [#2041](https://github.com/WANDERCOLTD/HF/issues/2041) — this
  S8 slice.
