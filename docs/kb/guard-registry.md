# Guard Registry

> Consolidates **every executable guard, ratchet, and contract** in HF into one
> CHAIN-style table, classified by whether it survives the hardening. Generalises
> the pattern proven in [`docs/CHAIN-CONTRACTS.md`](../CHAIN-CONTRACTS.md).
>
> **Guards stay as code.** This registry catalogues them and points at the source —
> it never re-implements them as prose. A guard encodes *"the system must still
> prevent #X in any architecture"* — exactly what a rewrite would silently lose.

## Survives-hardening classification (the load-bearing column)

| Class | Meaning | Hardening treatment |
|---|---|---|
| **(a) Invariant** | True in *any* architecture (AI-safety, data integrity, no cross-tenant leak) | **Carry forward** — re-express in the new structure. Highest value. |
| **(b) Scaffold** | Protects *today's* implementation detail (e.g. current slug-uniqueness, the #1177 collapse) | **Consciously retire** when the detail changes — never lose by accident. |
| **(c) Drain** | Temporary ratchet for an in-flight migration | Track to zero, then delete. |
| **(meta)** | Process gate / fitness function (not domain logic) | Keep & extend — these are the methodology. |

## ESLint rules — `apps/admin/eslint-rules/`

| Rule | Prevents | Born | Class |
|---|---|---|---|
| `no-ai-fanout-all` | AI tool executors passing `fanoutScope:'all'` (cohort fan-out from an AI batch) | #854/#878 | **a** |
| `no-ai-forbidden-fields` | AI `input_schema.properties` declaring globally forbidden fields (`role`, …) | — | **a** |
| `no-direct-playbook-config-write` | Direct writes to `Playbook.config`; must use `updatePlaybookConfig` | #854 | **a** |
| `no-direct-spec-config-write` | Direct writes to compose-affecting `AnalysisSpec` fields outside `lib/analysis-spec/` | — | **a** |
| `no-direct-domain-onboarding-write` | Direct writes to Domain `onboarding*`/`identitySpec` outside `lib/domain/update*` | — | **a** |
| `no-orphan-instruction-fallback` | Generic-noun fallbacks for missing module/LO names in prompt transforms | #605 | **a** |
| `no-undeclared-field-require` | `has(...)` refs to field keys not declared in the enclosing `define` | — | **a** |
| `no-unscoped-slug-lookup` | Unscoped slug/ref lookups on per-parent-unique entities (`CurriculumModule`, LO) | #407/#411 | **b** |
| `no-deprecated-curricula-relation` | Reads of the `@deprecated Playbook.curricula` relation; use `playbookCurriculum` | #1177 | **b** |
| `no-module-read-without-course-style-guard` | `CallerModuleProgress` reads/writes outside a `courseStyle` guard | — | **b** |
| `hf-voice/*` | Voice-surface lint rules | — | _TODO(confirm)_ |

## CI check scripts — `apps/admin/scripts/`

| Script | Prevents / asserts | Born | Class |
|---|---|---|---|
| `check-ratchet.sh` | Count-cap ratchet — `tsc_errors` (212), `lint_errors` (0), `lint_warnings` (4423), `quarantined_tests` (37) can only **drop**, never rise. Reads `.ratchet.json`. | #227 | **meta** (master fitness function) |
| `check-fk-consistency.ts` | Cross-playbook leak, orphan-LO, dangling soft-FK | #415/#615 | **a** |
| `check-schema-health.ts` | Schema health invariants | — | **a** |
| `check-anchor-divergence.ts` | `qualificationAnchor` slug-set divergence | #1081 | **b** |
| `check-doc-citations.ts` | Canonical-doc `file::symbol` citation drift | — | **meta** (KB integrity) |
| `check-knowledge-map.ts` | `KNOWLEDGE-MAP.md` ratchet — repo translation layer stays in step | — | **meta** (KB integrity) |
| `check-uplift-visual.ts` | Caller Insights visual regression | — | **meta** (test) |

## Runtime guards & contracts

| Location | Prevents / asserts | Class |
|---|---|---|
| `lib/contracts/registry.ts` (+ `types.ts`) | DB-backed `DataContract` registry (30s TTL) — producer/consumer shape agreement | **a** |
| `lib/prompt/composition/compose-invariants.ts` | Runtime COMPOSE-stage invariants | **a** |
| `.claude/rules/ai-to-db-guard.md` catalogue | ~15 AI-to-DB structural guards (validate-then-write) | **a** (see `invariants.md`) |

## Plan-guard agents — `.claude/agents/`

| Agent | Gate | Class |
|---|---|---|
| `guard-checker` | 15 plan guards | **meta** |
| `arch-checker` | SpecRole taxonomy, entity hierarchy, holographic contracts | **meta** |
| `api-doc-checker` | every route has `@api` JSDoc; public/internal boundary | **meta** |
| `migration-checker` | destructive-migration / data-migration review before `migrate dev` | **meta** |
| `seed-checker` | spec JSON ↔ schema consistency | **meta** |
| `standards-checker` | tests/UI/CSS/auth/quality scorecard | **meta** |

## Drain guards (class c — terminal state, delete when zero)

| Script | Drains | Born |
|---|---|---|
| `migrate-caller-attribute-lo-mastery-keys.ts` | legacy name-form `lo_mastery:*` keys → canonical slug-form | #614 |
| `reconcile-lo-linkage.ts` | LO/assertion soft-FK lag | #615 |
| _other `migrate-*` scripts_ | one-off backfills | _audit per-run_ |

## Doc-only contracts to PROMOTE (the hardening worklist)

`CHAIN-CONTRACTS.md` states the rule: *"if a contract has no enforcement code path, no
test, or no memory doc reference, that's a gap to fix."* Hardening is when we close them —
promote each verbal/doc-only contract into an executable guard (a class-**a** invariant):

- [ ] Every adaptive-loop stage boundary in `CHAIN-CONTRACTS.md` lacking an **Enforcement** cell.
- [ ] `CONTRACTS-PLAYBOOK-CURRICULUM.md` invariants not yet covered by an ESLint rule or CI check.
- [ ] Tenant-isolation invariant (Phase 2): *no tenant-scoped query without a tenant predicate* — promote to a Postgres RLS policy + a fitness-function test.

> _TODO: confirm Class for `hf-voice/*` and any `scripts/audit-*.ts` not yet listed._
