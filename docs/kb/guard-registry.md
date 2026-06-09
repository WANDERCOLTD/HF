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

## KB-link convention (makes this registry load-bearing)

Every guard points **back** at its row here, closing the loop *guard fires → reads the
invariant → understands the incident → doesn't bypass it*:

- **ESLint rules** set `meta.docs.url` → `…/guard-registry.md#guard-<rule-name>`.
- **`check-*` scripts** print the same anchor URL in their failure output.
- Each wired guard gets a stable anchor below (`<a id="guard-…">`). The table is the
  index; the anchored **Guard detail** blocks are the link targets.

**Meta-ratchet:** [`scripts/capture/check-guard-kb-links.ts`](../../apps/admin/scripts/capture/check-guard-kb-links.ts)
counts ESLint rules missing a KB link and fails if the count rises above its baseline —
a guard that guards the guards. Baseline only ever drops as rules are wired (currently 1/10 wired).

## ESLint rules — `apps/admin/eslint-rules/`

✅ = KB-linked (`meta.docs.url` set).

All 10 rules **✅ KB-linked** (`meta.docs.url` → the matching `#guard-<name>` anchor below).
The meta-ratchet (`check-guard-kb-links.ts`) holds this at 10/10.

| Rule | Prevents | Born | Class |
|---|---|---|---|
| [`no-ai-fanout-all`](#guard-no-ai-fanout-all) | AI tool executors passing `fanoutScope:'all'` (cohort fan-out from an AI batch) | #854/#878 | **a** |
| [`no-ai-forbidden-fields`](#guard-no-ai-forbidden-fields) | AI `input_schema.properties` declaring globally forbidden fields (`role`, `domainId`, `ownerId`) — privilege escalation / cross-tenant moves | — | **a** |
| [`no-direct-playbook-config-write`](#guard-no-direct-playbook-config-write) | Direct writes to `Playbook.config`; must use `updatePlaybookConfig` | #826 | **a** |
| [`no-direct-spec-config-write`](#guard-no-direct-spec-config-write) | Direct writes to compose-affecting `AnalysisSpec` fields outside `lib/analysis-spec/` | #829 | **a** |
| [`no-direct-domain-onboarding-write`](#guard-no-direct-domain-onboarding-write) | Direct writes to Domain `onboarding*`/`identitySpec` outside `lib/domain/update*` | #828 | **a** |
| [`no-orphan-instruction-fallback`](#guard-no-orphan-instruction-fallback) | Generic-noun fallbacks for missing module/LO names in prompt transforms (mechanism: [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-C4) | #1006/#1008 | **a** |
| [`no-undeclared-field-require`](#guard-no-undeclared-field-require) | `has(...)` refs to field keys not declared in the enclosing spec `define` | #1078 | **a** |
| [`no-unscoped-slug-lookup`](#guard-no-unscoped-slug-lookup) | Unscoped slug/ref lookups on per-parent-unique entities (`CurriculumModule`, LO) | #407/#411 | **b** |
| [`no-deprecated-curricula-relation`](#guard-no-deprecated-curricula-relation) | Reads of the `@deprecated Playbook.curricula` relation; use `playbookCurricula` | #1205 | **b** |
| [`no-module-read-without-course-style-guard`](#guard-no-module-read-without-course-style-guard) | `CallerModuleProgress` reads/writes outside a `courseStyle === 'structured'` guard (default-deny) | #1252 | **b** |
| `hf-voice/*` | Voice-surface lint rules | — | _TODO(confirm)_ |

### Guard detail

<a id="guard-no-ai-fanout-all"></a>
**`no-ai-fanout-all`** · class **(a) invariant** · born #854/#878 ·
[rule source](../../apps/admin/eslint-rules/no-ai-fanout-all.mjs) ·
invariant → [`invariants.md`](./invariants.md#ai-to-db-never-let-ai-output-directly-drive-entity-creation)

The pending-changes tray (epic #854) has an asymmetric-default safety property: an
AI-initiated config change may request a **single-caller** recompose, never a **cohort
fan-out**. "Recompose all N affected learners" (Toggle 2) must remain a human-only switch.
This rule fires when an AI tool executor passes `fanoutScope: 'all'` to
`updatePlaybookConfig` / `updateDomainConfig` / `updateAnalysisSpecConfig`. Use `'caller'`
or `'none'`. **Survives hardening:** a domain-safety truth independent of architecture —
carry it forward (post-multi-tenancy it also bounds blast radius to a single tenant's learner).

<a id="guard-no-ai-forbidden-fields"></a>
**`no-ai-forbidden-fields`** · class **(a) invariant** ·
[rule source](../../apps/admin/eslint-rules/no-ai-forbidden-fields.mjs)

AI tool `input_schema.properties` may not declare globally forbidden fields — `role`,
`domainId`, `ownerId`, per-parent identity slugs. Privilege escalation, cross-tenant moves,
and identity reassignment are **human-only**. **Survives hardening:** this is the AI-side
twin of the tenant-isolation invariant — directly carries into multi-tenancy.

<a id="guard-no-direct-playbook-config-write"></a>
**`no-direct-playbook-config-write`** · class **(a) invariant** · born #826 ·
[rule source](../../apps/admin/eslint-rules/no-direct-playbook-config-write.mjs)

All writes to `Playbook.config` must go through `updatePlaybookConfig`
(`lib/playbook/update-playbook-config.ts`) — the choke point that bumps compose staleness
and routes through the pending-changes tray. Direct `prisma.playbook.update({config})`
bypasses both. **Survives hardening:** the choke-point pattern is architecture-independent.

<a id="guard-no-direct-spec-config-write"></a>
**`no-direct-spec-config-write`** · class **(a) invariant** · born #829 ·
[rule source](../../apps/admin/eslint-rules/no-direct-spec-config-write.mjs)

Compose-affecting `AnalysisSpec` fields may only be written via
`lib/analysis-spec/update-analysis-spec-config.ts`. Same choke-point rationale as the
Playbook rule above.

<a id="guard-no-direct-domain-onboarding-write"></a>
**`no-direct-domain-onboarding-write`** · class **(a) invariant** · born #828 ·
[rule source](../../apps/admin/eslint-rules/no-direct-domain-onboarding-write.mjs)

Domain `onboarding*` / `identitySpec` fields may only be written via
`lib/domain/update-domain-config.ts`. Same choke-point rationale.

<a id="guard-no-orphan-instruction-fallback"></a>
**`no-orphan-instruction-fallback`** · class **(a) invariant** · born #1006/#1008 ·
[rule source](../../apps/admin/eslint-rules/no-orphan-instruction-fallback.mjs) ·
mechanism → [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-C4

Prompt-composition transforms must not paper over a missing module/LO name with a
generic-noun fallback ("the module", "this objective") — drop the line via a conditional
spread instead. A wrong-but-plausible name silently corrupts the composed prompt.
**Survives hardening:** a content-integrity truth at a COMPOSE-stage boundary.

<a id="guard-no-undeclared-field-require"></a>
**`no-undeclared-field-require`** · class **(a) invariant** · born #1078 ·
[rule source](../../apps/admin/eslint-rules/no-undeclared-field-require.mjs)

`has(...)` may only reference field keys declared in the enclosing spec `define` block —
catches typo'd / removed keys at lint time instead of as a silent always-false at runtime.
**Survives hardening:** contract-integrity between a spec's declaration and its readers.

<a id="guard-no-unscoped-slug-lookup"></a>
**`no-unscoped-slug-lookup`** · class **(b) scaffold** · born #407/#411 ·
[rule source](../../apps/admin/eslint-rules/no-unscoped-slug-lookup.mjs)

Slug/ref lookups on `CurriculumModule` / `LearningObjective` must be scoped by their
parent (`curriculumId`) — slugs are **per-parent-unique, not global**. Use
`resolveModuleByLogicalId`. **Survives hardening: conditionally** — class **b** because it
encodes today's per-parent-unique slug schema. If the data model changes (e.g. globally
unique IDs, or tenant-scoped slugs), retire this rule consciously, in the same PR.

<a id="guard-no-deprecated-curricula-relation"></a>
**`no-deprecated-curricula-relation`** · class **(b) scaffold** · born #1205 ·
[rule source](../../apps/admin/eslint-rules/no-deprecated-curricula-relation.mjs)

Reads of the `@deprecated Playbook.curricula` direct relation are blocked; use the
canonical `Playbook.playbookCurricula` join. **Survives hardening: no** — this is migration
scaffolding for the #1177 Curriculum/Playbook collapse. Delete once the deprecated relation
is dropped from the schema.

<a id="guard-no-module-read-without-course-style-guard"></a>
**`no-module-read-without-course-style-guard`** · class **(b) scaffold** · born #1252 ·
[rule source](../../apps/admin/eslint-rules/no-module-read-without-course-style-guard.mjs)

`CallerModuleProgress` reads/writes must sit behind a `courseStyle === 'structured'` guard
(default-deny). **Survives hardening: conditionally** — tied to the current `courseStyle`
modelling; revisit if course styles are reworked.

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
