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
| `JOURNEY_SETTINGS` arrayKey contracts ↔ journey-setting PATCH `arraySelector` | `JOURNEY_SETTINGS[].storagePath.arrayKey` | `app/api/courses/[courseId]/journey-setting/route.ts` body schema (#1888 P3c) | ✅ PROTECTED | `tests/lib/journey/arraykey-writer-coverage.test.ts` (#1912) | — | Bidirectional gate; 14 arrayKey contracts (5 fixed-selector + 9 runtime-selector); exempt budget 0 at launch |
| Registry `composeImpact.sections` → ComposeSectionKey | `JOURNEY_SETTINGS[].composeImpact.sections` | `lib/compose/section.ts::ComposeSectionKey` | ✅ PROTECTED | `tests/lib/journey/registry-completeness.test.ts` item (3) | — | TypeScript `satisfies` + test pin |
| Registry `composeImpact.kinds` → UI consumer | `JOURNEY_SETTINGS[].composeImpact.kinds` | (no consumer today) | ❌ GAP | — | LOW | Pure metadata. Documented intent ("icon + colour + ordering") never built. Drop the field or build the UI. |
| Registry `previewLocators` → Preview lens highlight | `JOURNEY_SETTINGS[].previewLocators` | `components/journey-tab/PreviewLocatorHint.tsx:79-81` | ✅ PROTECTED | Runtime consumer + `tests/components/journey-tab/*.test.tsx` | — | — |
| Registry `autoEnableLinks` → PATCH route enforcement | `JOURNEY_SETTINGS[].autoEnableLinks` | `app/api/courses/[courseId]/journey-setting/route.ts:181-189` | ✅ PROTECTED | Runtime consumer + completeness test pins `targetId` resolves | — | Enforced in same `$transaction` per `lattice-survey.md` |
| Registry `composeImpact.requiresReprompt` → staleness bridge | `JOURNEY_SETTINGS[].composeImpact.requiresReprompt` | `lib/journey/section-staleness-bridge.ts:60` | ✅ PROTECTED | `tests/lib/journey/section-staleness-bridge.test.ts` | — | — |
| Registry `conflicts[]` → ConflictWarningChip + symmetric reciprocal | `JOURNEY_SETTINGS[].conflicts[].conflictsWithId` | `lib/journey/compute-relevance-state.ts::findActiveConflict` → `components/journey-tab/ConflictWarningChip.tsx` (mounted by `JourneyInspectorPanel.tsx`) | ✅ PROTECTED | `tests/lib/journey/conflict-warnings-coverage.test.ts` (#2105 S3 of epic #2102) + precedence pins in `tests/lib/journey/compute-relevance-state.test.ts` | — | Coverage-pillar extension. Pins symmetric reciprocal declarations + resolution-text floor + ratchet at 6 incumbent edges (3 conflict topics × 2 sides). `conflicted` is LOWEST priority in `RelevanceState` — hard gates always shadow. |
| Voice settings registry → educator UI surface | `lib/settings/voice-setting-contracts.ts::VOICE_SETTINGS` (11 entries) | `components/voice/VoiceConfigSection.tsx` (inline-renders 3) + `components/journey-tab/CommandPalette.tsx` (auto-discovers all 11 via `...VOICE_SETTINGS` spread) | ✅ PROTECTED | `apps/admin/tests/lib/settings/voice-settings-render-coverage.test.ts` (6 vitests: gap-check, ratchet at 8 exempt, non-empty reason, non-stale, CommandPalette-spread pin, no-contradiction) | — | Live finding 2026-06-17: VoiceConfigSection uses hardcoded `keys: [...]` arrays — only `voiceProvider`/`voiceId`/`backgroundSound` inline-rendered. The other 8 reachable only via Cmd+K spread. Test pins both paths so removing the spread (regression) OR deleting an inline render fires CI. |
| Parameter rows → AgentTuner UI | `prisma.parameter.findMany()` at `lib/agent-tuner/params.ts:37` | `components/sim/tuner/**/*.tsx` | ⚠️ PARTIAL | Runtime (auto-discover) | LOW | No test pins that all params render; runtime self-corrects on next page load. |
| Parameter rows → JOURNEY_SETTINGS LH-menu exposure | `behavior-parameters.registry.json` | `JourneySettingContract` entries targeting `behaviorTargets[<paramId>]` | ❌ GAP | — | MED | New parameter doesn't auto-appear in Journey Inspector LH menu. Convention only. Per-param `JourneySettingContract` filing needed. |
| Parameter rows → AnalysisSpec.config.parameters[].id soft-FK | `behavior-parameters.registry.json::parameterId` | `AnalysisSpec.config.parameters[].id` (JSON field — read at `lib/goals/strategies/resolve-strategy.ts:76`) | ✅ PROTECTED | `apps/admin/scripts/check-fk-consistency.ts` Query 11 (`analysis-spec-config-dangling-parameter-ref`, 2026-06-17) | — | SQL check via `jsonb_array_elements` + LEFT JOIN. Surfaces dangling `(specSlug, configParameterId)` pairs. Wrapped in try/catch so dev SQLite path tolerates JSON-syntax differences. |
| Parameter rows → runtime consumer (compose/score/cascade) | `behavior-parameters.registry.json` | concat of `lib/prompt/composition/**` + `lib/pipeline/**` + `lib/cascade/resolvers/**` + others | ✅ PROTECTED | `tests/lib/measurement/parameter-coverage.test.ts` (#1856) | — | Exempt list (118 entries) with ratchet |
| Parameter rows → AnalysisSpec measurement citation (link 7) | `behavior-parameters.registry.json::usage.measurement` | spec.json files under `docs-archive/bdd-specs/` referenced by specSlug | ✅ PROTECTED | `tests/lib/measurement/parameter-measurement-coverage.test.ts` (#1967 M1) | — | Substantive cross-check: cited spec exists AND lists the param. Ratchet caps `deferred-#1967` debt (48 incumbent post-M4). |
| Measured parameter → AGGREGATE/ADAPT consumer (link 8 — loop closure INPUT side) | M1's `measured` set | spec.json `aggregationRules.sourceParameter` / `adaptationRules.sourceParameterId` / `sourceParameterPattern` | ✅ PROTECTED | `tests/lib/measurement/parameter-loop-closure.test.ts` (#1967 M2) | — | Per-param closure walk + ratchet (**0** open loops after BEH-AGG-001 landed 2026-06-19). Defends against silent-gain-zero: CallScore lands but nothing reads it. |
| AGGREGATE output → compose/runtime consumer (link 8 — loop closure OUTPUT side) | AGG spec `targetProfileKey` writes (CallerAttribute) | `lib/prompt/composition/**` + `lib/cascade/**` + `lib/pipeline/**` + others | ✅ PROTECTED | `tests/lib/measurement/aggregate-output-consumer-coverage.test.ts` (#1967 M2 follow-on, 2026-06-19) | — | Per-prefix consumer walk + ratchet (11 incumbent: 9 behavior_profile:* prefixes from BEH-AGG-001 + 2 LEARN-PROF-001 pre-existing). Sibling test to M2 input side: catches AGG specs that WRITE keys nothing READS. |
| Spec-readonly Parameter fields → ESLint mirror | `lib/cascade/spec-readonly-fields.ts::PARAMETER_SPEC_READONLY_FIELDS` | `eslint-rules/no-customer-write-to-canonical-interpretation.mjs::SPEC_READONLY_FIELDS` | ✅ PROTECTED | `tests/lib/cascade/spec-readonly-fields-coverage.test.ts` (#1984 S2) | — | Symmetric set equality + sentinel count. New field requires same-PR update of both sources. |
| Spec-readonly Parameter fields → customer-driven write block | `PARAMETER_SPEC_READONLY_FIELDS` | `prisma.parameter.{create,update,upsert}` payloads outside seed / scripts / /api/x/ / /api/lab/ / migrations / tests | ✅ PROTECTED | `eslint-rules/no-customer-write-to-canonical-interpretation.mjs` (#1984 S1) — error severity | — | 17 RuleTester cases; mitigated wizard + parameters POST in same PR; SUPERADMIN PUT + ADMIN sync allow-listed by suffix. |
| `Parameter.domainGroup` DB ↔ JSON canonical 12-tuple parity | `lib/registry/canonical-domain-group.ts::CANONICAL_DOMAIN_GROUPS` | Live DB `Parameter."domainGroup"` column | ⚠️ PARTIAL | `apps/admin/scripts/check-fk-consistency.ts` Query 13 (`parameter-domain-group-off-canonical`, #2040 S7) + structural pin at `apps/admin/tests/lib/registry/parameter-domain-group-db-parity.test.ts` (#2040 S7) | MED | WARN-only during S3a→S3b→S3c rollout. CI ephemeral DB returns 0 by construction (seeded from canonical JSON); load-bearing run is against hosted DBs via `npm run check:fk`. Drops to error severity after S3b (#2039) clears the 96 sandbox / 145 staging incumbent debt; S3c then lands the Postgres CHECK constraint. Multi-pillar discipline documented in the db-registry-parity rule (#2041 S8 — see PR #2045). |
| Chat-tool wizard enum-bearing inputs → `Playbook.config` enum-typed fields | `lib/chat/wizard-tool-executor/tools/create_course/_{new,reuse}-config-merge.ts` + `lib/chat/admin-tool-handlers.ts::handleUpdatePlaybookConfig` (via `filterEnumBearingUpdates`) | `lib/prompt/composition/transforms/preamble.ts::RETURNING_CALLER_BY_MODE` reader + `lib/content-trust/resolve-config.ts::INTENT_PATTERN_OVERRIDES` + `lib/prompt/composition/transforms/audience.ts` | ✅ PROTECTED | `eslint-rules/no-untyped-enum-write-in-wizard.mjs` (#1995) + `tests/lib/chat/wizard-enum-validation.test.ts` (#1995) + runtime guards (`isTeachingMode` / `isInteractionPattern` / `isAudience` / `isPlanEmphasis` / `isLessonPlanModel` / `isFirstCallMode` / `isProgressionMode`) at `lib/content-trust/resolve-config.ts` (#1995) + canonical SETs at `lib/wizard/enum-sets.ts` (#1995) | — | Five-layer chain-contract closure for the chat-tool merge surface. Live IELTS Speaking Practice incident 2026-06-18: `teachingMode = "directive"` (wrong-union value from `interactionPattern`) reached the DB, crashed every new-learner ComposedPrompt build. PR #1993 patched read-side; #1995 closed write-side reuse gap. |
| Soft source-ref → ContentSource (Playbook config + course-ref fixtures) | `Playbook.config.modules[].contentSourceRef` + `Playbook.config.modules[].settings.{cueCardPool,topicPool,scaffoldPool}` (DB) + same fields in YAML blocks of `course-reference-*.md` fixtures | `ContentSource.name` / `ContentSource.slug` rows (DB) + `## Content Sources` index inside the same fixture (PR-time) | ⚠️ PARTIAL | `tests/lib/wizard/source-ref-coverage.test.ts` (#2166 S1+S2+S4+S5, this PR, PR-time gate) + `apps/admin/scripts/check-fk-consistency.ts` Query 14 (`playbook-module-dangling-source-ref`, WARN-only DB-time gate, this PR) | HIGH (live IELTS gap) | Bidirectional layered enforcement. PR-time fixture walker: 10 vitests, 0 incumbent gaps, 0 exempt. DB-time SQL walker over `jsonb_array_elements(p.config->'modules')`: matches `contentSourceRef` against `ContentSource.name`/`slug` and `source:<slug>` against `ContentSource.slug`. WARN-only until the IELTS Sources 1-5 backfill (sibling story per epic #2166 S6) clears the 5-module incumbent debt on hf_sandbox. S3 of #2166 (runtime AppLog `source_ref.unresolved` from `selectPinnedCardForModule` / `resolveModuleSourceRefs`) is a separate follow-on PR. |
| CourseAssessmentPlan resolution (every published course × every declared `AssessmentMoment` → working DB state) | `Playbook.config.assessmentPlan` (JSON column extension — declarative per-course; types `CourseAssessmentPlan` + `AssessmentMoment` + `AssessmentKind` + `AssessmentSamplingPolicy` declared in `lib/types/json-fields.ts`, S1 of epic #2176, in flight via sibling agent) | Every `AssessmentMoment` resolves end-to-end: `moduleSlug` → `AuthoredModule` exists; `AuthoredModule.mode` matches `kind`; `scoringSpec` → `AnalysisSpec` selectable; content sources resolve via source-ref Coverage sibling. Sampling engine reads the plan at `lib/assessment/sample-questions.ts` (S2, in flight). | 🚧 PARTIAL | `course-assessment-plan-coverage.test.ts` under `apps/admin/tests/lib/assessment/` (S3 of epic #2176, in flight via sibling agent) — enumerate→classify→ratchet (resolvable / exempt / gap). | MED (6+ courses missing plans at launch — Big Five, Persuasion Literacy, Intro to Psychology, CIO/CTO trio, IELTS pending #2167) | **First non-Coverage 4th-layer instance under Data Presence umbrella.** Cross-enum check: `SessionKindString.ASSESSMENT` / `JourneyStopKind.assessment` / `FirstCallMode.baseline_assessment` / `AuthoredModuleMode.{examiner,quiz,mock-exam}` all cross-reference at PR time. Plan-vs-FirstCallMode drift fails CI. Operator framing: *"an assessment is extremely similar to cross-curriculum N questions"*. Resolves the `SessionKind = ASSESSMENT` type-only ghost decision deferred by PR #2144 — S4 of epic #2176 wires the writer when an `AssessmentMoment` fires (or removes from union). Rule: [`.claude/rules/course-assessment-plan-coverage.md`](../.claude/rules/course-assessment-plan-coverage.md). Sibling 4th-layer typed primitives: SessionFocus (#2145) + LearnerShell (#2163) — three primitives complete the family. |
| LearnerShellKind value → resolveLearnerShell selection → shell mount | `lib/types/json-fields.ts::LearnerShellKind` + `SHELL_DEFAULTS` (PR #2173, S1 of epic #2163) | `apps/admin/lib/voice/resolve-learner-shell.ts::resolveLearnerShell({session, module})` — pure selection function with declarative `SHELL_SELECTION_RULES` table + `SHELL_CAPABILITY_OVERRIDES` for per-mode capability deltas. Shell-mount consumers (S3 of epic #2163, sibling agent) read `shellKind` returned by the resolver — `components/sim/ExamModeShell.tsx` + `components/sim/SimChat.tsx` (mcq-rounds + chat-feed). | ✅ PROTECTED (selection) / ⚠️ PARTIAL (shell-mount consumers — S3 sibling agent) | `tests/lib/voice/resolve-learner-shell.test.ts` (Cartesian: kind × terminal × mode × null-module + capability overrides + override-table sanity, this PR) — sibling consumer ratchet at `tests/lib/sim-chat/mode-ui-coverage.test.ts::EXPECTED_GAP_COUNT = 2` until S3 wires the learnerUI consumers. | LOW (selection wired; S3 closes the consumer gap) | **4th sibling 4th-layer typed primitive — completes the family started by SessionFocus (#2145) + AssessmentKind (#2180) + Part3TechniqueFocus.** Declarative SHELL_SELECTION_RULES table at top of file — no nested if-else. Per-mode capability overrides (examiner vs mock-exam modePillKey) keyed in SHELL_CAPABILITY_OVERRIDES — no per-course code switches. ENROLLMENT structurally overrides module mode → intake-wizard wins. Examiner / mock-exam mount the same `exam` shell with distinct modePillKey via the override table. PR #2173 stub branch: local types declared with `TODO(#2173-rebase)` markers; vanish on the import swap once S1 lands. Rule: [`.claude/rules/learner-shell-selection.md`](../.claude/rules/learner-shell-selection.md). Story [#2197](https://github.com/WANDERCOLTD/HF/issues/2197) (S2 of epic [#2163](https://github.com/WANDERCOLTD/HF/issues/2163)). |
| `CueCardType` value → 3-axis consumer (teaching/adminUI/learnerUI) | `lib/types/json-fields.ts::CueCardType` (#2162, 2026-06-21) | future: per-card type discriminator on `cueCardPool` entries + `instructions.ts::resolveModuleCueCard` branch | 🚧 PARTIAL | `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts` (#2162) | LOW | Type-only PR. 2 values × 3 axes = 6 cells, all exempt at land time (consumer wiring follow-on). Rule: [`.claude/rules/bdd-typed-unions-coverage.md`](../.claude/rules/bdd-typed-unions-coverage.md). |
| `StallType` value → 3-axis consumer (teaching/adminUI/learnerUI) | `lib/types/json-fields.ts::StallType` (#2162, 2026-06-21) | future: typed `scaffoldPool` shape `Array<{tag: StallType; text: string}>` + `hooks/use-stall-detector.ts` per-tag branch | 🚧 PARTIAL | `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts` (#2162) | LOW | Type-only PR. 5 values × 3 axes = 15 cells, all exempt at land time (consumer wiring follow-on; tag-name leak prevented by `learner-ui-leak-coverage`). Rule: [`.claude/rules/bdd-typed-unions-coverage.md`](../.claude/rules/bdd-typed-unions-coverage.md). |
| `ScoreReadoutMode` value → 3-axis consumer (teaching/adminUI/learnerUI) | `lib/types/json-fields.ts::ScoreReadoutMode` (#2162, 2026-06-21) | `AuthoredModuleSettings.scoreReadoutMode` typed write via wizard parser at `lib/wizard/detect-module-settings.ts`; future Results-panel + tutor-close-line variant readers | 🚧 PARTIAL | `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts` (#2162) | LOW | Type-only PR; wizard parser now emits the field through (removed from fixture-type-coverage exempt; ratchet 4 → 3). 3 values × 3 axes = 9 cells, all exempt at land time (Results screen + close-line wiring follow-on). Rule: [`.claude/rules/bdd-typed-unions-coverage.md`](../.claude/rules/bdd-typed-unions-coverage.md). |

### Data Presence (Coverage sub-pillar)

> The Coverage pillar has two sub-pillars. The sibling sub-pillar —
> **Producer↔Consumer Coverage** — pins CODE pairing (every section
> above this one carries members of that sub-pillar). **Data Presence
> Coverage** pins DATA presence: does the row a soft reference,
> declared need, or runtime resolver depends on actually EXIST in the
> target table / environment?
>
> Six generic shapes (per `.claude/rules/data-presence-coverage.md`):
> soft FK resolvability • declared-need fulfilment • cross-environment
> parity • authored-vs-projected parity • Cartesian completeness •
> cascade reachability. Each shape becomes its own instance gate
> following enumerate→classify→ratchet + AppLog `data_presence.unresolved`
> runtime emission.
>
> Umbrella: epic [#2168](https://github.com/WANDERCOLTD/HF/issues/2168).
> Meta-rule: [`.claude/rules/data-presence-coverage.md`](../.claude/rules/data-presence-coverage.md).

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Soft source-ref (Playbook module-config) → ContentSource row presence | `Playbook.config.modules[].{contentSourceRef, settings.cueCardPool, settings.topicPool, settings.scaffoldPool}` (JSON soft refs) | `apps/admin/lib/wizard/resolve-module-source-refs.ts` → `prisma.contentSource.findUnique({where: {slug \| name}})` + runtime `selectPinnedCardForModule` | 🚧 IN FLIGHT | `tests/lib/wizard/source-ref-coverage.test.ts` (in flight, epic #2166) + `apps/admin/scripts/check-fk-consistency.ts` new query (in flight) + AppLog `source_ref.unresolved` (in flight) | HIGH | First Data Presence Coverage instance. Live evidence (2026-06-21 hf_sandbox): 5 of 5 IELTS module source-refs point to ContentSource rows that don't exist — runtime silently returns `null`; LLM told to anchor on cue card that doesn't exist; partner-blocker for Mock Exam P2 / Baseline P2 / Part 2 practice. Backfill story #2167 drives ratchet to 0. |
| Every PUBLISHED Playbook has fulfilment for declared content needs | per-mode runtime resolver (e.g. `mode: examiner` needs `cueCardPool`; `mode: quiz` needs `ContentQuestion` rows) | `prisma.contentSource.find*` + `prisma.contentQuestion.find*` at session-start | ⚠️ PARTIAL | Partial via #2166 (covers source-refs subset) — broader declared-need coverage is future S1 of epic #2168 | MED | Sibling instance candidate. Covers the "declared-need fulfilment" shape — a runtime check that for every module's MODE, the data structurally required to run that mode exists. Sub-shape candidates: every `examiner` module has cueCardPool data; every `quiz` module has ContentQuestion rows; every `mock-exam` module has scaffoldPool data. |
| Course-ref doc authored-vs-DB-projected parity | `docs/courses/**/*.course-ref.md` quantitative claims (e.g. "88 cue cards in v2.3") | DB row count post `applyProjection` | ❌ GAP | — | LOW | Future instance candidate (S3 of epic #2168). "Authored-vs-projected parity" shape. Catches the wizard projection silently dropping items that the source doc declares. Today's enforcement is operator inspection; structural gate would walk the doc's quantitative claims + assert matching DB counts post-projection. |

### Pipeline

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| AnalysisSpec.outputType → stage runner dispatch | `AnalysisSpec.outputType` | `lib/pipeline/specs-loader.ts::getSpecsByOutputType()` + `route.ts::stageExecutors` | ❌ GAP | — | HIGH | Convention-only enum dispatch. Missing/typo outputType causes silent fallback. Needs TS enum constant + ESLint guard. |
| AnalysisSpec slug → DB seed entry | `lib/config.ts::config.specs.*` | `prisma.analysisSpec.findUnique({where: {slug}})` | ⚠️ PARTIAL | Read-time error logs missing slug | MED | No CI test catches missing slug pre-deploy. |
| Pipeline stage→stage data flow (EXTRACT → SCORE_AGENT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE) | per-stage writer | next-stage reader | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Links 1–6 + per-stage test files | — | Comprehensive. Every link documented with producer / consumer / invariant / test. Link 4 (CALL→TRANSCRIPT→SCORE) and Link 5 (SCORE→AGGREGATE→ADAPT) particularly load-bearing. |
| Pipeline SCORE_AGENT → CallScore writer | `lib/pipeline/score-agent.ts` | `lib/pipeline/write-call-score.ts` | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Link 4 + `tests/lib/pipeline/*.test.ts` | — | — |
| Pipeline AGGREGATE → CallerAttribute writer (`lo_mastery:` key form) | `lib/curriculum/track-progress.ts` | reader at `lib/prompt/composition/transforms/modules.ts:702` | ✅ PROTECTED | `eslint-rules/no-bare-strategy-key.mjs` (#1599) + `tests/lib/mastery-roundtrip.test.ts` (#1599) | — | Canonical slug-form enforced |
| `lo-mastery-cascade` end-to-end (MEASURE → AGGREGATE → ADAPT → COMPOSE) | `apps/admin/docs-archive/bdd-specs/LEARN-ASSESS-001-curriculum-mastery.spec.json` (EXTRACT-stage measurement) | `apps/admin/lib/curriculum/track-progress.ts` (AGGREGATE write) → `apps/admin/lib/goals/strategies/lo_rollup.ts` (ADAPT goal-progress read) → `apps/admin/lib/prompt/composition/transforms/modules.ts` (COMPOSE per-LO mastery emission) | ✅ PROTECTED | `docs/lattice-chains.json::chains[lo-mastery-cascade]` walked by `tests/lib/lattice-chain-closure.test.ts` (#2079) | — | 4 links (LO mastery skips SCORE_AGENT — `learningAssessment.outcomes` flows in-memory from EXTRACT to AGGREGATE, no per-LO CallScore is written). Adjacent-link key consistency: MEASURE→AGGREGATE overlap on `loMastery`; ADAPT consumer is scope-based via `:lo_mastery:{moduleSlug}:{loRef}` suffix match in `lib/goals/track-progress.ts::deriveLearnGoalProgressFromRef`; COMPOSE consumer is scope-based on `CallerAttribute.scope === 'CURRICULUM'` AND `curriculum:{specSlug}:lo_mastery:` prefix via `lib/prompt/composition/lo-mastery-map.ts::buildLoMasteryMap`. |
| Pipeline ADAPT decision → COMPOSE recompose | ADAPT output (next module + targets) | COMPOSE stage runner | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Link 6 + `bump-timestamp.ts` enforcement | — | Pipeline COMPOSE carve-out: runs unconditionally at end |
| `session-focus-cascade` end-to-end (AGGREGATE Skill scores → CALLER_ATTRIBUTE_NEXT runner → CallerAttribute → COMPOSE transform → learner pin) | `apps/admin/lib/pipeline/aggregate-runner.ts` (CallerTarget.currentScore for skill_* params) | `apps/admin/lib/pipeline/runners/session-focus-policy.ts::runSessionFocusPolicy` (reads CallerTarget, writes `CallerAttribute(scope=specSlug, key=session_focus:next_{moduleSlug})`) → `apps/admin/lib/prompt/composition/transforms/session-focus.ts` (compose-time reader, wired into `transforms/instructions.ts::session_focus` by #2150) → renderer push under `[SESSION FOCUS]` block + `lib/voice/select-pinned-card.ts::selectTopicFocusCard` (session-start writer for `Session.metadata.pinnedCard`) | ✅ PROTECTED | runner unit tests at `apps/admin/tests/lib/pipeline/runners/session-focus-policy.test.ts`; transform tests at `apps/admin/tests/lib/prompt/composition/transforms/session-focus.test.ts`; pin selector tests at `apps/admin/tests/lib/voice/select-pinned-card.test.ts`; compose pair in `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`; learner-UI leak gate at `apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts`; first spec instance at `apps/admin/docs-archive/bdd-specs/IELTS-P3-FOCUS-001-part3-technique-focus.spec.json` | LOW | Phase A landed by PR #2153 + #2154 (CALLER_ATTRIBUTE_NEXT outputType + dispatch). S4 (#2150) authored IELTS-P3-FOCUS-001, wired `resolveSessionFocus` into `instructions.ts`, refactored `selectTopicFocusCard` to read CallerAttribute, and retired the bespoke `lib/curriculum/derive-focus-area.ts` + `transforms/part3-focus.ts`. Live writes depend on #2155 (`HF_IELTS_LLM_MEASURE_V1` flag). Honest empty-state at every link: writes nothing when no scored CallerTarget rows exist. Distinct from ADAPT (which writes CallerTarget). |
| Pipeline-stage CompositeAffectingPlaybookConfigKey writers → bump-timestamp | per-table writer | `lib/compose/bump-timestamp.ts::bumpPlaybookComposeTimestamp` | ✅ PROTECTED | Per-table ESLint rules (#1268) + 4-route adoption discipline | — | `hf-playbook/no-direct-config-write` etc. |
| `AuthoredModuleMode` value → spec-selection consumer (runtime pipeline / compose) | `lib/types/json-fields.ts::AuthoredModuleMode` | `lib/prompt/composition/transforms/instructions.ts::resolveModuleQuizDirective` + `resolveModuleMockExamDirective` (covered: quiz + mock-exam); `lib/pipeline/**` + `lib/voice/**` + `lib/curriculum/**` for future mode-specific selection | ✅ PROTECTED | `tests/lib/pipeline/mode-spec-selection-coverage.test.ts` + `.claude/rules/mode-spec-selection-coverage.md` (2026-06-21, #2152) | — | Bridge between build-time `mode-ui-coverage.test.ts` (#2144) and runtime spec selection (#2155). 7 vitests: source-vs-matrix sanity + gap-check + 2 ratchets + non-empty reason + no-contradiction + distribution sanity. Today's matrix: 2 covered (quiz, mock-exam via instructions.ts directives), 3 default-fallback (tutor, mixed, examiner — exempt with reasoned default-fallback). 0 gaps. |
| IELTS Speaking LLM scoring cascade (MEASURE → AGGREGATE → ADAPT → COMPOSE) | `apps/admin/docs-archive/bdd-specs/IELTS-MEASURE-001-ielts-speaking-criteria.spec.json` (LLM transcript judgment via SCORE_AGENT, writes 4 `skill_*` `CallScore` rows via `lib/measurement/write-call-score.ts` canonical chokepoint; #2143 / epic #2135 S2) + `lib/pipeline/prosody-consumer.ts::writeProsodyRawCallScores` (vendor signal in disjoint `prosody_raw_*` namespace; #2157 / S3) | `apps/admin/docs-archive/bdd-specs/SKILL-AGG-001-skill-ema-aggregation.spec.json` (`sourceParameterPattern: "skill_*"` closes loop via `closed-pattern`; EMA-to-CallerTarget.currentScore) → `apps/admin/docs-archive/bdd-specs/IELTS-P3-FOCUS-001-part3-technique-focus.spec.json` + sibling `ADAPT-*-IELTS` specs (CallerTarget.currentScore → CallerAttribute session-focus) → `lib/prompt/composition/transforms/session-focus.ts` + `transforms/quickstart.ts` (compose-side reads) | ✅ PROTECTED | `tests/lib/measurement/parameter-measurement-coverage.test.ts` (M1 substantive cross-check on spec.parameters[] evidence — IELTS-MEASURE-001 declares the 4 `skill_*` ids in its `parameters` array, classified `measured` via spec-side citation; no registry entry needed per S3 PR convention #2157) + `tests/lib/measurement/parameter-loop-closure.test.ts` (M2 closure via SKILL-AGG-001 `sourceParameterPattern: "skill_*"`) + `eslint-rules/no-bare-call-score-write.mjs` (M3 chokepoint — every CallScore write carries a real `analysisSpecId`) + `tests/lib/sim-chat/learner-ui-leak-coverage.test.ts` (criterion labels NEVER leak to learner UI dirs) | — | Closes epic [#2135](https://github.com/WANDERCOLTD/HF/issues/2135) S4 ([#2139](https://github.com/WANDERCOLTD/HF/issues/2139)). Disjoint namespaces: `IELTS-MEASURE-001` owns `skill_*` writes (LLM transcript judgment); `prosody-consumer` owns `prosody_raw_*` writes (vendor audio signal). LR + GRA stay LLM-only forever; FC + P confidence MAY be augmented by tool-use consumption of `prosody_raw_*` rows post-MVP. The 8 parameter ids (4 `skill_*` + 4 `prosody_raw_*`) live in spec/seed surfaces, NOT in `behavior-parameters.registry.json` — consistent with sibling `prosody_pace_wpm` / `prosody_hesitation_rate` (per `.claude/rules/parameter-coverage.md` "outside this ratchet's scope by design"). S6 (live verification) tracked separately. |
| Spec dispatch (no course-name prefix leak) | author intent — query specs by `outputType` / `specRole` / `config.requiresBehaviorTargetParams` opt-in flag | `app/api/calls/`, `lib/pipeline/`, `lib/measurement/` — refuse Prisma filters and String methods that hardcode `IELTS-` / `TOEFL-` / `CEFR-` etc. as substring constraints | ✅ PROTECTED | `eslint-rules/no-course-specific-measure-query.mjs` (#2183, error severity from day 1) + `tests/eslint-rules/no-course-specific-measure-query.test.ts` + `.claude/rules/no-course-specific-measure-query.md` | — | Born of the 2026-06-21 audit (epic #2176 S8 / story #2181 — NO HARDCODINGS). The original story-cited fingerprint at `pipeline/route.ts:915` was already course-agnosticised by #2155 / #2137 — replaced by `filterByBehaviorTargetParams` reading the opt-in `requiresBehaviorTargetParams: true` config flag. The remaining incumbent at `lib/pipeline/specs-loader.ts:431` (per-Playbook kill-switch override #2158) is refactored in the same PR by hoisting the prefix to a module-level constant `LLM_IELTS_MEASURE_SLUG_PREFIX`; future course-agnostic refactor (deferred follow-on) replaces the slug-prefix check with a spec-config opt-in (`cfg.disableViaPlaybookConfigKey: "aiMeasurement.X"`). Complementary to `hf-config/no-hardcoded-spec-slug` — this rule covers filter / dispatch literals; that rule covers comparison literals. |

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
| `AuthoredModuleMode` value → 3-axis consumer (teaching/adminUI/learnerUI) | `lib/types/json-fields.ts::AuthoredModuleMode` | `lib/prompt/composition/transforms/instructions.ts` (teaching) + `app/x/courses/[courseId]/_components/{AuthoredModulesPanel,LearnerModulePicker}.tsx` (adminUI) + `components/sim/ExamModeShell.tsx` (learnerUI) | ⚠️ PARTIAL | `tests/lib/sim-chat/mode-ui-coverage.test.ts` (2026-06-21) | MED (2 incumbent gaps) | Bidirectional 3-axis coverage. Exempts: 6 (tutor×3 + mixed×2 + examiner.teaching template). Gaps: quiz.learnerUI + mock-exam.learnerUI — learner experiences identical SimChat regardless of mode. Closing PRs #2077/#2081/#2090 wired teaching + adminUI but never landed learner UI. |
| `AuthoredModuleMode` value → FOH learner-UI consumer | `lib/types/json-fields.ts::AuthoredModuleMode` | `apps/foh/app/**` + `apps/foh/components/**` — future `resolveLearnerShell(...)` dispatch OR `.mode === "<value>"` branch | ❌ GAP (all 5 modes) | `tests/components/foh-coverage.test.ts` (2026-06-20, #2207 — U6 of epic #2185 UI Gap Zero) | HIGH (5 incumbent gaps — Learner gap L3) | Narrows the learner-UI axis of `mode-ui-coverage` to the FOH workspace alone (today's dominant learner surface). Incumbent matrix: every mode is a gap because `apps/foh/app/sim/page.tsx` is plain chat regardless of `AuthoredModule.mode`. Ratchet: `EXPECTED_GAP_COUNT = 5`, `EXPECTED_EXEMPT_COUNT = 0`. First PR that wires `resolveLearnerShell` collapses all 5 in one step. Rule: `.claude/rules/foh-coverage.md`. |

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
| Admin CourseDetail tab → mode-aware variant (`AuthoredModuleMode` / `AssessmentKind` / `LearnerShellKind`) | `app/x/courses/[courseId]/{Course*Tab.tsx,_components/**}` + `components/{journey,scoring,teaching,modules}-tab/**` | Tab JSX render path branches on `module.mode === "<value>"` (or future `assessment.kind` / `shell.kind` literal) | ⚠️ PARTIAL | `tests/components/admin-tab-coverage.test.ts` + `.claude/rules/admin-tab-coverage.md` (2026-06-21, U1 of umbrella #2185) | HIGH (12 incumbent gaps) | 9 vitests: source-vs-matrix sanity + walker-non-empty + gap check + 2 ratchets + non-empty reason + no-stale-exempt + no-contradiction + distribution sanity. Today's matrix: 2 covered (AuthoredModulesPanel + LearnerModulePicker), 4 exempt-explicit (Overview/Who/Learners/Proof — story #2203 named no-mode-axis), infra helpers exempted by basename pattern (LH menus / modals / breadcrumbs / chips / summary cards), 12 incumbent gaps frozen at land time. Sibling of `mode-ui-coverage.md` on the SimChat axis + `mode-spec-selection-coverage.md` on the runtime spec-selection axis — three gates pin the same `AuthoredModuleMode` source from three consumer surfaces. |

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
| Provider-catalogue voice ID literal → `config.voice.defaults.<provider>.voiceId` | runtime fallback code (e.g. `lib/chat/admin-tool-handlers.ts`) | `apps/admin/lib/config.ts::config.voice.defaults.deepgram.voiceId` (+ future providers) | ✅ PROTECTED | `apps/admin/eslint-rules/no-hardcoded-voice-id.mjs` (HF-VOICE, warn → error after sweep) + `apps/admin/tests/eslint-rules/no-hardcoded-voice-id.test.ts` (smokeRule + RuleTester) | MED | #2184 (audit follow-on from #2181). Provider regex registry covers Deepgram Aura + Cartesia Sonic; extensible per provider. Sibling: `lib/voice/default-provider.ts::DEFAULT_VOICE_PROVIDER_SLUG` (provider slug — one tier up). Rule: `.claude/rules/no-hardcoded-voice-id.md`. |

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
| `AuthoredModuleSettings` type ↔ fixture YAML keys | `lib/types/json-fields.ts::AuthoredModuleSettings` | `lib/wizard/__tests__/fixtures/course-reference-ielts-v*.md` | ✅ PROTECTED | `tests/lib/wizard/fixture-type-coverage.test.ts` (#1910) | — | Bidirectional Coverage gate; fixture key exempt ratchet has dropped 5 → 4 → 3 as types landed: `topicPool` (#1932), `scoreReadoutMode` (#2162). Remaining exempts: `prepSilenceSec`, `incompleteThresholdSec`, `scoringCriteria` (type additions deferred to follow-on). |
| Course-ref doc filesystem → `hf-template-version` YAML front-matter | `docs/courses/**/*.course-ref.md` + `docs/external/**/Upload Docs/*.course-ref.md` | YAML front-matter `hf-template-version: "X.Y"` marker | ✅ PROTECTED | `tests/lib/courses/courses-template-version-coverage.test.ts` (#1991, S5 of epic #1986) | — | Bidirectional Coverage gate; 6 production course-refs on v5.1 at land time; ratchet at 0 exempt — new course-ref MUST land with marker. Rule: `.claude/rules/courses-template-version-coverage.md` |

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
| `parameter-measurement-coverage.md` | `tests/lib/measurement/parameter-measurement-coverage.test.ts` (#1967 M1) | ✅ PROTECTED |
| `parameter-loop-closure.md` | `tests/lib/measurement/parameter-loop-closure.test.ts` (#1967 M2) | ✅ PROTECTED |
| `aggregate-output-consumer-coverage.md` | `tests/lib/measurement/aggregate-output-consumer-coverage.test.ts` (#1967 M2 follow-on, 2026-06-19) | ✅ PROTECTED |
| `fixture-type-coverage.md` | `tests/lib/wizard/fixture-type-coverage.test.ts` (#1910) | ✅ PROTECTED |
| `arraykey-writer-coverage.md` | `tests/lib/journey/arraykey-writer-coverage.test.ts` (#1912) | ✅ PROTECTED |
| `spec-readonly-boundary.md` | `eslint-rules/no-customer-write-to-canonical-interpretation.mjs` (#1984 S1) + `tests/lib/cascade/spec-readonly-fields-coverage.test.ts` (#1984 S2) | ✅ PROTECTED |
| `courses-template-version-coverage.md` | `tests/lib/courses/courses-template-version-coverage.test.ts` (#1991) | ✅ PROTECTED |
| `wizard-enum-coverage.md` | `eslint-rules/no-untyped-enum-write-in-wizard.mjs` (#1995) + `tests/lib/chat/wizard-enum-validation.test.ts` (#1995) + runtime guards in `lib/content-trust/resolve-config.ts` (#1995) — five-layer chain-contract closure for chat-tool merge path | ✅ PROTECTED |
| `privacy-redaction.md` | ESLint `require-tiered-redactor` + `tier-visibility-coverage` (#1855) — same enforcer as `response-redaction.md`; this file is the privacy-specific framing | ✅ PROTECTED (5 leak ratchet, #1922) |
| `data-retention.md` | `lib/privacy/stamp-regulatory-expiry.ts` chokepoint (#1917) + retention cron + `apps/admin/scripts/check-fk-consistency.ts` Query 12 | ✅ PROTECTED (3 voice paths adopted; 8 lower-priority writers adopt as touched) |
| `db-registry-parity.md` | `tests/lib/registry/parameter-domain-group-taxonomy.test.ts` (#1948 — JSON source) + `eslint-rules/no-bare-parameter-write.mjs` (#2034 S1 — write chokepoint) + canonical helper at `lib/registry/canonical-domain-group.ts::resolveCanonicalDomainGroup()` + planned DB-parity ratchet (#2040 S7 — see PR #2046) + planned CHECK constraint migration (S3c) | ⚠️ PARTIAL (S7 + S3c pending; ratchet covers S1 + JSON-source today, DB CHECK + DB parity test land after S3a/S3b mapping clears incumbent debt) |
| `vm-migration-lock.md` | `scripts/vm-migrate.sh` wrapper + session-start check | ✅ PROTECTED |
| `pipeline-and-prompt.md` | `qmd search` mandate + docs cross-ref | ⚠️ CONVENTION-ONLY |
| `database-patterns.md` | Author discipline | ⚠️ CONVENTION-ONLY |
| `ui-design-system.md` | `arch-checker` + `ui-reviewer` agents | ⚠️ CONVENTION-ONLY |
| `mode-ui-coverage.md` | `tests/lib/sim-chat/mode-ui-coverage.test.ts` (2026-06-21) | ⚠️ PARTIAL (2 incumbent learner-UI gaps) |
| `foh-coverage.md` | `tests/components/foh-coverage.test.ts` (2026-06-20, #2207 — U6 of epic #2185) | ❌ GAP (5 incumbent FOH learner-UI gaps — all modes) |
| `sessionkind-reader-coverage.md` | `tests/lib/voice/sessionkind-reader-coverage.test.ts` (2026-06-21) | ⚠️ PARTIAL (2 type-only ghosts: ASSESSMENT, TEXT_CHAT) |
| `learner-ui-leak-coverage.md` | `tests/lib/sim-chat/learner-ui-leak-coverage.test.ts` (2026-06-21) — static-literal class | ⚠️ PARTIAL (runtime data-flow class deferred to #2135 S4 / #2139 SUPERVISE-spec) |
| `source-ref-coverage.md` | `tests/lib/wizard/source-ref-coverage.test.ts` (2026-06-20, #2166) + `apps/admin/scripts/check-fk-consistency.ts` Query 14 | ⚠️ PARTIAL (PR-time 0 gaps; DB-time 5-module IELTS incumbent debt, WARN-only) |
| `course-assessment-plan-coverage.md` | `course-assessment-plan-coverage.test.ts` under `apps/admin/tests/lib/assessment/` (#2176 S3, in flight via sibling agent) | ⚠️ PARTIAL (6+ courses missing plans) |
| `data-presence-coverage.md` | Meta-rule for the Data Presence sub-pillar (umbrella epic #2168). Per-instance rule files land under `.claude/rules/data-presence-<surface>-coverage.md`. First instance: source-ref → ContentSource (#2166, in flight). | ⚠️ CONVENTION+UMBRELLA (instances drive their own enforcement) |
| `no-bare-spec-identifier.md` | `eslint-rules/no-bare-spec-identifier.mjs` (#2182, 2026-06-21) + `tests/eslint-rules/no-bare-spec-identifier.test.ts` (26 RuleTester cases) + `lib/config.ts::config.specs.{skillMeasureV1,prosodyScoreV1,mockMeasureV1,adaptDeltaV1,entityAccessV1,examReadinessV1,curriculumProgressV1}` accessors | ✅ PROTECTED (clean sweep at land — 7 sites repaired across 6 files) |
| `bdd-typed-unions-coverage.md` | `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts` (#2162, 2026-06-21) — `CueCardType` / `StallType` / `ScoreReadoutMode` 3-axis matrix | 🚧 PARTIAL (30 cells, all exempt at land time; consumer wiring follow-on) |

### Session / learner boundaries

| Chain | Producer | Consumer | Status | Gate | Severity | Notes |
|---|---|---|---|---|---|---|
| Pipeline-stage output → learner-facing sanitiser | pipeline output strings | `app/api/student/scheduler-decision` + SCHEDULER_REASONS constant | ✅ PROTECTED | `epic-100-chain-walk.md` Link L1 (2026-05-27) + #923 / PR #924 + tests | — | Regex guard blocks log-prefix strings; read-side sanitizer + stale guard |
| Composed prompt → ComposedPrompt persistence | `lib/prompt/composition/persist.ts` | `Call.usedPromptId` FK + `next call read` | ✅ PROTECTED | `docs/CHAIN-CONTRACTS.md` Link 3 (Session boundary I-CT2 cascade) + atomic create-session helper | — | Most-recent-active ComposedPrompt resolution cascade |
| `SessionKindString` value → writer + reader pairing | `lib/voice/session-rules.ts::SessionKindString` (5 values) | writers under `lib/voice` + `lib/intake` + `lib/test-harness` + `app/api`; readers via `=== "X"` or Prisma `where: { kind: "X" }` | ⚠️ PARTIAL | `tests/lib/voice/sessionkind-reader-coverage.test.ts` (2026-06-21) | MED (2 ghost kinds) | Bidirectional writer + reader coverage. Exempts: 4 (ASSESSMENT writer/reader + TEXT_CHAT writer/reader — both declared on epic #1338, both type-only ghosts). Type-exhaustiveness `case "X":` branches in `initialCounterFlags` deliberately excluded — that's type plumbing, not business logic. Decision pending per ghost: implement or remove from union. |
| Internal-only labels → MUST NOT leak into learner-UI source (static literals) | `INTERNAL_LABEL_REGISTRY` in shared JSON at `docs/kb/generated/internal-label-registry.json` — course-agnostic (IELTS_CRITERIA + IELTS_CRITERION_SLUGS today) | `components/sim/**` + `app/x/student/**` + `apps/foh/app/**` + `apps/foh/components/**` | ✅ PROTECTED | `tests/lib/sim-chat/learner-ui-leak-coverage.test.ts` (2026-06-21) | HIGH (live #1955 bug class) | Catches the static-literal class. Exempts: 2 (Mock Results screen sanctioned per BDD US-Mock-05). Runtime data-flow class — the actual #1955 leak (`IELTS_SKILL_LABELS` flowing through props from `select-pinned-card.ts` to SimChat) — now caught by `LEAK-SCAN-001` SUPERVISE-spec runtime gate (#2151, see next row). Both gates read the SAME shared JSON. |
| Internal-only labels → MUST NOT leak into composed prompt / pinned cards (runtime data-flow) | `LEAK-SCAN-001.spec.json` reads `docs/kb/generated/internal-label-registry.json` + scans `ComposedPrompt.prompt` + `PinnedCardContent` text-bearing fields | `apps/admin/lib/pipeline/runners/supervise/leak-scan.ts` writes `CallScore(parameterId="BEH-INTERNAL-LEAK")` + emits AppLog `supervise.internal_leak_detected` on detection | ✅ PROTECTED | `tests/lib/pipeline/runners/supervise/leak-scan.test.ts` (#2151, 2026-06-21) — 17 vitests covering pure detection + end-to-end + shared-registry sync | HIGH (live #1955 bug class) | SUPERVISE-stage runtime complement to PR #2144's build-time gate. Honest-empty-state: writes NOTHING on the happy path (no fake-zero CallScore corrupting EMA). Shared-registry sync test pins symmetric set-equality between runtime + build-time gates. `BEH-INTERNAL-LEAK` parameter classified `operator-only` (SUPERVISE-alarm shape — read by operator via AppLog, NOT folded into AGGREGATE/ADAPT/REWARD cascade; per #1967 M2 architectural decision). |
| `LearnerShellKind` value → concrete capability-driven shell component | `lib/types/json-fields.ts::LearnerShellKind` (5 values, PR #2173 / S1 of epic #2163) | `components/sim/<PascalCase(kind)>Shell.tsx` accepting `capabilities: LearnerShellCapabilities` prop | ⚠️ PARTIAL | `tests/components/shell-coverage.test.ts` (#2208 / U7 of #2185, 2026-06-20) | MED (silent fallback to chat-feed default) | Exact-match ratchet; RED first-run baseline = 5 gaps on `main` pre-#2202; PR #2202 lands `ChatFeedShell` + `MCQRoundsShell` + `ExamModeShell` capability refactor → drops to 2 (results-readout + intake-wizard). S4-S7 of #2163 land the remaining shells → 0. Source-vs-matrix sanity skips gracefully until #2173 lands. Rule: [`.claude/rules/shell-coverage.md`](../.claude/rules/shell-coverage.md). |

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
