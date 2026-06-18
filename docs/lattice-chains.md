# Lattice Chains Inventory

> **Read this before claiming a new producer↔consumer Lattice gap.** This
> file enumerates every producer↔consumer chain in HF and marks each
> PROTECTED (structural gate exists) / PARTIAL (gate covers some but not
> all paths) / GAP (convention only or no enforcement).
>
> Maintained by-hand. When you ship a new structural gate, add the row.
> When you find a gap, file it as a Coverage-pillar follow-on PR using
> the generic enumerate→classify→ratchet pattern (template at
> [`tests/lib/journey/registry-consumer-coverage.test.ts`](../apps/admin/tests/lib/journey/registry-consumer-coverage.test.ts)).
>
> **Filed:** 2026-06-17 after a comprehensive end-to-end audit surfaced
> 4 HIGH-severity gaps. Born of operator frustration with reactive,
> ad-hoc gap discovery. This doc closes that loop.

## Why this exists

The Lattice has 5 pillars (Chain Contracts × Guards × Cascade × Rules ×
Coverage). The pillars are well-understood; what was missing was an
INVENTORY of which CHAINS each pillar protects vs leaves bare. Without
the inventory, audits kept re-discovering gaps reactively.

The pattern is well-known in industry — it goes by many names:
**consumer-driven contract testing** (Pact), **schema-driven validation**
(OpenAPI), **compile-time exhaustiveness** (TS `satisfies`, Rust `match`),
**architecture fitness functions** (Ford et al., *Building Evolutionary
Architectures*). The 6 Coverage vitests shipped between #1738 and #1856
are HF's local implementation of architecture fitness functions. This
doc names the framework.

## How to read the matrix

| Column | Meaning |
|---|---|
| Chain | Plain-English producer→consumer statement |
| Producer | Where the data / declaration originates |
| Consumer | Where the data / declaration is read or dispatched |
| Status | ✅ PROTECTED / ⚠️ PARTIAL / ❌ GAP |
| Gate | File path of the structural enforcement (test / ESLint rule / script) |
| Severity (if gap) | HIGH (educator-visible bug or correctness issue) / MED (silent functional regression) / LOW (cosmetic / engineer-only) |
| Notes | Caveats, known gaps within a PARTIAL row, etc. |

## How to add a new chain

When you introduce a new chain (a new registry, a new spec format, a new
producer↔consumer pair), add a row here in the SAME PR that introduces
the chain. Mark `Status: ❌ GAP` initially and file a follow-on PR
shipping the structural gate using the template.

## How to fix a gap

Three structural patterns, in order of preference:

1. **Coverage vitest** — enumerate producers, classify each consumer
   pairing as `compliant` / `exempt` / `gap`, ratchet the exempt count.
   Template:
   [`tests/lib/journey/registry-consumer-coverage.test.ts`](../apps/admin/tests/lib/journey/registry-consumer-coverage.test.ts).
2. **ESLint rule** — when the violation is at edit time and AST-detectable.
   Template:
   [`eslint-rules/no-bucketless-journey-setting.mjs`](../apps/admin/eslint-rules/no-bucketless-journey-setting.mjs).
3. **CI script** — when the check is shell-runnable (path conventions,
   migration pairing). Template:
   [`scripts/check-schema-has-migration.sh`](../scripts/check-schema-has-migration.sh).

## The matrix

### Configuration / settings

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| PlaybookConfig schema fields → JOURNEY_SETTINGS coverage | `lib/types/json-fields.ts::PlaybookConfig` | `lib/journey/setting-contracts.entries.ts` | ✅ PROTECTED | `tests/lib/journey/registry-schema-coverage.test.ts` (#1738) | — | Exempt list with ratchet |
| Schema `@bucket` JSDoc → contract `menuGroupKey` | `lib/types/json-fields.ts` JSDoc | `JourneySettingContract.menuGroupKey` | ✅ PROTECTED | `eslint-rules/no-bucketless-journey-setting.mjs` (#1738) | — | Edit-time block |
| Registry contract options → schema literal sets | `JOURNEY_SETTINGS[].options[].value` | `lib/types/json-fields.ts` literal unions + `lib/banding/presets.ts::TIER_PRESETS` | ✅ PROTECTED | `tests/lib/journey/registry-options-coverage.test.ts` (Lane 4) | — | 4 vitests, canonical derivation for `tierPresetId` |
| Registry `storagePath` → transform reader | `JOURNEY_SETTINGS[].storagePath` | `lib/prompt/composition/transforms/**/*.ts` | ✅ PROTECTED | `tests/lib/journey/registry-consumer-coverage.test.ts` (#1849) | — | Exempt list (15 entries) with ratchet |
| Registry `composeImpact.sections` → ComposeSectionKey | `JOURNEY_SETTINGS[].composeImpact.sections` | `lib/compose/section.ts::ComposeSectionKey` | ✅ PROTECTED | `tests/lib/journey/registry-completeness.test.ts` item (3) | — | TypeScript `satisfies` + test pin |
| Registry `composeImpact.kinds` → UI consumer | `JOURNEY_SETTINGS[].composeImpact.kinds` | (no consumer today) | ❌ GAP | — | LOW | Pure metadata. Documented intent ("icon + colour + ordering") never built. Drop the field or build the UI. |
| Registry `previewLocators` → Preview lens highlight | `JOURNEY_SETTINGS[].previewLocators` | `components/journey-tab/PreviewLocatorHint.tsx:79-81` | ✅ PROTECTED | Runtime consumer + `tests/components/journey-tab/*.test.tsx` | — | — |
| Registry `autoEnableLinks` → PATCH route enforcement | `JOURNEY_SETTINGS[].autoEnableLinks` | `app/api/courses/[courseId]/journey-setting/route.ts:181-189` | ✅ PROTECTED | Runtime consumer + completeness test pins `targetId` resolves | — | Enforced in same `$transaction` per `lattice-survey.md` |
| Registry `composeImpact.requiresReprompt` → staleness bridge | `JOURNEY_SETTINGS[].composeImpact.requiresReprompt` | `lib/journey/section-staleness-bridge.ts:60` | ✅ PROTECTED | `tests/lib/journey/section-staleness-bridge.test.ts` | — | — |
| Voice settings registry → educator UI surface | `lib/settings/voice-setting-contracts.ts::VOICE_SETTINGS` (11 entries) | `components/voice/VoiceConfigSection.tsx` (inline-renders 3) + `components/journey-tab/CommandPalette.tsx` (auto-discovers all 11 via `...VOICE_SETTINGS` spread) | ✅ PROTECTED | `apps/admin/tests/lib/settings/voice-settings-render-coverage.test.ts` (6 vitests: gap-check, ratchet at 8 exempt, non-empty reason, non-stale, CommandPalette-spread pin, no-contradiction) | — | Live finding 2026-06-17: VoiceConfigSection uses hardcoded `keys: [...]` arrays — only `voiceProvider`/`voiceId`/`backgroundSound` inline-rendered. The other 8 reachable only via Cmd+K spread. Test pins both paths so removing the spread (regression) OR deleting an inline render fires CI. |
| Parameter rows → AgentTuner UI | `prisma.parameter.findMany()` at `lib/agent-tuner/params.ts:37` | `components/sim/tuner/**/*.tsx` | ⚠️ PARTIAL | Runtime (auto-discover) | LOW | No test pins that all params render; runtime self-corrects on next page load. |
| Parameter rows → JOURNEY_SETTINGS LH-menu exposure | `behavior-parameters.registry.json` | `JourneySettingContract` entries targeting `behaviorTargets[<paramId>]` | ❌ GAP | — | MED | New parameter doesn't auto-appear in Journey Inspector LH menu. Convention only. Per-param `JourneySettingContract` filing needed. |
| Parameter rows → AnalysisSpec.config.parameters[].id soft-FK | `behavior-parameters.registry.json::parameterId` | `AnalysisSpec.config.parameters[].id` (JSON field — read at `lib/goals/strategies/resolve-strategy.ts:76`) | ✅ PROTECTED | `apps/admin/scripts/check-fk-consistency.ts` Query 11 (`analysis-spec-config-dangling-parameter-ref`, 2026-06-17) | — | SQL check via `jsonb_array_elements` + LEFT JOIN. Surfaces dangling `(specSlug, configParameterId)` pairs. Wrapped in try/catch so dev SQLite path tolerates JSON-syntax differences. |
| Parameter rows → runtime consumer (compose/score/cascade) | `behavior-parameters.registry.json` | concat of `lib/prompt/composition/**` + `lib/pipeline/**` + `lib/cascade/resolvers/**` + others | ✅ PROTECTED | `tests/lib/measurement/parameter-coverage.test.ts` (#1856) | — | Exempt list (118 entries) with ratchet |

### Pipeline

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| AnalysisSpec.outputType → stage runner dispatch | `AnalysisSpec.outputType` | `lib/pipeline/specs-loader.ts::getSpecsByOutputType()` + `route.ts::stageExecutors` | ❌ GAP | — | HIGH | Convention-only enum dispatch. Missing/typo outputType causes silent fallback. Needs TS enum constant + ESLint guard. |
| AnalysisSpec slug → DB seed entry | `lib/config.ts::config.specs.*` | `prisma.analysisSpec.findUnique({where: {slug}})` | ⚠️ PARTIAL | Read-time error logs missing slug | MED | No CI test catches missing slug pre-deploy. |
| Pipeline stage→stage data flow (EXTRACT → SCORE_AGENT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE) | per-stage writer | next-stage reader | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Links 1–6 + per-stage test files | — | Comprehensive. Every link documented with producer / consumer / invariant / test. Link 4 (CALL→TRANSCRIPT→SCORE) and Link 5 (SCORE→AGGREGATE→ADAPT) particularly load-bearing. |
| Pipeline SCORE_AGENT → CallScore writer | `lib/pipeline/score-agent.ts` | `lib/pipeline/write-call-score.ts` | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Link 4 + `tests/lib/pipeline/*.test.ts` | — | — |
| Pipeline AGGREGATE → CallerAttribute writer (`lo_mastery:` key form) | `lib/curriculum/track-progress.ts` | reader at `lib/prompt/composition/transforms/modules.ts:702` | ✅ PROTECTED | `eslint-rules/no-bare-strategy-key.mjs` (#1599) + `tests/lib/mastery-roundtrip.test.ts` (#1599) | — | Canonical slug-form enforced |
| Pipeline ADAPT decision → COMPOSE recompose | ADAPT output (next module + targets) | COMPOSE stage runner | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Link 6 + `bump-timestamp.ts` enforcement | — | Pipeline COMPOSE carve-out: runs unconditionally at end |
| Pipeline-stage CompositeAffectingPlaybookConfigKey writers → bump-timestamp | per-table writer | `lib/compose/bump-timestamp.ts::bumpPlaybookComposeTimestamp` | ✅ PROTECTED | Per-table ESLint rules (#1268) + 4-route adoption discipline | — | `hf-playbook/no-direct-config-write` etc. |

### Compose

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Transform output key → renderPromptSummary | `lib/prompt/composition/transforms/**/*.ts::directive` field | `lib/prompt/composition/renderPromptSummary.ts` push block | ✅ PROTECTED | `eslint-rules/composition-directive-needs-renderer.mjs` (#1848) + `tests/lib/prompt/composition/coverage-producer-consumer.test.ts` (#1848) | — | 5-layer guard: PAIRS manifest + sweep + ESLint sentinel + rule + memory |
| ComposeSectionKey → staleness inputs map | `lib/compose/section.ts::COMPOSE_SECTION_KEYS` | `lib/compose/section-staleness.ts::PIPELINE_STATE_SECTION_LOADERS` | ✅ PROTECTED | TypeScript `satisfies const readonly ComposeSectionKey[]` + `tests/lib/compose/section-loaders.test.ts:23` | — | Compile-time exhaustiveness |
| ComposeSectionKey → SECTION_OUTPUT_KEYS map | `COMPOSE_SECTION_KEYS` | `SECTION_OUTPUT_KEYS` | ✅ PROTECTED | Same `satisfies` + section-loaders test | — | Compile-time + test |
| COMP-001 spec sections ↔ `getDefaultSections()` code | `docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json` | `lib/compose/section.ts::getDefaultSections` | ⚠️ PARTIAL | `tests/lib/prompt/composition/seed-sync.test.ts` (existing) | MED | Test catches code-vs-spec divergence at fixture time; doesn't re-pin post-spec-JSON-update. |
| Transform behavior-target neutral fallback | `lib/measurement/neutral-target.ts::NEUTRAL_PARAMETER_TARGET` | composition transforms (`quickstart.ts`, `identity.ts`) | ✅ PROTECTED | `tests/lib/measurement/neutral-target.test.ts` (#1880) | — | Named const replaces bare `?? 0.5`; ratchet rejects new offenders in `lib/prompt/composition/transforms/`. |
| `PlaybookCurriculumRole` enum adoption | `@prisma/client::PlaybookCurriculumRole` | 38 consumers under `apps/admin/{app,lib,scripts}` | ✅ PROTECTED | `tests/lib/playbook-curriculum-role-adoption.test.ts` | — | Ratchet rejects bare `role: "primary"` / `role: "linked"` literals across app, lib, scripts. |
| `MemoryCategory` enum adoption | `@prisma/client::MemoryCategory` | `lib/chat/commands.ts` + `differentiation/route.ts` | ✅ PROTECTED | `tests/lib/memory-category-adoption.test.ts` | — | Ratchet rejects 6-permutation literal reconstructions. |
| RBAC role-level adoption (no magic role arrays) | `lib/roles.ts` (`ROLE_LEVEL` + `isRoleAtOrAbove` + `rolesAtOrAbove` + `isOperatorTrackAdmin`) | 4 sites: `ViewModeContext`, `dashboard-config`, `dashboard/route`, `system-ini` | ✅ PROTECTED | `tests/lib/roles.test.ts` | — | Ratchet rejects new `["SUPERADMIN","ADMIN","OPERATOR"]` triplet literals in `app`/`lib`/`contexts`. EDUCATOR exclusion documented (track distinction, not level). |
| `TEACHING_CALLER_ROLES` (CallerRole subset) | `lib/caller-roles.ts` (`TEACHING_CALLER_ROLES` + `isTeachingCallerRole`) | 3 routes: `classroom`, `cohorts`, `ensure-cohort` | ✅ PROTECTED | `tests/lib/teaching-caller-roles.test.ts` | — | Ratchet rejects bare `["TEACHER","TUTOR"]` literals and `role === "TEACHER" \|\| role === "TUTOR"` chains. |
| `DEFAULT_VOICE_PROVIDER_SLUG` | `lib/voice/default-provider.ts` | `load-voice-config.ts:48` + `poll-stale-calls.ts:112` | ✅ PROTECTED | `tests/lib/voice/default-provider.test.ts` | — | Ratchet rejects `?? "vapi"` fallbacks under `lib/voice/` outside the provider's own identity files. |

### Cascade

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Cascade family registration → `useEffectiveValue` dispatch | `lib/cascade/effective-value.ts::FAMILIES` | `lib/cascade/use-effective-value.ts` | ✅ PROTECTED | `tests/lib/cascade/use-effective-value.test.tsx` | — | Pre-filter on `isResolvableKnob` shipped 2026-06-17 |
| Cascade family ↔ resolver function existence | `FAMILIES[].resolve` | `lib/cascade/resolvers/<family>.ts` | ✅ PROTECTED | TypeScript signature match + resolver-level vitest | — | — |
| Cascade-eligible UI surface → `<CascadeValue>` + `<LayerBadge>` | UI render | hook return | ⚠️ PARTIAL | `.claude/rules/cascade-reuse.md` convention | MED | Rule explicitly states "No ESLint rule today — too many false positives". 1 known violation auto-paired with `CascadeTraceBreadcrumb` downstream. |
| AI call-point → Playbook/Domain `aiOverrides[callPoint]` cascade | `getConfiguredMeteredAICompletion({ callPoint, scope })` callsite | `lib/ai/config-loader.ts::getAIConfig` → 6-layer resolver | ✅ PROTECTED | `.claude/rules/ai-callpoint-cascade.md` + `tests/lib/ai/config-loader-cascade.test.ts` (11 cases, #1868) + `eslint-rules/require-ai-scope-in-cascade-zone.mjs` (12 cases, zone-scoped — pipeline/chat/voice routes) + `tests/lib/ai/callpoint-scope-coverage.test.ts` (3 cases — codebase-wide orphan ratchet starts at 73) | — | Resolver + cascade-order test + zone-scoped ESLint rule + Coverage vitest with ratchet. Per-callsite gap closed. |

### RBAC / API

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Write-route → `requireAuth` + Zod | `app/api/**/route.ts` POST/PUT/PATCH/DELETE | runtime auth/validation | ⚠️ PARTIAL | `tests/api/route-auth-zod-coverage.test.ts` (#1854) — 320 ratchet | HIGH (incumbent) | 32/313 compliant (~10%). Ratchet locks population, prevents new drift. |
| Tier-sensitive route → `redact<X>ForTier` | named in `TIER_SENSITIVE_ROUTES` | `lib/rbac/policies/<resource>.ts::redact<X>ForTier` | ⚠️ PARTIAL | `tests/api/tier-visibility-coverage.test.ts` (#1855) + `eslint-rules/require-tiered-redactor.mjs` (Wave C5 #1685) | HIGH (5 known leaks) | Exempt list with 5 entries; each ships a follow-on PR dropping the ratchet by 1. |
| STUDENT-scope `?callerId=` param → scope guard | route handler | `lib/learner-scope.ts::resolveCallerScopeForReading` | ⚠️ PARTIAL | `tests/lib/learner-scope.test.ts` (9 vitests, #977) | MED | Helper exists + wired into 3 routes today. No coverage gate ensures new routes adopt it. |
| Entity-access RBAC matrix → `requireEntityAccess` enforcement | `lib/access-control/entity-access.ts::ENTITY_ACCESS_V1` | `app/api/**/route.ts` calls | ✅ PROTECTED | 22 routes wired; gate is RBAC matrix + per-route check | — | Verified 2026-06-17. |
| `@tieredVisibility` JSDoc opt-in → redactor enforcement | route header tag | `eslint-rules/require-tiered-redactor.mjs` | ✅ PROTECTED | ESLint rule + KB doc | — | Opt-in by design |

### Voice / cue

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| VAPI tool definition → handler implementation | `lib/voice/load-tool-definitions.ts` | `lib/voice/tool-router.ts::routeToolCall` | ✅ PROTECTED | `tests/lib/voice/tool-router.test.ts` | — | End-to-end test pins definition↔handler pairing |
| VAPI webhook subject → handler dispatch | webhook body `subject` field | `lib/voice/vapi-webhook.ts` handler switch | ❌ GAP | — | HIGH | No allowlist constant; unknown subject silently no-ops |
| Cue scheduler tick → `CueScheduleEntry` persistence | `lib/voice/cue-scheduler.ts` | `prisma.cueScheduleEntry` (model exists) | ✅ PROTECTED | Runtime + `tests/lib/voice/cue-scheduler.test.ts` | — | `CueScheduleEntry` has `scheduledFor` + `firedAt` + `status` |
| Stall detector event → server persistence | `hooks/use-stall-detector.ts` | (no server-side persistence today) | ❌ GAP | — | MED | Client-only. Needed before `BEH-STALL-RECOVERY-MS` can ship (epic #1860) |
| `Session.voiceConfigSnapshot` → reproducibility consumer | `lib/voice/create-session.ts` snapshot at session-start | (forensics + reproducibility — no automated consumer) | ⚠️ PARTIAL | Schema field + create-session test pins write | LOW | Snapshot stored; no test that it enables replay |
| `Session.sequenceNumber` → call ordering | atomic upsert at `CallerSequenceCounter` | pipeline + reads | ✅ PROTECTED | `ai-to-db-guard.md` (createSession atomic increment) + `apps/admin/tests/lib/voice/create-session.test.ts` | — | Postgres row-level lock serialises concurrent webhooks |
| Session.kind → `skipStages` pipeline gate | `lib/voice/session-rules.ts::deriveSkipStages` (switch + never exhaustiveness) | `lib/pipeline/run-spec-driven.ts` | ✅ PROTECTED | `apps/admin/tests/lib/voice/session-kind-exhaustiveness.test.ts` (5 vitests: kind enumeration + per-kind skip pin + outcome override pin + initialCounterFlags exhaustiveness pin) + TS `never` compile-time check | — | 2026-06-17: refactored `deriveSkipStages` from `if (kind === ... \|\| kind === ...)` to `switch + never`. Behaviour-preserving (TEXT_CHAT/VOICE_CALL/SIM_CALL still no kind-level skips). Test pins the kind→skip-list mapping byte-identical with the original behaviour. |

### Schema / migration

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Prisma schema change → migration file | `prisma/schema.prisma` diff | `prisma/migrations/**/migration.sql` | ✅ PROTECTED | `scripts/check-schema-has-migration.sh` (CI) | — | Shell script blocks schema changes without migration |
| Migration → seed compatibility | migration SQL | `prisma/seed*.ts` | ❌ GAP | — | MED | No CI test runs seed post-migration. Manual verification only. |
| Prisma model → typed Prisma client | `prisma/schema.prisma` | `node_modules/@prisma/client` | ✅ PROTECTED | `prisma generate` (CI) | — | Auto-generated types; mismatch = TS error |

### Curriculum / progress

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| AuthoredModule.prerequisites → unlock gate | `Playbook.config.modules[].prerequisites` | `lib/curriculum/check-module-unlock.ts::isModuleUnlocked` | ✅ PROTECTED | `tests/lib/curriculum/check-module-unlock.test.ts` (#1835) + `prerequisiteSlugs` helper | — | 25 vitests + helper + ESLint shape |
| CurriculumModule write → PlaybookCurriculum primary link | curriculum-writing route | `lib/curriculum/ensure-primary-playbook-link.ts` | ✅ PROTECTED | `ai-to-db-guard.md` row + 3-route adoption (#1202–#1204) | — | Helper in same transaction |
| Curriculum / CurriculumModule / LO write → compose-input bump | educator-driven write | `lib/compose/bump-timestamp.ts::bumpPlaybookComposeTimestamp` | ✅ PROTECTED | `ai-to-db-guard.md` row + 4-route adoption (#1268) | — | Carve-out: pipeline-internal writes don't bump |
| `CallerModuleProgress.incompleteAttempts` writers → single chokepoint | multiple write sites | `lib/curriculum/mark-module-incomplete.ts::markModuleIncomplete` | ✅ PROTECTED | `eslint-rules/no-bare-module-progress-update.mjs` (#1703) + sticky-waiver guard | — | Atomic increment, race-safe |
| `Goal.progressStrategy` → strategy registry | Goal row | `lib/goals/strategies/types.ts::StrategyKey` enum | ✅ PROTECTED | `eslint-rules/no-bare-strategy-key.mjs` (#1599) + `tests/lib/mastery-roundtrip.test.ts` | — | Round-trip pin + enum + ESLint |
| `AuthoredModuleSettings` type ↔ fixture YAML keys | `lib/types/json-fields.ts::AuthoredModuleSettings` | `lib/wizard/__tests__/fixtures/course-reference-ielts-v*.md` | ✅ PROTECTED | `tests/lib/wizard/fixture-type-coverage.test.ts` (#1910) | — | Bidirectional Coverage gate; 5 fixture keys exempt at land time (`prepSilenceSec`, `incompleteThresholdSec`, `scoringCriteria`, `scoreReadoutMode`, `topicPool`) — type additions deferred to follow-on |

### Skills / banding

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Skill spec → tier mapping | course Subject + AnalysisSpec | `lib/banding/derive-skill-tier-mapping-from-source.ts` + `TIER_PRESETS` | ✅ PROTECTED | `tests/lib/journey/registry-options-coverage.test.ts` (tierPresetId row, #1808) (banding-contract test — TODO file path verification) (#1635) | — | Cascade-gated source-derived banding |

### AI safety

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| AI write paths → AI-to-DB validate-then-write | AI tool / pipeline output | per-domain guard helper | ⚠️ PARTIAL | `.claude/rules/ai-to-db-guard.md` catalogue + 14 active guards | MED | 14 structural guards documented; 4 "Known Gaps" explicitly logged (structure-assertions tx, extract-curriculum count cap, parameter FK pre-filter, callerMemory caps). |
| AI read (chat routes) → grounding intercept | DATA/COURSE_MANAGE/BUG/assistant.* | `app/api/chat/factual-grounding-intercept.ts::detectUngroundedLearnerClaim` | ✅ PROTECTED | `tests/api/chat-factual-grounding.test.ts` (40/40) + system-prompt contract | — | Non-streaming branch covered; streaming branches a Known Gap (#1447 Slice A) |
| AI read (streaming chat) → grounding intercept | streaming chat branches | (no intercept on streaming today) | ❌ GAP | — | MED | Known Gap. Tracked at #1447 Slice A. |
| AI read (pipeline EXTRACT/AGGREGATE/REWARD) → grounding intercept | pipeline AI calls | (no structural grounding contract) | ❌ GAP | — | MED | Known Gap. Tracked at #1447 Slice B. Pipeline stage→stage contracts ARE protected (see Pipeline section above); the AI-output grounding subset is what's pending. |

### Convention rules → enforcement

| Rule file | Enforcement | Status |
|---|---|---|
| `ai-to-db-guard.md` | 14 guards + ESLint + tests | ✅ PROTECTED (4 Known Gaps documented) |
| `ai-read-grounding.md` | `factual-grounding-intercept.ts` + system-prompt contracts | ⚠️ PARTIAL (streaming + pipeline gaps) |
| `cascade-reuse.md` | Convention only (rule explicitly states no ESLint) | ⚠️ CONVENTION-ONLY |
| `response-redaction.md` | ESLint `require-tiered-redactor` + `tier-visibility-coverage` (#1855) | ✅ PROTECTED (5 leak ratchet) |
| `verify-before-fix.md` | PR-body gate in `gh-pr-create.sh` (`## Verified by`) | ✅ PROTECTED |
| `agent-report-verification.md` | PR-body gate in `gh-pr-create.sh` (negative-claim probe) | ✅ PROTECTED |
| `ci-docs-parity.md` | `scripts/check-ci-docs-parity.sh` (pre-push warn) | ⚠️ PARTIAL (L3 strict not live) |
| `lattice-survey.md` | Author discipline + `## Verified by` requirement | ✅ PROTECTED via PR-body gate |
| `registry-schema-coverage.md` | `tests/lib/journey/registry-schema-coverage.test.ts` (#1738) | ✅ PROTECTED |
| `registry-consumer-coverage.md` | `tests/lib/journey/registry-consumer-coverage.test.ts` (#1849) | ✅ PROTECTED |
| `route-auth-zod-coverage.md` | `tests/api/route-auth-zod-coverage.test.ts` (#1854) | ✅ PROTECTED |
| `tier-visibility-coverage.md` | `tests/api/tier-visibility-coverage.test.ts` (#1855) | ✅ PROTECTED |
| `parameter-coverage.md` | `tests/lib/measurement/parameter-coverage.test.ts` (#1856) | ✅ PROTECTED |
| `fixture-type-coverage.md` | `tests/lib/wizard/fixture-type-coverage.test.ts` (#1910) | ✅ PROTECTED |
| `privacy-redaction.md` | ESLint `require-tiered-redactor` + `tier-visibility-coverage` (#1855) — same enforcer as `response-redaction.md`; this file is the privacy-specific framing | ✅ PROTECTED (5 leak ratchet, #1922) |
| `data-retention.md` | `lib/privacy/stamp-regulatory-expiry.ts` chokepoint (#1917) + retention cron + `apps/admin/scripts/check-fk-consistency.ts` Query 12 | ✅ PROTECTED (3 voice paths adopted; 8 lower-priority writers adopt as touched) |
| `vm-migration-lock.md` | `scripts/vm-migrate.sh` wrapper + session-start check | ✅ PROTECTED |
| `pipeline-and-prompt.md` | `qmd search` mandate + docs cross-ref | ⚠️ CONVENTION-ONLY |
| `database-patterns.md` | Author discipline | ⚠️ CONVENTION-ONLY |
| `ui-design-system.md` | `arch-checker` + `ui-reviewer` agents | ⚠️ CONVENTION-ONLY |

### Session / learner boundaries

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Pipeline-stage output → learner-facing sanitiser | pipeline output strings | `app/api/student/scheduler-decision` + SCHEDULER_REASONS constant | ✅ PROTECTED | `epic-100-chain-walk.md` Link L1 (2026-05-27) + #923 / PR #924 + tests | — | Regex guard blocks log-prefix strings; read-side sanitizer + stale guard |
| Composed prompt → ComposedPrompt persistence | `lib/prompt/composition/persist.ts` | `Call.usedPromptId` FK + `next call read` | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Link 3 (Session boundary I-CT2 cascade) + atomic create-session helper | — | Most-recent-active ComposedPrompt resolution cascade |

### Privacy / consent (epic #1915)

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| I-PR1 Intake-v2 disclosure delivery atomicity | `app/api/intake/bootstrap/route.ts:115-137` (best-effort today) | `tallyseal_disclosure` rows + audit-bundle reads | ❌ GAP | — | HIGH | Disclosure writes outside the intake-state tx. #1919 lands `opts?: { tx }` adoption when Tallyseal Ask #2 ships. CHAIN-CONTRACTS.md §6a I-PR1. |
| I-PR2 Voice consent before recorded `Call` | `lib/voice/create-session.ts::createSession` | `tallyseal_disclosure` ack for `voice-call-recording` | ❌ GAP | — | HIGH | Copy authored at `lib/intake/copy/voice-call-recording.v0.1.0-rc.1.mdx` only when #1918 lands. Lazy gate, not blocking modal. CHAIN-CONTRACTS.md §6a I-PR2. |
| I-PR3 `Call.regulatoryExpiresAt` stamp at create-time | `createSession` + 4 sibling writers | `POST /api/admin/retention/cleanup` purge WHERE | ❌ GAP | — | HIGH | Migration + stamp + NULL backfill discipline lands in #1917. Column name discipline pins `regulatoryExpiresAt` not `expiresAt` (collision with `CallerMemory.expiresAt`). CHAIN-CONTRACTS.md §6a I-PR3. |
| I-PR4 Compose must not read expired transcript | composition transforms | `ComposedPrompt.prompt` | ❌ GAP | — | MED | Runtime detection deferred to follow-on after retention purging stabilises. Cleanup-cron purged rows are the load-bearing enforcer until then. CHAIN-CONTRACTS.md §6a I-PR4. |
| I-PR5 Caller-scoped PII read → `resolveCallerScopeForReading` | GET routes accepting `?callerId=` + admitting STUDENT+ | Prisma `where` clause | ⚠️ PARTIAL | `tests/lib/learner-scope.test.ts` (#977, 9 cases) | MED | Helper exists + wired into 3 routes. Coverage-pillar gate ensuring new routes adopt is a follow-on. CHAIN-CONTRACTS.md §6a I-PR5. |
| I-PR6 PII erasure cascades via `delete-caller-data.ts` | `DELETE /api/callers/[id]` + admin retention cleanup | 22 cascading tables | ✅ PROTECTED | `lib/gdpr/delete-caller-data.ts` runtime + existing tests | — | ESLint rule blocking `prisma.caller.delete` outside the helper is a Coverage follow-on. CHAIN-CONTRACTS.md §6a I-PR6. |
| I-PR7 Mixed-tier route → `@tieredVisibility` + redactor | `app/api/**/route.ts` returning mixed-tier payload | `eslint-rules/require-tiered-redactor.mjs` + `tests/api/tier-visibility-coverage.test.ts` | ⚠️ PARTIAL | ESLint rule + ratchet at 5 exempt | HIGH (5 known leaks) | Sibling row exists under RBAC / API. Listed here for the privacy cross-cut. #1922 wires the 5 redactors; #1923 adds preset-aware layer. CHAIN-CONTRACTS.md §6a I-PR7. |
| I-PR8 Legacy `/api/join/[token]` retroactive-enforcement carve-out | `app/api/join/[token]/route.ts:185-588` | n/a (declared gap) | INFO | Convention + `ENFORCEMENT_DATE` constant referenced by future enforcers | — | Grandfathered cohort under pre-#1915 contract. Not a violation. CHAIN-CONTRACTS.md §6a I-PR8. |
| I-PR9 Encrypted columns → `lib/crypto/envelope.ts` chokepoint | Any code path writing/reading a column declared encrypted per ADR `docs/decisions/2026-06-13-pii-encryption-scope.md` | `lib/crypto/envelope.ts::encryptColumn` / `decryptColumn` | ⚠️ PARTIAL | `lib/crypto/envelope.ts` chokepoint (#1977) + `lib/config.ts` prod-safety guard + per-column ESLint rules (#1978, #1980 pending) | HIGH (no encrypted columns wired yet) | Privacy II epic #1976. Substrate ships in #1977; first column adoption in #1978 (`VoiceProvider.credentials`). CHAIN-CONTRACTS.md §6a I-PR9. |

## Verified gaps (HIGH-severity to-do)

| Gap | Severity | Effort | Ship plan |
|---|---|---|---|
| ~~Parameter ↔ AnalysisSpec.measurements FK consistency~~ | ~~HIGH~~ | ~~1–2 hr~~ | **SHIPPED** as Query 11 in `apps/admin/scripts/check-fk-consistency.ts` (2026-06-17). The actual soft-FK was in `AnalysisSpec.config.parameters[].id` (JSON), not `measurements` — clarified during the fix. |
| AnalysisSpec.outputType → stage dispatch enum guard | HIGH | 1–2 hr | TS const enum + ESLint rule + ratchet |
| VAPI webhook subject whitelist | HIGH | 1 hr | Allowlist constant + handler guard + test |
| Parameter ↔ JOURNEY_SETTINGS LH-menu exposure | MED | 2 hr | Coverage vitest in #1849 pattern |
| ~~VOICE_SETTINGS ↔ Settings tab render coverage~~ | ~~MED~~ | ~~1 hr~~ | **SHIPPED** 2026-06-17 — `tests/lib/settings/voice-settings-render-coverage.test.ts`. 6 vitests; ratchet at 8 exempt entries (each citing CommandPalette spread). |
| Migration ↔ seed compatibility | MED | 2 hr | CI step running seed after each migration |
| ~~Session.kind ↔ skipStages mapping~~ | ~~MED~~ | ~~1 hr~~ | **SHIPPED** 2026-06-17 — `switch + never` refactor in `lib/voice/session-rules.ts::deriveSkipStages` + 5 pinning vitests in `tests/lib/voice/session-kind-exhaustiveness.test.ts`. |
| Stall detector → server persistence | MED | (epic) | Tracked in #1860 epic Phase 3 |
| `composeImpact.kinds` consumer | LOW | (decide) | Either build the UI or drop the field |

## What this doc does NOT cover

- **Per-row test coverage** — individual unit test mapping per code change. Use `npm run ctl check` for that.
- **Performance gates** — Lattice is about correctness, not performance. Speed is a different fitness function.
- **External API contracts** — VAPI / OpenAI / Anthropic API surfaces are upstream vendor concerns.

## How agents should use this doc

When an Explore / Plan / general-purpose agent is about to claim "there's no Lattice gap here" or "the producer↔consumer pairing is unguarded":

1. **Read this file first.** Find the chain in the matrix above.
2. If the chain is marked PROTECTED — cite the gate file in your finding.
3. If marked PARTIAL — cite the gate + the known-gap detail.
4. If marked GAP — file as a Coverage-pillar follow-on using the
   template (`registry-consumer-coverage.test.ts`).
5. If the chain isn't in this file — add a row in your PR. Don't claim
   absence from the matrix as evidence of absence in the codebase
   without an explicit `grep` confirming no gate exists.

## Related

- [`docs/CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) — pipeline stage→stage invariants (Link 1–6 + CC-* sub-contracts)
- [`docs/epic-100-chain-walk.md`](./epic-100-chain-walk.md) — source walk that catalogued Link contracts (2026-05-22)
- [`docs/CONTRACTS-PLAYBOOK-CURRICULUM.md`](./CONTRACTS-PLAYBOOK-CURRICULUM.md) — Playbook/Curriculum/PlaybookCurriculum surface
- [`docs/kb/guard-registry.md`](./kb/guard-registry.md) — every ESLint guard + every script CI gate catalogued
- [`.claude/rules/lattice-survey.md`](../.claude/rules/lattice-survey.md) — pre-coding survey discipline
- Memory: `feedback_lattice_guard_umbrella.md` — the original 4-pillar Lattice
- Memory: `feedback_lattice_5th_pillar_coverage.md` — Coverage pillar
