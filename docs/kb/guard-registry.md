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

**Meta-ratchet:** [`scripts/capture/check-eslint-rule-tests.ts`](../../apps/admin/scripts/capture/check-eslint-rule-tests.ts)
fails if any rule is missing a sibling test file at `apps/admin/tests/eslint-rules/<rule>.test.ts`.
Each test file runs the [`smokeRule`](../../apps/admin/tests/eslint-rules/_helpers.ts) structural
check (meta.type, KB back-link, messages, at-least-one-visitor on a guarded probe path) plus —
for rules with non-trivial logic — RuleTester behavioural cases. **HF-F (2026-06-11):** rule
tests previously had a 2-location split (smoke at repo-root `tests/eslint-rules/`, behavioural
at `apps/admin/tests/eslint-rules/`); the repo-root files weren't picked up by the
apps/admin-rooted vitest runner, so smoke checks existed for the ratchet but never RAN. HF-F
collapsed the split: 18 rules, 1 file each, both checks in the same file, both actually
execute. Surfaced 5 latent rule defects (the path-scoped rules whose `create()` returned `{}`
for `/dev/null` probe — fixed by extending `smokeRule`'s `PROBE_FILENAMES`).

## ESLint rules — `apps/admin/eslint-rules/`

✅ = KB-linked (`meta.docs.url` set).

All 12 rules **✅ KB-linked** (`meta.docs.url` → the matching `#guard-<name>` anchor below).
The meta-ratchet (`check-guard-kb-links.ts`) holds this at 12/12.

| Rule | Prevents | Born | Class |
|---|---|---|---|
| [`no-ai-fanout-all`](#guard-no-ai-fanout-all) | AI tool executors passing `fanoutScope:'all'` (cohort fan-out from an AI batch) | #854/#878 | **a** |
| [`no-ai-forbidden-fields`](#guard-no-ai-forbidden-fields) | AI `input_schema.properties` declaring globally forbidden fields (`role`, `domainId`, `ownerId`) — privilege escalation / cross-tenant moves | — | **a** |
| [`no-direct-playbook-config-write`](#guard-no-direct-playbook-config-write) | Direct writes to `Playbook.config`; must use `updatePlaybookConfig` | #826 | **a** |
| [`no-direct-spec-config-write`](#guard-no-direct-spec-config-write) | Direct writes to compose-affecting `AnalysisSpec` fields outside `lib/analysis-spec/` | #829 | **a** |
| [`no-direct-domain-onboarding-write`](#guard-no-direct-domain-onboarding-write) | Direct writes to Domain `onboarding*`/`identitySpec` outside `lib/domain/update*` | #828 | **a** |
| [`no-orphan-instruction-fallback`](#guard-no-orphan-instruction-fallback) | Generic-noun fallbacks for missing module/LO names in prompt transforms (mechanism: [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-C4) | #1006/#1008 | **a** |
| [`no-undeclared-field-require`](#guard-no-undeclared-field-require) | `has(...)` refs to field keys not declared in the enclosing spec `define` | #1078 | **a** |
| [`no-bare-call-create`](#guard-no-bare-call-create) | Bare `prisma.call.create` / `prisma.session.create` outside allow-list; must use `createCallEnteringPipeline` / `createSession` | #1333/#1342 | **a** |
| [`no-bare-call-score-write`](#guard-no-bare-call-score-write) | Bare `prisma.callScore.{create,update,upsert}` outside allow-list; must use `writeCallScore` so every row stamps `analysisSpecId` | #1539 | **a** |
| [`no-hardcoded-greeting-in-composition`](#guard-no-hardcoded-greeting-in-composition) | Literal greeting strings in prompt-composition transforms / voice assistant-config builders | #1384 | **a** |
| [`no-unscoped-slug-lookup`](#guard-no-unscoped-slug-lookup) | Unscoped slug/ref lookups on per-parent-unique entities (`CurriculumModule`, LO) | #407/#411 | **b** |
| [`no-deprecated-curricula-relation`](#guard-no-deprecated-curricula-relation) | Reads of the `@deprecated Playbook.curricula` relation; use `playbookCurricula` | #1205 | **b** |
| [`no-module-read-without-course-style-guard`](#guard-no-module-read-without-course-style-guard) | `CallerModuleProgress` reads/writes outside a `courseStyle === 'structured'` guard (default-deny) | #1252 | **b** |
| [`hf-voice/no-vapi-column-ref`](#guard-no-vapi-column-ref) | Disallow the 6 pre-#1020 `vapi`-prefixed Call columns; use `voice*` names (mechanism: [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-VP3) | #1020/#1024 | **a** |
| [`hf-voice/no-vapi-tool-definitions-const`](#guard-no-vapi-tool-definitions-const) | Disallow the `VAPI_TOOL_DEFINITIONS` TS const; load via TOOLS-001 spec (mechanism: [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-VP2) | #1019/#1024 | **a** |
| [`no-bespoke-async-polling`](#guard-no-bespoke-async-polling) | Bespoke `setInterval`/`setTimeout` retry loops outside an allow-list; use `lib/async/wait-until-ready.ts` | G7 / 2026-06-11 | **meta** |
| [`hf-security/no-secrets-in-client`](#guard-no-secrets-in-client) | Plaintext credentials / secret-shaped literals in `"use client"` files (they ship in the browser bundle) | HF-J / 2026-06-11 | **a** |
| [`hf-config/no-hardcoded-spec-slug`](#guard-no-hardcoded-spec-slug) | Hardcoded spec-slug literals (`TUT-001`, `GOAL-001`, …) in `lib/`+`app/` runtime; use `config.specs.*`. **Active (error)** after HF-I sweep | HF-I / 2026-06-11 | **b** |
| [`hf-goals/no-bare-strategy-key`](#guard-no-bare-strategy-key) | Bare string literals assigned to `Goal.progressStrategy` outside the canonical `StrategyKey` enum; allow-list covers the strategies registry alias map + test files | #1599 | **a** |

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

<a id="guard-no-bare-call-create"></a>
**`no-bare-call-create`** · class **(a) invariant** · born #1333/#1342 ·
[rule source](../../apps/admin/eslint-rules/no-bare-call-create.mjs)

Every `Call` row entering the pipeline MUST carry `(playbookId, requestedModuleId,
curriculumModuleId)` at creation time; every `Session` row MUST go through `createSession`
so `CallerSequenceCounter` increments atomically, `voiceConfigSnapshot` populates, and the
I-CT2 `usedPromptId` cascade resolves. This rule blocks bare `prisma.call.create` and
`prisma.session.create` outside the explicit allow-list of canonical builder sites.
The allow-list in `no-bare-call-create.mjs` must be updated when adding a deliberate
bypass (harness, seed, batch import) — making the bypass intentional and documented.
**Survives hardening:** FK-completeness and atomic counter assignment are write-path
invariants independent of architecture; the builder pattern carries forward.

<a id="guard-no-bare-call-score-write"></a>
**`no-bare-call-score-write`** · class **(a) invariant** · born #1539 ·
[rule source](../../apps/admin/eslint-rules/no-bare-call-score-write.mjs)

Every `CallScore` row written from the production pipeline MUST carry `analysisSpecId`
(the AnalysisSpec whose rubric produced the score). The chokepoint helper `writeCallScore`
requires the column in its TypeScript signature AND asserts non-empty at runtime; this
rule stops a future edit from smuggling a bare `prisma.callScore.{create,update,upsert}`
past the helper. Pairs structurally with `no-bare-call-create` — same builder-pattern
discipline, applied to the measurement write path. Allow-list updates accompany any
deliberate bypass (drain scripts, demo reset, manual ops) so the bypass stays
documented. **Survives hardening:** spec-driven measurement is an architectural
property of the pipeline; the builder pattern carries forward.

<a id="guard-no-bare-strategy-key"></a>
**`hf-goals/no-bare-strategy-key`** · class **(a) invariant** · born #1599 ·
[rule source](../../apps/admin/eslint-rules/no-bare-strategy-key.mjs)

`Goal.progressStrategy` is the dispatch key for the mastery-progress strategy registry
(`lib/goals/strategies/registry.ts`). The canonical keys live in
`lib/goals/strategies/types.ts::StrategyKey` (`skill_ema` / `lo_rollup` /
`assessment_readiness` / `connect_warmth_avg` / `manual_only`). A bare string literal
not in the enum either silently falls through to `manual_only` (cohort frozen at 0% —
the #1554 / Cyrus fingerprint) or relies on the historical-aliases map (`lo_mastery →
lo_rollup`) carrying a workaround forever. This rule fires on any object literal
`Property` named `progressStrategy` whose value is a string `Literal` not in the
canonical set. Allow-list: `lib/goals/strategies/registry.ts` (the alias map
intentionally carries historical keys as MAP keys) + test files. **Survives hardening:**
the strategy-dispatch contract is structural; new strategies extend the enum + the
hardcoded mirror in the rule itself.

<a id="guard-no-hardcoded-greeting-in-composition"></a>
**`no-hardcoded-greeting-in-composition`** · class **(a) invariant** · born #1384 ·
[rule source](../../apps/admin/eslint-rules/no-hardcoded-greeting-in-composition.mjs)

Greeting style ("Hi ${name}!", "Welcome back!") is a course-tunable behaviour — it MUST
be read from `playbook.config.welcome.*` / `firstCall.*` or live in the explicit system-default
templates under `lib/prompt/composition/defaults/`. Literal greeting strings in
prompt-composition transforms or voice assistant-config builders bypass the configurable
layers and make greetings un-customisable from Course Design Console. This rule fires on
`Literal` / `TemplateLiteral` nodes matching the greeting-word regex inside guarded paths
(`lib/prompt/composition/transforms/`, `lib/voice/build-assistant-config.ts`,
`lib/voice/route-handlers.ts`), excepting the explicit defaults allowlist.
**Survives hardening:** "Configuration over Code" for learner-facing utterances is an
architectural principle, not tied to the current prompt-composition structure.

<a id="guard-no-vapi-column-ref"></a>
**`hf-voice/no-vapi-column-ref`** · class **(a) invariant** · born #1020/#1024 ·
[rule source](../../apps/admin/eslint-rules/hf-voice/no-vapi-column-ref.mjs) ·
mechanism → [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-VP3 (COMPOSE → VOICE PROVIDER)

#1020 renamed 6 `Call.vapi*` columns to canonical `Call.voice*` to decouple the
schema from any single voice vendor. The audit counter `vapiNamedColumnsOnCallModel`
(#1016) drove to 0 after the migration; this rule keeps it at 0 by failing CI on any
reference to the old names (`vapiCallId`, `vapiTranscript`, `vapiRecordingUrl`,
`vapiCost`, `vapiStartedAt`, `vapiEndedAt`). **Survives hardening:** vendor-neutral
schema naming is an architectural principle independent of which voice providers HF
supports — carry forward through any future provider mix.

<a id="guard-no-vapi-tool-definitions-const"></a>
**`hf-voice/no-vapi-tool-definitions-const`** · class **(a) invariant** · born #1019/#1024 ·
[rule source](../../apps/admin/eslint-rules/hf-voice/no-vapi-tool-definitions-const.mjs) ·
mechanism → [CHAIN-CONTRACTS](../CHAIN-CONTRACTS.md) I-VP2 (COMPOSE → VOICE PROVIDER)

#1019 moved voice tool definitions into the `TOOLS-001` AnalysisSpec; runtime loading
goes through `lib/voice/load-tool-definitions.ts`. The audit counter
`vapiToolDefinitionsConstantPresent` (#1016) drove to 0 after the spec migration; this
rule keeps it at 0 by failing CI on any future re-introduction of a hardcoded TS
constant named `VAPI_TOOL_DEFINITIONS`. **Survives hardening:** the
"specs-as-source-of-truth-for-AI-tooling" pattern is architecture-independent —
parallel rules will be needed if/when other tool-loading constants are migrated.

<a id="guard-no-bespoke-async-polling"></a>
**`no-bespoke-async-polling`** · class **meta** · born G7 / 2026-06-11 ·
[rule source](../../apps/admin/eslint-rules/no-bespoke-async-polling.mjs) ·
helper → [`lib/async/wait-until-ready.ts`](../../apps/admin/lib/async/wait-until-ready.ts) ·
ADR → [chase-prevention methodology](../decisions/2026-06-11-chase-prevention-methodology.md)

Bespoke `setInterval` / `setTimeout` retry loops are the AP-3 chase pattern: every author
re-derives deadline math, abort signalling, structured timeout logging, and the
exception-vs-timeout split — usually subtly wrong. The 2026-06-09 hardening drill shipped
FIVE "wait for X" fixes before the structural cleanup eliminated them. This rule fires on
`while`/`for`/`do-while` blocks containing `setTimeout`/`setInterval`, **outside an
allow-list** of grandfathered call sites (12 today — track to zero in
`lib/rate-limit.ts`, `lib/pipeline/prosody-runner.ts`, `lib/content-trust/extract-*`, etc.).
Severity is `warn` until the migration follow-up; new sites are caught now. The canonical
replacement is `waitUntilReady({ predicate, ready, timeout, interval, label, onTimeout?,
signal? })` from `lib/async/wait-until-ready.ts`. **Survives hardening:** "single async
chokepoint" is a methodology fitness function, architecture-independent.

<a id="guard-no-secrets-in-client"></a>
**`hf-security/no-secrets-in-client`** · class **a** · born HF-J / 2026-06-11 ·
[rule source](../../apps/admin/eslint-rules/no-secrets-in-client.mjs) ·
test → [`tests/eslint-rules/no-secrets-in-client.test.ts`](../../apps/admin/tests/eslint-rules/no-secrets-in-client.test.ts)

Anything a `"use client"` component holds as a string literal ships to the browser. The
2026-06-11 audit (HF-B) found `app/login/page.tsx` declaring a module-scope `DEMO_ACCOUNTS`
array with plaintext passwords — present in the PROD bundle regardless of the runtime
`isNonProd` render gate. This rule fires, **only in files carrying the `"use client"`
directive**, when (1) a credential-shaped key (`password`, `secret`, `apiKey`, `privateKey`,
`clientSecret`, `accessToken`, …) is assigned a non-empty string literal, or (2) any literal
matches a high-confidence secret shape (OpenAI `sk-`, Anthropic, AWS `AKIA`, GitHub `ghp_`,
JWT, Google `AIza`). Server files, `process.env.*` / identifier values, and empty strings
pass. The one known offence (the build-stripped demo creds) carries a documented
`eslint-disable` with rationale. Severity `error` from day 1. **Survives hardening:** "no
secret in browser-shipped code" is an architecture-independent data-safety invariant.

<a id="guard-no-hardcoded-spec-slug"></a>
**`hf-config/no-hardcoded-spec-slug`** · class **b** · born HF-I / 2026-06-11 · **status: active (error)** ·
[rule source](../../apps/admin/eslint-rules/no-hardcoded-spec-slug.mjs) ·
test → [`tests/eslint-rules/no-hardcoded-spec-slug.test.ts`](../../apps/admin/tests/eslint-rules/no-hardcoded-spec-slug.test.ts)

Spec slugs are env-overridable config (`config.specs.*`, `lib/config.ts`). A literal slug in
runtime code silently stops matching once the corresponding `*_SPEC_SLUG` env var is
overridden. The audit (HF-I) found two live bugs — `extract-goals.ts` wrote
`sourceSpecSlug: "GOAL-001"` to the DB with no config backing (fixed by adding
`config.specs.goal`), and `pedagogy.ts` matched `slug.includes("TUT-001")` (fixed to
`config.specs.defaultArchetype`). The rule fires on a string literal matching
`^[A-Z]{2,}(-[A-Z]+)*-\d{3}$` inside `lib/`+`app/`, allow-listing `lib/config.ts`, three
registries / mirrors (`lib/demo/registry.ts` — demo catalogue; `lib/registry/index.ts` —
Parameter ID registry, where the rule's shape-only regex would otherwise false-positive on
behaviour Parameter IDs like `CP-004`; `lib/institution-types/sector-config.ts` — documented
client mirror of `config.specs.*Archetype` that cannot import `lib/config.ts` because it
ships to the browser), tests, scripts, `prisma/`, and `docs-archive/`. **Activation (the
sweep):** 29 residual sites cleared in the same PR — 16 false-positives moved to the
ALLOWLIST_PATH_FRAGMENTS, 1 SettingsClient search keyword carries an inline disable with
rationale, and 13 runtime consumers across 7 files were routed through 4 new getters
(`aggComprehension` / `aggDiscussion` / `aggCoaching` / `goalProgress`). Rule severity
promoted dormant → `error`. **Survives hardening as scaffold (b):** it protects today's
`config.specs.*` indirection; retire if the slug-config mechanism changes.

## CI check scripts — `apps/admin/scripts/`

| Script | Prevents / asserts | Born | Class |
|---|---|---|---|
| `check-ratchet.sh` | Count-cap ratchet — `tsc_errors` (190), `lint_errors` (0), `lint_warnings` (4426), `quarantined_tests` (36), `knip_unused` (161) can only **drop**, never rise. Reads `.ratchet.json`. | #227 | **meta** (master fitness function) |
| `check-fk-consistency.ts` | Cross-playbook leak, orphan-LO, dangling soft-FK | #415/#615 | **a** |
| `check-schema-health.ts` | Schema health invariants | — | **a** |
| `check-anchor-divergence.ts` | `qualificationAnchor` slug-set divergence | #1081 | **b** |
| `check-doc-citations.ts` | Canonical-doc `file::symbol` citation drift | — | **meta** (KB integrity) |
| `check-knowledge-map.ts` | `KNOWLEDGE-MAP.md` ratchet — repo translation layer stays in step | — | **meta** (KB integrity) |
| `check-uplift-visual.ts` | Caller Insights visual regression | — | **meta** (test) |
| [`check-webhook-signature.ts`](#guard-check-webhook-signature) | Voice-provider `verifyInboundRequest` may not be a no-op `return null` stub — every webhook verifier must do real work | HF-C/HF-K / 2026-06-11 | **a** |
| [`check-guard-tests-not-quarantined.ts`](#guard-check-guard-tests-not-quarantined) | A named registry of security / data-integrity guard tests may never be quarantined in `vitest.config.ts` or deleted | HF-E / 2026-06-11 | **meta** |
| [`check-tsc-protected-files.ts`](#guard-check-tsc-protected-files) | A hand-picked set of guard-bearing files must have ZERO tsc errors, independent of the global `tsc_errors` ratchet baseline | HF-G / 2026-06-11 | **meta** |
| [`check-knip-ratchet.ts`](#guard-check-knip-ratchet) | Dead-code ratchet — unused exports+types (`knip`) may only drop, never rise. Turns the informational `knip:ci` step into a blocking gate via `kb:check` | HF-H / 2026-06-11 | **meta** |
| `cleanup-agent-worktrees.sh` | GC of agent-spawned worktrees whose PR is MERGED or CLOSED. Operator script; nudge surfaced in SessionStart hook when count > 6. | — | **meta** (process hygiene) |

<a id="guard-check-knip-ratchet"></a>
**`check-knip-ratchet.ts`** · class **meta** · born HF-H / 2026-06-11 ·
[script source](../../apps/admin/scripts/capture/check-knip-ratchet.ts) · baseline `knip_unused` in `.ratchet.json` · wired into `npm run kb:check`

`knip` (dead-code detector) was configured and ran in CI, but only as `continue-on-error:
true` — so dead code accumulated unchecked (audit HF-H found 161 unused exports+types). This
turns it into a monotonic ratchet: the count of unused EXPORTS + TYPES (the source-only
dead-code signal; dependency/unlisted findings excluded as env-noisy) may only DROP. Baseline
161 at landing. Because `kb:check` is a blocking CI step, this is now a real gate — delete dead
code to lower it, lock the win. **Survives hardening:** "dead code only shrinks" is a
methodology fitness function (legibility ← the whole point of the KB program).

<a id="guard-check-tsc-protected-files"></a>
**`check-tsc-protected-files.ts`** · class **meta** · born HF-G / 2026-06-11 ·
[script source](../../apps/admin/scripts/capture/check-tsc-protected-files.ts) · wired into `npm run kb:check`

The global `tsc_errors` ratchet (`.ratchet.json`, 190) only stops the count *rising* — it
carries a large baseline, and a real bug hid inside it: `ContractRegistry.get(...)` (a
nonexistent method → TS2339) was swallowed by a try/catch so tuned `SKILL_MEASURE_V1` config
silently never loaded (audit HF-A). This guard adds a tighter ring: a hand-picked set of
guard-bearing files (`lib/contracts/registry.ts`, `lib/goals/track-progress.ts`,
`lib/pipeline/aggregate-runner.ts`, `lib/curriculum/resolve-module.ts`,
`lib/voice/{create,end}-session.ts`, `lib/learner-scope.ts`, the two webhook verifiers) MUST
have ZERO tsc errors regardless of the global baseline. A new type error in any of them fails
CI immediately. As the 190 burns down, migrate more files in — the list only grows.
**Survives hardening:** "guard code must type-check" is a methodology fitness function.

<a id="guard-check-guard-tests-not-quarantined"></a>
**`check-guard-tests-not-quarantined.ts`** · class **meta** · born HF-E / 2026-06-11 ·
[script source](../../apps/admin/scripts/capture/check-guard-tests-not-quarantined.ts) · wired into `npm run kb:check`

The audit's central finding: `tests/lib/route-auth-coverage.test.ts` — a security gate — was
quarantined in `vitest.config.ts` alongside ~30 ordinary flaky tests, and the
`quarantined_tests` ratchet counted it identically, so nothing signalled that an auth gate had
gone dark. This sentinel holds a named registry of GUARD tests (auth-coverage, page-auth,
factual-grounding, learner-scope, validate-manifest, create/end-session, resolve-module,
disclosure-store, retell-auth, skill-tier-mapping) and fails CI if any of them is (a) absent
from disk or (b) present in the vitest exclude block. Retiring a guard test becomes an explicit,
reviewable edit here — never a silent line in the exclude list. **Survives hardening:** "the
guards that guard the system must themselves always run" is a methodology fitness function.

<a id="guard-check-webhook-signature"></a>
**`check-webhook-signature.ts`** · class **a** · born HF-C/HF-K / 2026-06-11 ·
[script source](../../apps/admin/scripts/capture/check-webhook-signature.ts) · wired into `npm run kb:check`

The Retell provider shipped a `verifyInboundRequest` that returned `null` unconditionally
(#1079 follow-up debt) — every inbound Retell webhook was trusted WITHOUT signature
verification, a spoofable end-of-call / transcript injection surface. HF-C implemented the
real `x-retell-signature` HMAC check (`lib/voice/providers/retell/auth.ts`); this guard
makes the regression structurally impossible. It brace-matches each
`lib/voice/providers/*/index.ts` `verifyInboundRequest` body, strips comments + `void x;`
no-ops, and fails if what remains is an empty body or a bare `return null`. A compliant impl
delegates to a `verify*` helper or computes an HMAC inline; the "pass-through when no secret
is configured" early return lives INSIDE that helper (dev ergonomics), not in the provider
method. **Survives hardening:** "no unverified webhook ingress" is an architecture-independent
data-safety invariant.

## Runtime guards & contracts

| Location | Prevents / asserts | Class |
|---|---|---|
| `lib/contracts/registry.ts` (+ `types.ts`) | DB-backed `DataContract` registry (30s TTL) — producer/consumer shape agreement | **a** |
| `lib/prompt/composition/compose-invariants.ts` | Runtime COMPOSE-stage invariants | **a** |
| `.claude/rules/ai-to-db-guard.md` catalogue | ~15 AI-to-DB structural guards (validate-then-write) | **a** (see `invariants.md`) |
| `.claude/rules/response-redaction.md` + `lib/rbac/visibility.ts` + `lib/rbac/policies/<resource>.ts` | Role-tiered field-level redaction at route boundary — `redacted` / `full` / `diagnostic` tiers; whitelist-default-safe. First wired on `/api/callers/[callerId]/adaptations` (Wave C3b — #1577 visibility-policy revision). | **a** |

## Plan-guard agents — `.claude/agents/`

| Agent | Gate | Class |
|---|---|---|
| `guard-checker` | 15 plan guards | **meta** |
| `arch-checker` | SpecRole taxonomy, entity hierarchy, holographic contracts | **meta** |
| `api-doc-checker` | every route has `@api` JSDoc; public/internal boundary | **meta** |
| `migration-checker` | destructive-migration / data-migration review before `migrate dev` | **meta** |
| `seed-checker` | spec JSON ↔ schema consistency | **meta** |
| `standards-checker` | tests/UI/CSS/auth/quality scorecard | **meta** |

## Process guards — `.githooks/` + `scripts/check-*` (chase-prevention)

> Class **meta** — fitness functions that catch *process* anti-patterns at the
> commit / push boundary. See [methodology ADR](../decisions/2026-06-11-chase-prevention-methodology.md)
> for the AP-1..AP-5 framework these enforce.

| Hook / Script | Catches anti-pattern | Bypass |
|---|---|---|
| [`scripts/check-fix-chain.sh`](../../scripts/check-fix-chain.sh) (post-commit + ratchet) | **AP-2 fix-chain** — ≥3 `fix:` commits on same `#issue`. Ratchet metric: `same_issue_fix_chain_max`. | (warn-only; ratchet enforces) |
| [`scripts/check-reciprocal-edit.sh`](../../scripts/check-reciprocal-edit.sh) (pre-push) | **AP-1 reciprocal-edit** — commit N+1 undoes ≥50% of commit N. | `ALLOW_RECIPROCAL_EDIT=1 git push` (document intent in body) |
| [`scripts/gh-pr-create.sh`](../../scripts/gh-pr-create.sh) (wrapper around `gh pr create`) | **AP-4 verify-before-fix** — PR body without `## Verified by` section + DB query / test name / log / Playwright trace evidence. | `--no-verify-section` flag (warn-only) |
| [`scripts/check-fix-refactor-inversion.ts`](../../scripts/check-fix-refactor-inversion.ts) (PR comment, warn-only) | **AP-5 fix-before-refactor** — `fix:` commit on a file later cleanly refactored on the same branch. | none — report only |
| [`.claude/rules/agent-report-verification.md`](../../.claude/rules/agent-report-verification.md) (orchestrator discipline) | **Agent-report negatives** — sub-agent brief asserts "X doesn't exist" / "no callers" / "dead code" without an inverse-probe corroboration. | label `[unverified]` when not consequential |

<a id="guard-fix-chain"></a>
**`check-fix-chain.sh`** · class **meta** · born 2026-06-11 ·
[script source](../../scripts/check-fix-chain.sh) ·
ADR → [chase-prevention methodology](../decisions/2026-06-11-chase-prevention-methodology.md)

Scans the last 30 days of commits on the current branch; for each `fix:` /
`fix(scope):` commit, extracts the `#NNNN` token(s) from subject + body and
groups by issue. Issues with ≥3 commits print a warning urging the
`root-cause` agent before the next fix on the topic. Max-chain-length is also
emitted as a ratchet metric (`same_issue_fix_chain_max`) so the count only
ever ratchets down. **Survives hardening:** AP-2 is a methodology fitness
function — architecture-independent.

<a id="guard-reciprocal-edit"></a>
**`check-reciprocal-edit.sh`** · class **meta** · born 2026-06-11 ·
[script source](../../scripts/check-reciprocal-edit.sh) ·
ADR → [chase-prevention methodology](../decisions/2026-06-11-chase-prevention-methodology.md)

For commit N+1 vs commit N: compares added vs removed lines (and vice versa);
if ≥50% identical, flags reciprocal edit and exits 1. Wired as `pre-push`.
Bypass requires `ALLOW_RECIPROCAL_EDIT=1` *and* a documented intent in the
commit body (signed off as a deliberate revert). Verified live against the
#1365 → #1366 transcript-parser revert (`vapi-provider.parse-transcript.test.ts`
re-introduces 25/34 removed lines, 73%). **Survives hardening:** AP-1 is a
methodology fitness function — architecture-independent.

<a id="guard-verify-before-fix"></a>
**`gh-pr-create.sh`** · class **meta** · born 2026-06-11 (#1406) · extended 2026-06-12 (#1534) ·
[script source](../../scripts/gh-pr-create.sh) ·
rule → [.claude/rules/verify-before-fix.md](../../.claude/rules/verify-before-fix.md) ·
memory → [feedback_verify_before_fix_misread_2026_06_09.md](../../../.claude/projects/-Users-paulwander-projects-HF/memory/feedback_verify_before_fix_misread_2026_06_09.md)

Wraps `gh pr create`; requires a `## Verified by` section in the PR body
containing at least one concrete evidence form (SQL query result, vitest
name, Playwright trace path, or log subject line). Enforces the #1406 lesson
(don't trust screenshot OCR — cite an underlying check).

**Extended scope (#1534, 2026-06-12):** the rule covers BOTH fix PRs AND
conditional story activation. A story opened because a canary FAILed, an
audit probe returned a finding, or an automated check flipped red is a fix
trigger — the activation PR body MUST carry a live citation (SQL query,
log subject, curl probe), not only a test output. Test outputs may reflect
timeouts, fixture gaps, or mocking artifacts (the #1515 / #1525 / #1527 /
#1528 chain — G9 CallerMemory zero-writes was a 10s-timeout fixture
artifact, not a real failure; live SQL closed the activation in under a
minute). The script gate covers PR body content; the activation-side
discipline is convention-only today. **Survives hardening:** AP-4 is a
methodology fitness function — architecture-independent.

<a id="guard-fix-refactor-inversion"></a>
**`check-fix-refactor-inversion.ts`** · class **meta** · born 2026-06-11 ·
[script source](../../scripts/check-fix-refactor-inversion.ts)

Warn-only. Scans the current branch's commit history; for each `fix:` commit,
checks whether a later `feat:`/`refactor:` commit on the same branch
substantially overlaps the same files. If yes, the `fix:` was a band-aid the
structural cleanup would have eliminated. Reports as a PR comment, never
blocks. **Survives hardening:** AP-5 fitness function — architecture-independent.

<a id="guard-agent-report-verification"></a>
**`agent-report-verification.md`** · class **meta** · born 2026-06-15 ·
[rule source](../../.claude/rules/agent-report-verification.md) ·
ADR → [agent-report verification](../decisions/2026-06-15-agent-report-verification.md)

Rule-based (no script today). Orchestrator-side discipline applied when a
sub-agent (any type in [`.claude/agents/`](../../.claude/agents/)) returns a
brief containing claims of the *absence* form — "X doesn't exist", "Y has no
callers", "Z is dead code", "no test pins this". For each consequential
negative claim, the orchestrator either runs an inverse probe (name-form,
directory, schema-aware, dynamic-dispatch, single-tree, test-namespace — see
the rule's taxonomy) in the same turn before relaying, or labels the claim
`[unverified]` to the user. Spawned-agent prompts must instruct the agent to
run its own inverse probe before asserting a negative.

The 2026-06-15 fingerprint: a four-agent parallel audit returned 8 specific
claims; 6 were wrong, all unverified negatives that failed because the agent
searched one name form and missed the actual form (`reuse-path.ts` →
`_reuse-path.ts`; `Call.loScoresJson` → `CallerModuleProgress.loScoresJson`;
direct join table → `BehaviorTarget.skillRef` provenance chain).

**Survives hardening:** the rule covers AI-orchestrator discipline —
architecture-independent. When a `PostAgentResult` hook surface lands in the
harness, the rule's probe-then-relay pattern is the natural enforcement
target; until then the rule stays valid as convention.

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

> _TODO: catalogue `scripts/audit-*.ts` not yet listed._
