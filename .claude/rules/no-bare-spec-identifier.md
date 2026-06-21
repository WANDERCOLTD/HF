# `no-bare-spec-identifier` — HF-CONFIG chokepoint for contract/sentinel IDs

> Every bare string literal passed to `ContractRegistry.getContract(...)`
> OR carrying a versioned contract-identifier shape
> (`[A-Z_-]+_V\d+`) in runtime `lib/**` and `app/**` code is a Lattice
> violation. Contract / measure-sentinel identifiers are env-overridable
> configuration and live in `lib/config.ts` under `config.specs.*`. A
> literal silently stops resolving the moment the corresponding
> `*_CONTRACT_ID` / `*_SPEC_ID` env override flips.
>
> Sibling to [`no-hardcoded-spec-slug`](https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-hardcoded-spec-slug)
> (Audit HF-I) — that catches the `XXX-NNN` AnalysisSpec **slug** shape;
> this catches the **identifier argument** shape AND the **const-map**
> shape. Both pin the same Lattice pillar (Configuration over Code) from
> different angles.
>
> Sibling chokepoint rules:
> [`no-bare-call-create`](https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-call-create) (#1333),
> [`no-bare-strategy-key`](https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-strategy-key) (#1599),
> [`no-bare-parameter-write`](https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-parameter-write) (#2031).
> Same generic chokepoint-with-allow-list shape; different surface.
>
> Story: [#2182](https://github.com/WANDERCOLTD/HF/issues/2182). Part of
> the Guards pillar of HF Lattice.

## Rule

When you write or modify runtime code under `lib/**` or `app/**` that
references a contract / measure-sentinel identifier:

1. **`ContractRegistry.getContract(...)` calls** — the argument MUST be
   a `config.specs.<accessor>` read, never a string literal.
2. **Const declarations whose value matches `[A-Z_-]+_V\d+` shape** —
   the value MUST be a `config.specs.<accessor>` read, never a string
   literal. Catches the const-map shape:
   ```ts
   // BAD — silently stops resolving under env override
   export const SENTINELS = { PROSODY: "PROSODY-SCORE-V1" };
   // GOOD — env-overridable
   export const SENTINELS = { PROSODY: config.specs.prosodyScoreV1 };
   ```
3. **Add the `config.specs.<accessor>` if missing** — every contract /
   sentinel identifier earns a getter in `lib/config.ts` with an env-var
   override path. The accessor name mirrors the canonical id in
   camelCase (e.g. `SKILL_MEASURE_V1` → `skillMeasureV1`).

## Why this exists

The 2026-06-21 hardcoding audit surfaced 3 incumbent runtime offenders
that bypassed the canonical config path:

- `lib/pipeline/aggregate-runner.ts:184` —
  `ContractRegistry.getContract("SKILL_MEASURE_V1")`
- `lib/goals/track-progress.ts:132` — same shape
- `lib/measurement/write-call-score.ts:174` —
  `PROSODY: "PROSODY-SCORE-V1"` in a const map

Each is a SILENT brittleness: the identifier resolves at the literal
default today, but if the contract is ever renamed / versioned (e.g.
`SKILL_MEASURE_V2`), the lookup returns null and the EMA half-life
falls through to the hard-coded defaults — without any build-time
signal. This is exactly the failure mode `config.specs.*` exists to
prevent.

The shape regex (`[A-Z_-]+_V\d+`) is narrowed from a broader original
specification (`(V\d+|SPEC|ID)`) because `_SPEC` and `_ID` suffixes
overlap broadly with feature flags (`HF_FLAG_*`), log codes
(`MODULE_SETTINGS_NO_MODULE_ID`), and internal sentinels. The versioned
suffix (`_V<n>`) is the high-signal shape for contract / measure-
sentinel IDs and matches every real identifier in the codebase today.
The `ContractRegistry.getContract(literal)` visitor catches the
identifier argument shape regardless of suffix — that's the structural
chokepoint.

## Sibling-writer survey result

Per `.claude/rules/lattice-survey.md`:

| Risk shape | Outcome |
|---|---|
| Sibling-writer drift | No write-side coupling — this rule guards read-side identifier dereferences only. The chokepoint pattern matches `no-bare-call-create` / `no-bare-strategy-key`. |
| Default-deny gates | The rule itself IS the default-deny: bare literals fail edit-time linting. |
| Cascade respect | `config.specs.*` IS the cascade for contract identifiers. The rule forces every read through it. |
| Convention conflict | Sibling rule `no-hardcoded-spec-slug` already enforces slug shape. The two regexes are intentionally disjoint (`^[A-Z]{2,}(-[A-Z]+)*-\d{3}$` vs `^[A-Z][A-Z0-9_-]*[_-]V\d+$`) — no overlap. |

## Allow-list (paths where literals are legitimate)

- `lib/config.ts` — the identifiers LIVE here (the `optional(env, default)`
  defaults).
- `lib/registry/**` — the registry source-of-truth + alias maps.
- `prisma/seed*` and `prisma/migrations/` — seed data + historical
  migrations that intentionally reference contract ids at seed time.
- `prisma/fixtures/` — deterministic seed fixtures.
- `scripts/generate-registry.ts` — generator over canonical sources.
- `scripts/**` — drain / one-off / migration scripts.
- `eslint-rules/**` — this rule's docstring examples live here.
- `docs/**` and `docs-archive/**` — markdown references in
  PARAMETER-RENAME-MAP / CHAIN-CONTRACTS / etc.
- Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`) —
  fixtures intentionally exercise edge-case identifiers + the RuleTester
  string-form examples.
- `_archived/` — read-only legacy code.

## When NOT to apply

The rule is structural — it always applies to runtime `lib/**` and
`app/**` code. What's exempted is the allow-list above. Within an
allow-listed file, literals are fine (they're authoring config or
deterministic fixtures).

When adding a NEW runtime read path that needs a contract / sentinel
identifier:

1. Find or add the `config.specs.<accessor>` getter in `lib/config.ts`.
2. Read via the accessor: `ContractRegistry.getContract(config.specs.<accessor>)`.
3. If the rule fires on a legitimate non-spec identifier (a feature
   flag, an error code, an enum-like marker), check whether a feature-
   flag prefix exclusion applies (`HF_FLAG_*`, `HF_IELTS_*`,
   `NEXT_PUBLIC_*`). If yes, the rule already skips it. If no, the
   identifier shape (`_V<n>` suffix) is the discriminator; rename or
   document.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `eslint-rules/no-bare-spec-identifier.mjs` (#2182, this rule) | Edit-time, error severity from day 1 | New runtime literals for contract / sentinel IDs |
| `tests/eslint-rules/no-bare-spec-identifier.test.ts` (#2182) | 26 RuleTester cases pinning valid / invalid / allow-list / feature-flag exclusion | Rule regression — drift in allow-list, regex, or visitor coverage |
| `lib/config.ts::config.specs.*` | Single source-of-truth | The chokepoint the rule forces every read through |
| `eslint-rules/no-hardcoded-spec-slug.mjs` (Audit HF-I) | Sibling rule, slug shape | The `XXX-NNN` slug variant that this rule's regex deliberately doesn't catch |

## Related

- [`eslint-rules/no-bare-spec-identifier.mjs`](../../apps/admin/eslint-rules/no-bare-spec-identifier.mjs) — the rule
- [`tests/eslint-rules/no-bare-spec-identifier.test.ts`](../../apps/admin/tests/eslint-rules/no-bare-spec-identifier.test.ts) — the tests
- [`lib/config.ts`](../../apps/admin/lib/config.ts) — `config.specs.*` accessor home
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- [`.claude/rules/spec-readonly-boundary.md`](./spec-readonly-boundary.md) — sibling Lattice rule
- Sibling rule `no-hardcoded-spec-slug` (Audit HF-I) — slug shape
- Parent: [#2181](https://github.com/WANDERCOLTD/HF/issues/2181) — S8 NO HARDCODINGS sweep
- Story: [#2182](https://github.com/WANDERCOLTD/HF/issues/2182)
