# Prompt Composition — Canonical Map

> **Read this before you add a loader, a transform, a new section to `getDefaultSections()`, or any code that reads `LoadedDataContext` / `AssembledContext` / writes a `ComposedPrompt` row.**
>
> Fourth pillar of the architecture canon:
> - [`docs/WIZARD-DATA-BAG.md`](./WIZARD-DATA-BAG.md) — inputs (educator intent → `Playbook.config`)
> - [`docs/ENTITIES.md`](./ENTITIES.md) — the data model + content-boundary rules (who owns what, who can see what)
> - [`docs/CONTENT-PIPELINE.md`](./CONTENT-PIPELINE.md) — classification (extraction, audience, compose-time filters)
> - **This doc** — assembly: how loader output + transforms become the prompt the LLM actually sees.

---

## 1. Why this doc exists

Real incidents this doc would have prevented:

| Incident | Date | What broke |
|----------|------|-----------|
| `visualAids` stale-ref drift | 2026-05-10 | The `visualAids` loader had no `documentType` filter; `course-ref.md` leaked to learners as media attachment. Fix landed same day via `isTutorOnlyDocumentType` (see CONTENT-PIPELINE.md §8 L1). |
| `__teachingDepth` array-property hack | ✅ FIXED (#814 story 2) | Previously: `SectionDataLoader.ts::registerLoader("curriculumAssertions")` stashed `teachingDepth` on the result array via `(result as any).__teachingDepth = ...`. Now: the loader returns a typed `CurriculumAssertionsLoaderResult` interface with `teachingDepth: number \| null` as a sibling field (`SectionDataLoader.ts:43-46`). Survives `.filter() / .map() / .slice()` downstream. Confirmed stale entry removed from §9 L1 (now marked FIXED). |
| Isolated `PrismaClient` in template compiler | ongoing | `PromptTemplateCompiler.ts` instantiates its own `new PrismaClient()` rather than importing the shared `lib/prisma::prisma` singleton — separate connection pool, no logging instrumentation, can outlive request scope. |
| Onboarding-flow override source ambiguity | 2026-05-10 | Welcome flow was firing instead of `course-ref.md` first-call rules because `pedagogy.ts` rendered overrides as a separate block alongside `onboardingFlowPhases`. Now `pedagogy.ts` REPLACES the flow; `buildComposeTrace.ts` records which source won. |
| Stale flow-map memory file | 2026-05-08 → 2026-05-11 | Claude's `memory/flow-prompt-composition.md` was Claude-only; agents writing new transforms couldn't see it. This doc promotes that knowledge to the repo. |

**Rule of thumb:** *if you're touching loader output, registering a transform, or changing what a section emits, walk §3 and §4 first — and update §10 in the same PR.*

---

## 2. Pipeline at a glance

```
POST /api/callers/{callerId}/compose-prompt
        │
        ▼
loadComposeConfig()        ← reads COMP-001 spec from DB; sections[] + thresholds
        │
        ▼
executeComposition(callerId, sections, specConfig)
        │
        ├─ 1.  loadAllData()                            ← SectionDataLoader.ts
        │         ├─ resolveContentScope() (once)       ← shared by 5 content loaders
        │         └─ Promise.all([ 21 loaders ])
        │
        ├─ 2.  resolveSpecs(playbooks, systemSpecs)     ← transforms/identity.ts
        │         + mergeIdentitySpec (base + overlay)
        │         + applyGroupToneOverride
        │
        ├─ 3.  computeSharedState()                     ← transforms/modules.ts
        │         → modules, isFirstCall, daysSinceLastCall, nextModule, lessonPlanEntry
        │
        ├─ 4.  topologicalSort(sections)                ← respects dependsOn[]
        │
        ├─ 5.  for each section (sorted):
        │         checkActivationWithReason() → applyFallback() OR
        │         resolveDataSource() → chain transforms → context.sections[outputKey]
        │
        ├─ 6.  Assemble llmPrompt                       ← strip `_`-prefixed fields, add agentIdentitySummary
        │
        ├─ 7.  buildCallerContext()                     ← markdown summary
        │
        └─ 8.  buildComposeTrace() + render `[compose-trace]` log block
        │
        ▼
renderPromptSummary(llmPrompt) → persistComposedPrompt() → ComposedPrompt row (supersedes prior active)
```

Approximate scale: **21 loaders, 24 transform files (≈30 registered transforms), 28 sections** in `getDefaultSections()`.

Entry points (all funnel into `executeComposition`):

| Trigger | Route / file | Notes |
|--------|--------------|-------|
| Manual / UI / sim | `app/api/callers/[callerId]/compose-prompt/route.ts::POST` | Persists. |
| Pipeline COMPOSE stage | `lib/ops/pipeline-run.ts` | Triggered after AGGREGATE → REWARD → ADAPT → SUPERVISE complete. |
| **Enrollment bootstrap** (#1420) | `lib/enrollment/auto-compose.ts::autoComposeForCaller` | Fired POST-tx from `/api/join/[token]` (new-user path) and `/api/invite/accept`. Persists with `triggerType: "enrollment"`. After success, `lib/voice/stamp-enrollment-session-prompt.ts` links the prompt back to the ENROLLMENT Session row (I-CT2 step 3 terminal anchor). Reconciler backstop: `lib/voice/reconcile-missing-bootstrap.ts` (every 60s via `/api/voice/reconcile-carry-through`). |
| Dry-run (tuning) | `app/api/courses/[courseId]/dry-run-prompt/route.ts::POST` | Returns trace; does **not** persist. |
| Diff viewer | `app/api/composed-prompts/[promptId]/diff/route.ts::GET` | Reads `inputs.composition` off a persisted row. |
| CLI | `cli/control.ts::compose-prompt` | Wraps the API. |

---

## 3. Data loaders — master table

All declared in `SectionDataLoader.ts` via `registerLoader("<name>", async (callerId, config?) => …)`. Named by their registered key — that's the symbol the spec section's `dataSource` references.

| Loader | Input scope | Primary query (Prisma model) | Feeds section(s) (`outputKey`) | Edge cases |
|--------|------------|-----------------------------|---------------------------------|------------|
| `caller` | `callerId` | `Caller` + `domain` + `cohortGroup` + `cohortMemberships` | `caller`, used downstream by domain / onboarding | Returns `null` if caller missing → executor throws. |
| `memories` | `callerId`, `limit` from `specConfig.memoriesLimit` | `CallerMemory` (non-superseded, non-expired, order `category asc, confidence desc`) | `memories` | Limit defaults to 50. |
| `personality` | `callerId` | `CallerPersonalityProfile` (`parameterValues` JSON) + legacy `CallerPersonality` | `personality` | Merges Big Five + VARK keys with legacy preferred-tone fields. |
| `learnerProfile` | `callerId` | `getLearnerProfile()` helper (cross-table aggregate) | `learnerProfile` | Wraps in try/catch; returns `null` on failure (non-blocking). |
| `recentCalls` | `callerId`, `limit` from `specConfig.recentCallsLimit` | `Call` (with `scores.parameter`) | `callHistory` | Limit defaults to 5; only `endedAt != null`. |
| `callCount` | `callerId` | `Call.count` where `endedAt != null` | `callHistory`, drives `sharedState.isFirstCall` | — |
| `behaviorTargets` | global | `BehaviorTarget` where `effectiveUntil = null` | `behaviorTargets` | Domain-wide; `callerId` ignored. |
| `callerTargets` | `callerId` | `CallerTarget` | `behaviorTargets` | Merged with global by `mergeAndGroupTargets`. |
| `callerAttributes` | `callerId` | `CallerAttribute` (non-expired) | `sessionPlanning`, also consumed by `retrieval-practice` for "recent IDs" memory | Drives several gates. |
| `goals` | `callerId` | `Goal` (status ACTIVE/PAUSED, top 10, ordered priority/progress) | `learnerGoals` | Includes `contentSpec` + `playbook` summaries. |
| `playbooks` | `callerId`, optional `playbookIds[]` from `specConfig` | `CallerPlaybook.ACTIVE` → `Playbook` (PUBLISHED) with `items.spec`; **falls back to domain-wide PUBLISHED playbooks** when no enrollment. | `identity`, `instructions`, `agentIdentitySummary` | Domain fallback is the unenrolled-preview path; see ENTITIES.md §4.3. |
| `systemSpecs` | global | `AnalysisSpec` (`scope=SYSTEM`, `isActive=true`) | `identity`, `instructions` | Post-filtered by `filterSpecsByToggles()` against `playbooks[0].config.systemSpecToggles`. |
| `onboardingSpec` | env-driven slug (`config.specs.onboarding`, default INIT-001) | `AnalysisSpec` lookup (insensitive contains / domain="onboarding") | `quickStart`, `pedagogy` (fallback) | Used only when neither `Domain.onboardingFlowPhases` nor `Playbook.config.onboardingFlowPhases` is set. |
| `onboardingSession` | `callerId` + domain | `OnboardingSession` unique by `(callerId, domainId)` | `pedagogy`, `quickStart` | Drives `isFirstCallInDomain`. |
| `subjectSources` | `contentScope` (pre-resolved) | `Subject` + `sources.source` + `curricula` (top 1) | `contentTrust`, palette metadata in transforms | Returns `null` when scope empty; attaches `tutorOnly` flag per source via `isTutorOnlyDocumentType`. |
| `curriculumAssertions` | `contentScope` | `ContentAssertion` (`category NOT IN INSTRUCTION_CATEGORIES`, top 300, strict `subjectSourceId IN (…)` when present) | `teachingContent` | **Mutates result with `__teachingDepth` (see L1).** |
| `curriculumQuestions` | `contentScope` | `ContentQuestion` (top 100 by `sortOrder`) | consumed by `retrievalPractice` | Used for retrieval-practice MCQ selection. |
| `curriculumVocabulary` | `contentScope` | `ContentVocabulary` (top 100) | `teachingContent` (vocab block) | — |
| `courseInstructions` | `contentScope` | `ContentAssertion` (`category IN INSTRUCTION_CATEGORIES` OR `sourceId IN COURSE_REFERENCE`); plus `LearningObjective` where `systemRole=TEACHING_INSTRUCTION` (since #317) | `courseInstructions` | TEACHING_INSTRUCTION LOs are rebadged with `category="teaching_rule"` so the render path is unchanged. |
| `openActions` | `callerId` | `CallAction` (PENDING / IN_PROGRESS, top 10) | (formatted via `formatActions`, surfaced inside `instructions`) | — |
| `visualAids` | `contentScope` | `SubjectMedia` (`mimeType startsWith "image/"`, top 20) + chapter join via `AssertionMedia` | `visualAids` | Post-filtered by `isTutorOnlyDocumentType`; logs `[visualAids] Filtered N` (see L3). |
| `priorCallFeedback` | `callerId`, `moduleId`, `currentCallId` (from `Call.curriculumModuleId`) | `Call.findFirst` (prior on module, excludes currentCallId) + `CallScore.findMany`; **#599 Slice 1** widens to `SystemSetting`, `UsageEvent`, `ComposedPrompt`, `AuditLog`, `Caller` for the synthesis gate sequence | `priorCallFeedback` | Templated path (`hasFeedback: true/false`) is #492 Slice 3.5; AI-synthesized recap is opt-in per-playbook (see §3.2 below). Failures in the synthesis path degrade silently to the templated text. |

### 3.1 `resolveContentScope` — three-tier resolution

`SectionDataLoader.ts::resolveContentScope` runs ONCE per composition and is shared via `loaderConfig.contentScope` to the five content loaders above (`subjectSources`, `curriculumAssertions`, `curriculumQuestions`, `curriculumVocabulary`, `courseInstructions`, `visualAids`).

Order:

1. **Resolved single playbook** — `resolvePlaybookId(callerId)` returns one course → `getSubjectsForPlaybook(playbookId, domainId)`. Sets `scoped: true`, populates `playbookId`.
2. **Union of all enrolled playbooks** — when ≥1 `CallerPlaybook ACTIVE` exists but the resolver didn't pick one. PRIMARY: `PlaybookSource` rows for those playbookIds (post-2026-04-17 boundary). FALLBACK within this tier: legacy `Subject → SubjectSource` chain. `scoped: true`.
3. **Domain-wide last resort** — no enrollments at all → all `SubjectDomain` rows for `caller.domainId`. `scoped: false`. **Intentional for unenrolled previewing, structurally leaky for multi-course domains** (ENTITIES.md §4.3, E8).

Anti-bleed invariant: when `subjectSourceIds` is non-empty, `curriculumAssertions` uses a strict `subjectSourceId IN (…)` filter with **no null fallback**. Adding `OR subjectSourceId IS NULL` revives Leak B (ENTITIES.md §9, E2).

### 3.2 `priorCallFeedback` — synthesis gate sequence (#599 Slice 1)

The templated path (#492 Slice 3.5) is the safe default. An AI-synthesized recap replaces the templated summary **only** when every safety gate passes, in order:

1. **Kill switch** — `process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED === "true"` (strict string compare). Absent or any other value → templated path. Documented inline on `PlaybookConfig.priorCallRecap` JSDoc.
2. **Playbook opt-in** — `Playbook.config.priorCallRecap.enabled === true`. Default `false` (the whole block is omitted on day-1 playbooks).
3. **Allowlist** — `SystemSetting prior_call_recap.allowlist` value (JSON-encoded `string[]` of playbookIds). **Absent row AND empty array both block every playbook** — safe-by-default. Admin-only write (no AI tool reaches `SystemSetting`; the `system_setting` entry in `AI_FORBIDDEN_FIELDS` is a structural tripwire for any future tool that tries).
4. **Daily cap** — counts today's `UsageEvent.sourceOp = 'compose.prior-call-recap'` rows where `metadata->>'playbookId'` matches. Compared against `Playbook.config.priorCallRecap.dailyCap` (default 50, server-side clamped to `[0, 500]` at the AI-surface handler). Over-cap → templated path + `AuditLog action: prior-call-recap-cap-exceeded`.
5. **Depth dispatch** — `minimal` short-circuits to the templated path (no AI). `standard` → 2-3 sentence diagnosis, `rich` → 3-4 sentences + transcript-grounded observation (transcript sliced to 6000 chars).
6. **Cache** — most recent `ComposedPrompt` for `(callerId, triggerCallId, playbookId)` checked; if `recapSynthesisCache.depth === requestedDepth`, the cached text is returned with `cachedHit: true` and no AI call fires. On depth mismatch, the next synthesis overwrites the cache via `persistComposedPrompt` (one entry per ComposedPrompt row — no stale-depth retention).
7. **Synthesis + audit** — `synthesizePriorCallRecap()` fires the configured AI call point `compose.prior-call-recap` (cascade-only — no explicit `maxTokens`/`temperature`). On success: `AuditLog action: prior-call-recap-synthesized` with `{callId, depth, playbookId, cachedHit, tokensUsed, latencyMs, outputText}`.

Gates 1, 2, 3, 4, 6 fall back to the templated path; the loader returns `synthesizedRecap: null` in those cases. `persist.ts::persistComposedPrompt` reads `loadedData.priorCallFeedback.synthesizedRecap` and writes it to `ComposedPrompt.recapSynthesisCache` when present.

**Where the writes go.** Course settings (`enabled`, `depth`, `dailyCap`) flow through the educator UI on the Course detail page → "Course Configuration" section, and via the AI assistant's `update_playbook_config` tool. The tool handler validates inbound `priorCallRecap.depth` against the typed enum and clamps `dailyCap` server-side before the write reaches the pendingChange tray (#854).

---

## 4. Transforms — master table

All declared in `transforms/*.ts` via `registerTransform("<name>", fn)`. `CompositionExecutor.ts` imports each file so the registry self-populates at module load. A section's `transform` field references the registered name; arrays are chained left-to-right.

| File | Registered transform(s) | Mutates `context.sections.<outputKey>` | Source-of-state inputs |
|------|-------------------------|----------------------------------------|------------------------|
| `personality.ts` | `mapPersonalityTraits` | `personality` | `loadedData.personality` |
| `memories.ts` | `deduplicateAndGroupMemories`, `deduplicateMemories`, `groupMemoriesByCategory`, `scoreMemoryRelevance` | `memories` | `loadedData.memories`. **#598 Slice 1** `applyDecay` accepts a `memoryDecayScale` argument sourced from `Playbook.config.tolerances.memoryDecayScale`; the scale multiplies `CATEGORY_DECAY_DEFAULTS` only — explicit per-assertion `decayFactor < 1.0` rows are NOT scaled (no double penalty). Scale of `1.0` (or absent) is a no-op so existing courses stay byte-identical. |
| `targets.ts` | `mergeAndGroupTargets` | `behaviorTargets` | `loadedData.behaviorTargets` + `callerTargets`; on first call (`isFirstCall===true`), injects `Playbook.config.firstSessionTargets` (#784 S6) at NEW priority 1 (`PLAYBOOK_FIRST_SESSION` scope) above `Domain.onboardingDefaultTargets` → INIT-001 → `AUDIENCE_TARGET_DEFAULTS` |
| `modules.ts` | `computeModuleProgress` (+ `computeSharedState` helper used pre-section-loop) | `curriculum` | `_assembled`; reads `CallerModuleProgress` directly (non-blocking). **#598 Slice 1** every mastery-threshold read goes through `lib/tolerance/resolve-tolerance.ts::resolveMasteryThreshold` (7-layer cascade). Helpers (`loadModulesFromDB`, `extractCurriculumMetadata`, `extractLegacyModules`, `extractSubjectCurriculumModules`) take the resolved value as a parameter; `computeSharedState` exposes it on `sharedState.resolvedMasteryThreshold` for downstream transforms. `Playbook.config.firstCallMode === "teach_immediately"` clamps the scheduler's `callsSinceLastAssess` to `0` at read time on call 1; `Playbook.config.firstCall.durationMinsOverride` substitutes `callDurationMins` on call 1 (both read-time only — no stored attribute mutation). |
| `identity.ts` | `extractIdentitySpec` (+ `resolveSpecs`, `resolveVoiceSpecFallback`, `mergeIdentitySpec`, `applyGroupToneOverride` helpers) | `identity` | `_assembled` → `resolvedSpecs.identitySpec` |
| `simple.ts` | `mapLearnerProfile`, `computeCallHistory`, `filterSessionAttributes`, `mapGoals`, `computeDomainContext` | `learnerProfile`, `callHistory`, `sessionPlanning`, `learnerGoals`, `domain` | Various `loadedData.*` |
| `trust.ts` | `computeTrustContext` | `contentTrust` | `loadedData.subjectSources` |
| `teaching-content.ts` | `renderTeachingContent` | `teachingContent` | `loadedData.curriculumAssertions` (+ reads `__teachingDepth` via the L1 hack) + `curriculumVocabulary` |
| `course-instructions.ts` | `renderCourseInstructions` | `courseInstructions` | `loadedData.courseInstructions` |
| `visual-aids.ts` | `formatVisualAids` | `visualAids` | `loadedData.visualAids` |
| `physical-materials.ts` | `formatPhysicalMaterials` | `physicalMaterials` | `_assembled` (playbook config + subject metadata) |
| `session-materials.ts` | `formatSessionMaterials` | `sessionMaterials` | `_assembled` |
| `pedagogy-mode.ts` | `computePedagogyMode` | `pedagogyMode` | `_assembled` (curriculum + sharedState) |
| `retrieval-practice.ts` | `formatRetrievalPractice` | `retrievalPractice` | `_assembled` — calls `selectRetrievalQuestions` over `curriculumQuestions`; persists "recent IDs" back to `CallerAttribute` |
| `teaching-style.ts` | `computeTeachingStyle` | `teachingStyle` | `_assembled` (identity archetype + curriculum) |
| `audience.ts` | `computeAudienceGuidance` | `audienceGuidance` | `_assembled` |
| `activities.ts` | `computeActivityToolkit` | `activityToolkit` | `_assembled` (personality + curriculum + pedagogy) |
| `pedagogy.ts` | `computeSessionPedagogy` | `instructions_pedagogy` | `_assembled` — picks onboardingFlowSource: Playbook → Domain → Spec. **#790 (S8)** `Playbook.config.firstCallMode` branches call 1: `onboarding` (default, byte-identical) → `sessionType=FIRST_CALL` + ONBOARDING MODE flow; `teach_immediately` → ONBOARDING MODE branch SKIPPED, `sessionType=RETURNING_CALLER`, scheduler / generic-returning flow runs on call 1; `baseline_assessment` → `sessionType=BASELINE` + diagnostic-only flow + principles override (no teaching, no review, no remediation). **#598 Slice 1** `Playbook.config.firstCall.introducePedagogy === false` suppresses the ONBOARDING MODE intro on call 1 — behaviour-wise this matches the `teach_immediately` mode for the ONBOARDING-vs-RETURNING gate but composes cleanly with `baseline_assessment`. **#1405** `Playbook.config.firstCall.firstCallModuleVisibility` (default `mention_from_call_1`, options `hide_until_call_2` / `hide_until_learner_picks`) redacts module names from `plan.newMaterial.module` and the "Introduce foundation: <module>" fallback flow step on the ONBOARDING-MODE call-1 path. Gate logic lives in `transforms/module-visibility-gate.ts::shouldSuppressModuleNames`; learner's explicit pick (`sharedState.lockedModule` set) ALWAYS wins. TEACHING CONTENT loads unchanged. |
| `offboarding.ts` | `computeOffboarding` (**async**) | `offboarding` | `_assembled` + `CallerModuleProgress` query — gated by `Playbook.config.offboardingSummary` (#780 Felt Progress S2); cadence picks `final_only` (default, gated on `sharedState.isFinalSession`) or `every_session_with_data`; emits structured `progressSummary` with modules / goals / skills when data exists, null-guards to generic guidance otherwise |
| `progress-narrative.ts` | `computeProgressNarrative` | `progressNarrative` | `_assembled` — gated by `Playbook.config.progressNarrative` (#779 Felt Progress S1); rebuilds `loMasteryMap` from `callerAttributes`, surfaces top 3 LO refs as evidence for mid-call acknowledgement |
| `voice.ts` | `computeVoiceGuidance` | `instructions_voice` | `_assembled` + `resolvedSpecs.voiceSpec` |
| `instructions.ts` | `computeInstructions` | `instructions` | `_assembled` (depends on every prior content / pedagogy / voice section). **#2011** When the locked module's `AuthoredModule.mode === "quiz"`, emits `module_quiz_directive` reframing the session as a timed MCQ drill (8–12 questions drawn from the per-Unit ContentQuestion bank, conversational tone NOT A/B/C/D, two-sentence feedback per question, score + weakest-LO + Revision Aid pointer at close). Returns null on `tutor` / `mixed` / `examiner` / `mock-exam` — existing behaviour byte-identical. MCQ infrastructure (`lib/assessment/generate-mcqs.ts` + VAPI tool at `app/api/vapi/tools/route.ts`) is unchanged; this directive tells the LLM to use it as the conversation SHAPE rather than inline retrieval prompts. Producer↔consumer pairing pinned by `tests/lib/prompt/composition/coverage-producer-consumer.test.ts::PAIRS::module_quiz_directive`. **#2013** When the locked module's `AuthoredModule.mode === "mock-exam"`, emits `module_mock_exam_directive` reframing the session as a board-chair scenario exam (4–6 probes, no MCQs, no mid-session teaching, per-LO per-dimension close with Foundation/Developing/Practitioner/Distinction breakdown). When `Playbook.config.useFreshMastery === true` (the Exam Assessment isolation contract — `lib/curriculum/readiness-rollups.ts:25`), the directive appends a "prior mastery doesn't carry in" line so AI narration aligns with the data-layer's `Call.scratchMastery` routing. The IELTS-specific examiner prompt at `lib/curriculum/build-per-segment-measure-prompt.ts:122` is pipeline-gated; it does NOT fire for CIO/CTO compose paths so no abstraction was needed. Pairing pinned by `::PAIRS::module_mock_exam_directive`. |
| `actions.ts` | `formatActions` | (embedded inside `instructions`) | `loadedData.openActions` |
| `quickstart.ts` | `computeQuickStart` | `_quickStart` | `_assembled` (caller_info + memories + targets + curriculum + goals + identity). **#1403** adds two first-call-only output keys: `greeting_ack_gate` (instruction injected after `[OPENING]` telling the AI whether to pause for ack — `firstCallWaitForAck: none` → null; `any_response` → "wait for any response"; `greeting_words` (default) → "wait for hi/hello/yes/yeah") and `greeting_course_intro` (course-intro turn from `Playbook.config.firstCallCourseIntro`, with `{firstName}` + `{courseName}` substituted via `defaults/substitute-greeting-tokens.ts`). Also re-orders the `first_line` cascade: `welcomeMessage` now fires at branch 1.5 (after identity-spec, before phase-derived #1195) so educator-authored welcomes win over phase-derived openings. Token substitution (`{firstName}` + `{courseName}`) is applied to the resolved `welcomeMessage` before the sanitiser runs. **#1405** When `Playbook.config.firstCall.firstCallModuleVisibility` flags the gate (see `pedagogy.ts` row), `this_session` swaps the `First session - introduce <module>` framing for the generic `SUPPRESSED_THIS_SESSION_COPY` directive. Locked-module branch (`if (lockedModule)`) always wins — gate never fires on a learner who picked. |
| `preamble.ts` | `computePreamble` | `_preamble` | `_assembled` (identity only). **#790 (S8)** `criticalRules` short-circuits on `Playbook.config.firstCallMode === 'baseline_assessment'` (call 1) to inject `BASELINE_ASSESSMENT_RULE` (override path: `prompt_preamble.config.criticalRules.baselineAssessment`). `teach_immediately` requires no preamble change — the existing branches already inject `returningCallerByMode[teachingMode]` regardless of `isFirstCall`. Default `onboarding` preserves byte-identical pre-#790 output |

`_quickStart` and `_preamble` are prefixed with `_` so the executor strips them from the final `llmPrompt` JSON output — they're consumed by `instructions.ts` and `renderPromptSummary.ts` but not exposed as top-level sections.

---

## 5. Data contracts gate

The composition layer uses contracts indirectly. The hard gates:

| Gate | Where | Contract / source |
|------|-------|-------------------|
| Module extraction shape | `transforms/modules.ts::computeSharedState` | `CURRICULUM_PROGRESS_V1` contract (see `lib/prompt/compose-content-section.ts` which calls `ContractRegistry.getContract`). Drives `metadata.curriculum.moduleSelector` and storage key pattern. |
| Mastery threshold | `lib/tolerance/resolve-tolerance.ts::resolveMasteryThreshold` (called once per composition in `computeSharedState`; result placed on `sharedState.resolvedMasteryThreshold`) | 7-layer cascade per ADR 2026-05-22: `BehaviorTarget(CALLER)` → `BehaviorTarget(PLAYBOOK)` → `Playbook.config.tolerances.masteryThreshold` → `SchedulerPolicy.masteryThresholdOverride` → `specConfig.metadata.curriculum.masteryThreshold` → `CURRICULUM_PROGRESS_V1.masteryComplete` → hardcoded `0.7`. Per-learner overrides via `BehaviorTarget(scope=CALLER, parameterId="TOL-MASTERY-THRESHOLD")`. **3 legacy reads remain in `lib/prompt/compose-content-section.ts` (lines 603 / 641 / 709)** — flagged with `TODO(#598 Slice 1 follow-up)` comments; out of scope for Slice 1 because they sit in the structured-mode path scheduled for replacement. |
| Spec section list (COMP-001) | `loadComposeConfig.ts` | DB `AnalysisSpec` row for COMP-001. **MUST stay in sync with `getDefaultSections()`** — see `.claude/rules/pipeline-and-prompt.md` and `tests/lib/prompt/composition/seed-sync.test.ts`. |
| `INSTRUCTION_CATEGORIES` split | `curriculumAssertions` + `courseInstructions` loaders | `lib/content-trust/resolve-config.ts` — the 14 of 24 `ContentAssertion.category` values that go to the tutor channel. CONTENT-PIPELINE.md §3.1. |
| `isTutorOnlyDocumentType` | `subjectSources`, `visualAids` loaders | `lib/doc-type-icons.ts::isStudentVisibleDefault` (allow-list over `DocumentType`). |
| Audience filtering | NOT in the compose layer — applied upstream in extraction / classification | `LearningObjective.systemRole` (`learnerVisible` derivation). CONTENT-PIPELINE.md §6. |

Adding a new contract-gated query: update §5 here and the relevant CONTENT-PIPELINE.md / ENTITIES.md row in the same PR.

---

## 6. Observability — `buildComposeTrace`

`buildComposeTrace.ts::buildComposeTrace` runs at the end of every `executeComposition` call. It collates:

| Field | What it captures | Where it surfaces |
|-------|------------------|-------------------|
| `loadersFired` | `{ loaderName: rowCount }` for every loader that returned ≥1 item | `[compose-trace]` log line `loaders: X fired, Y empty`; persisted in `ComposedPrompt.inputs.composition` |
| `loadersEmpty` | `{ loaderName: humanReason }` for empty loaders ("first call (no history)" / "no playbook enrollment" / etc.) | Same channels as above |
| `assertionsExcluded.firstReasons` | Up to 3 narrative hints: "0 tutor-only instructions extracted — check COURSE_REFERENCE doc imported cleanly" / "0 learner-facing teaching points" / "0 visual aids" | Server log + dry-run API + diff viewer |
| `onboardingFlowSource` | `Playbook <name>` / `Domain <slug>` / `Spec <slug>` / `null` — which override won | `[compose-trace] onboarding-flow:` line; mirrored from `transforms/pedagogy.ts` resolution order |
| `onboardingOverriddenByPlaybook` | `true` when Playbook beat Domain | Trace line `onboarding-override: playbook beat domain` |
| `mediaPalette` | `[{ fileName, documentType, sourceName }]` for every `visualAids` entry, enriched with the underlying `MediaAsset.source` | Trace lines `media-palette: N items` + first 5 rows |
| `sectionsActivatedCount` / `sectionsSkippedCount` | Counts of activated / skipped sections | Trace line `sections: A activated, S skipped` |
| `sectionsAffectedByKey` | `{ configKey: ComposeSectionKey }` — for every compose-affecting key (Playbook + Domain + AnalysisSpec), which compose section it bumps when changed. Static merge of the three `COMPOSE_AFFECTING_*_KEY_SECTIONS` maps in `lib/compose/`. #1556 (Story 1 of EPIC #1555). | Persisted in `ComposedPrompt.inputs.composition`; rendered by the Designer Inspector once #1559 (Story 4) lands the renderer registry. |

### Key → section ownership — source of truth (#1556)

The canonical mapping from a compose-affecting config key to the `ComposeSection` it bumps lives in **three sibling maps** under `apps/admin/lib/compose/`, all exported via the `lib/compose/index.ts` barrel:

| File | Map | Domain |
|---|---|---|
| `affecting-keys.ts` | `COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEY_SECTIONS` | 14 Playbook.config keys |
| `affecting-keys-domain.ts` | `COMPOSE_AFFECTING_DOMAIN_FIELD_SECTIONS` | 4 Domain fields |
| `affecting-keys-spec.ts` | `COMPOSE_AFFECTING_SPEC_FIELD_SECTIONS` | 6 AnalysisSpec fields |

Each map is `as const satisfies Record<KEY_TYPE, ComposeSectionKey>` — adding a new key to the `COMPOSE_AFFECTING_*_KEYS` array without adding a corresponding entry to the matching `*_KEY_SECTIONS` map is a TypeScript compile error.

Story 2 (#1557) consumes these maps to drive section-grain staleness hash bumps. Story 3 (#1558) consumes the loader→section map (`PIPELINE_STATE_SECTION_LOADERS` in `section.ts`) to scope incremental recompose. If you add a new compose-affecting key, add its section to the matching map; if you add a new `ComposeSection`, add its loader deps to `PIPELINE_STATE_SECTION_LOADERS` and at least one key→section mapping.

Three surfaces:

1. **Server log** — `console.log(renderComposeTraceLog(trace))` prints the `[compose-trace]` block during every real composition. Grep `[compose-trace]` in production logs.
2. **Dry-run API** — `app/api/courses/[courseId]/dry-run-prompt/route.ts::POST` returns `composeTrace` in the response without persisting; the Course Tuning UI renders it as a "why does my prompt look like this?" panel.
3. **ComposedPrompt diff viewer** — `app/api/composed-prompts/[promptId]/diff/route.ts::GET` reads `inputs.composition.trace` off the persisted row; viewer at `/x/composed-prompts/:id` renders it next to the LLM prompt JSON.

Failures in trace construction are caught and logged with `[compose-trace] failed to build trace:` — they never abort the composition.

---

## 7. Cross-references

| Topic | Lives in |
|-------|---------|
| Tutor-only `DocumentType` filter behind `visualAids` / `subjectSources` palette | CONTENT-PIPELINE.md §3.1 (DocumentType taxonomy), §6 (audience precedence), §8 L1 (the 2026-05-10 incident) |
| Content boundary walk (PlaybookSource → SubjectSource → domain-wide) the five content loaders depend on | ENTITIES.md §4 (boundary walk), §9 E1–E3 (the leak landmines) |
| `INSTRUCTION_CATEGORIES` (14-of-24) split between `curriculumAssertions` and `courseInstructions` | CONTENT-PIPELINE.md §3.1 |
| Pipeline COMPOSE stage call site | `memory/flow-pipeline.md` (stage ordering), `memory/flow-call-lifecycle.md` (transcript → recomposition trigger) |
| Wizard fields that flow into `Playbook.config` and back through `playbooks` loader → `identity` / `instructions_pedagogy` | WIZARD-DATA-BAG.md §3 master table (when present); meanwhile `lib/types/json-fields.ts::PlaybookConfig` |
| Spec system + scaffold materialising `Playbook` + `PlaybookItem` + system-spec toggles consumed by `filterSpecsByToggles` | ENTITIES.md §5; `lib/domain/scaffold.ts`; ADR-002 |

---

## 8. Pre-change checklist

### Adding a new loader

- [ ] Pick a name that matches the section's `dataSource` field — that's the symbol the spec uses.
- [ ] Register via `SectionDataLoader.ts::registerLoader("<name>", async (callerId, config?) => …)`.
- [ ] Add to the `Promise.all` block in `loadAllData()` AND to the `LoadedDataContext` type in `types.ts`.
- [ ] If the loader queries content, take `contentScope` from `loaderConfig.contentScope` — **do not call `resolveContentScope` again**.
- [ ] Update `buildComposeTrace.ts::noteLoader(...)` so the trace surfaces it.
- [ ] Update §3 master table here.

### Adding a new transform

- [ ] Create a file under `transforms/` and call `registerTransform("<camelName>", fn)`.
- [ ] Add `import "./transforms/<file>";` to `CompositionExecutor.ts` so the registry self-populates.
- [ ] Define the section in `getDefaultSections()` with `transform: "<camelName>"`, `dependsOn: […]` for any sections it reads via `_assembled`, and a unique `outputKey`.
- [ ] Sync `docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json` (the seed) — the seed-sync test will fail otherwise.
- [ ] Update §4 master table here.

### Changing what a loader returns

- [ ] Audit every transform that consumes it (grep the loader name). Don't break the `__teachingDepth` hack — or fix it properly (see L1).
- [ ] Update the `buildComposeTrace` empty-reason text if the semantics changed.

### Changing data contracts

- [ ] Update the contract JSON in `docs-archive/bdd-specs/contracts/<name>.contract.json` and re-seed.
- [ ] Update §5 here, CONTENT-PIPELINE.md §3, and ENTITIES.md §3 in the same PR.
- [ ] `ContractRegistry` has a 30s TTL — local dev may need a restart to see changes.

---

## 9. Known landmines

| # | Landmine | Where | Status |
|---|----------|-------|--------|
| L1 | **`__teachingDepth` array-property hack** — Previously: `curriculumAssertions` loader stashed `teachingDepth` on the result array via `(result as any).__teachingDepth = teachingDepth;` then `transforms/teaching-content.ts::renderTeachingContent` read it back via the same cast. Any caller that mapped / filtered / spread the array dropped it silently. | `SectionDataLoader.ts::registerLoader("curriculumAssertions")` — now returns typed `CurriculumAssertionsLoaderResult { assertions, teachingDepth }` (`SectionDataLoader.ts:43-46`). | ✅ **FIXED via #814 story 2.** `teachingDepth` is now a typed sibling field on the loader result interface, surviving downstream array ops. `transforms/teaching-content.ts::renderTeachingContent` reads `loadedData.curriculumAssertions.teachingDepth` directly. Status confirmed during #1556 (S1 compose-section contract) — no further action. |
| L2 | **Isolated `PrismaClient` in the template compiler** — `PromptTemplateCompiler.ts` does `const prisma = new PrismaClient()` at module scope rather than importing the shared `lib/prisma::prisma` singleton. Means it has its own connection pool, sidesteps query logging instrumentation, and is not torn down between hot reloads in dev. | `PromptTemplateCompiler.ts` (module scope) | ⚠ OPEN. Fix: replace with `import { prisma } from "@/lib/prisma";`. Verify no test still mocks the local `PrismaClient` constructor before changing. |
| L3 | **`visualAids` historical leak** — `subjectId + mimeType` was the only filter; tutor-only docs (`COURSE_REFERENCE`, `LESSON_PLAN`, `QUESTION_BANK`, `POLICY_DOCUMENT`) leaked into the learner media palette. | `SectionDataLoader.ts::registerLoader("visualAids")` | ✅ **FIXED 2026-05-10** via `isTutorOnlyDocumentType` post-filter (see CONTENT-PIPELINE.md §8 L1). Allow-list over `DocumentType` so new tutor-only types are excluded by default. **Re-verify when adding new `DocumentType` enum values.** |
| L4 | **`subjectSources` cross-course metadata exposure** — no `playbookId` filter; surfaces `name` / `trustLevel` / `publisherOrg` of every source on any subject the playbook touches. | `SectionDataLoader.ts::registerLoader("subjectSources")` | ⚠ Documented intentional (metadata, not content); re-verify if you add a source-level field that's content-bearing. ENTITIES.md §9 E4. |
| L5 | **`filterSpecsByToggles` drops silently** — when `playbooks[0].config.systemSpecToggles[<id>].isEnabled === false`, the spec disappears from `loadedData.systemSpecs` with no log. Downstream `extractIdentitySpec` then can't find it. | `SectionDataLoader.ts::filterSpecsByToggles` | ⚠ OPEN. Add a `console.log("[compose] filtered spec: <slug>")` when filtering kicks in. |
| L6 | **Onboarding-flow override source precedence** — Playbook beats Domain beats Spec. Easy to mis-set when adding a playbook-level override and forgetting the domain has one too. | `transforms/pedagogy.ts::computeSessionPedagogy` (mirrored in `buildComposeTrace.ts`) | Documented. Use the `onboardingOverriddenByPlaybook` trace flag to debug. |
| L7 | **`AnalysisSpec.promptTemplate` Mustache compiler isolation** — `PromptTemplateCompiler.ts` runs outside `executeComposition`. It's used by `lib/prompt/compose-content-section.ts` and select pipeline runners; it does NOT participate in `buildComposeTrace`, so its outputs are invisible to the standard observability surface. | `PromptTemplateCompiler.ts` (consumed by `compose-content-section.ts`) | Documented. If you compose via template, log separately. |
| L8b | **`AnalysisSpec.isArchetype` discriminator** (#608-A) — the systemSpecs loader now filters `isArchetype: false`, so archetype templates (TUT-001, ADVISOR-001, GUIDE-001, MENTOR-001, FACILITATOR-001) never enter the resolved-spec snapshot via the SYSTEM IDENTITY fallback path. The defensive `continue` in `transforms/identity.ts::resolveSpecs` (#608-C) stays as belt-and-braces — if an operator forgets to set `isArchetype: true` on a custom archetype, runtime still skips it. Run `npx prisma migrate deploy` (or `/vm-cpp`) to apply the schema change; reseed identity archetypes (`prisma/seed-identity-archetypes.ts`) so the 5 system archetypes flip from `isArchetype=false` (column default) to `true`. | `prisma/schema.prisma::AnalysisSpec` + `SectionDataLoader.ts::registerLoader("systemSpecs")` | ✅ **STRUCTURALLY FIXED 2026-05-23** (#608-A). Audit counter `advisorInInputsSnapshot` drops to 0 for new prompts after seed runs. Historical ComposedPrompt rows with the leak in `inputs::text` still need a separate one-off cleanup. |
| L8 | **SYSTEM IDENTITY archetypes are templates, not fallbacks** — `ADVISOR-001`, `TUT-001`, `GUIDE-001`, `MENTOR-001`, `FACILITATOR-001` are seeded with `scope=SYSTEM` + `specRole=IDENTITY` so `mergeIdentitySpec()` can resolve them via `extendsAgent` inheritance. They MUST NOT enter the resolved-spec snapshot when a playbook has its own IDENTITY PlaybookItem. The `resolveSpecs()` outer loop guard short-circuits these candidates (#608-C); see also #608-A follow-up (`AnalysisSpec.isArchetype` schema field) which closes the gap structurally. | `transforms/identity.ts::resolveSpecs` | ✅ **FIXED 2026-05-23** (#608-C) — defensive `continue` in the SYSTEM-spec iteration. Audit counter `advisorInInputsSnapshot` (target 0) in `scripts/audit-epic-100.ts`. |
| L9 | **`computePreamble` criticalRules archetype variance** — the RETURNING_CALLER critical rule MUST vary by playbook `teachingMode`. Pre-#604 the with-curriculum branch hardcoded the recall-archetype rule ("ALWAYS review before new material") for every playbook regardless of mode — practice-archetype sessions (IELTS Prep Lab, IELTS Listening) opened with a criterion recall the learner usually failed. Code-side default `RETURNING_CALLER_BY_MODE` (typed `Record<TeachingMode, string>` so a new mode forces a compile error) lives in `lib/prompt/composition/defaults/critical-rules.ts` (#610 directory split). COMP-001 spec config can override per mode via `prompt_preamble.config.criticalRules.returningCallerByMode[mode]` — useful when a custom archetype wants the warm-up rule outside the practice mode label. | `transforms/preamble.ts::computePreamble` (read pattern mirrors `transforms/pedagogy-mode.ts:100-106`) | ✅ **FIXED 2026-05-23** (#604 + #610). Regression tests: `tests/lib/preamble-archetype.test.ts` (16 cases). |
| L10 | **Behavioural defaults must not live in `transforms/`** (Configuration-over-Code tenet, CLAUDE.md). Transforms hold pipeline mechanics — section assembly, filtering, dependency resolution, formatting. Behavioural content (rule strings, mode labels, instructions, anti-patterns) MUST live either in COMP-001 spec config (DB, operator-tunable) or in `lib/prompt/composition/defaults/` (code, thin fallback only). The audit counter `hardcodedRulesRemainingInTransforms` greps `transforms/` for tracked phrases — adding a behavioural string there fails CI step 6. When ‘code default’ is genuinely the right place (e.g. typed `Record<TeachingMode, T>` for compile-time exhaustiveness), import from `defaults/`; never inline. | `lib/prompt/composition/transforms/*` (the rule) + `lib/prompt/composition/defaults/*` (the exception) | ✅ **CONVENTION ESTABLISHED 2026-05-23** (#610). Audit counter `hardcodedRulesRemainingInTransforms` enforces. |

---

## 10. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. Fourth pillar alongside CONTENT-PIPELINE.md (classification), ENTITIES.md (model), WIZARD-DATA-BAG.md (inputs). Landmines L1–L3 promoted from `memory/flow-prompt-composition.md` after verification against current code. |
| 2026-05-23 | **§9 L8 — SYSTEM IDENTITY archetype non-fallback (#608-C).** Added landmine L8: archetypes seeded as `scope=SYSTEM, specRole=IDENTITY` for `extendsAgent` inheritance must not enter the resolved-spec snapshot when a playbook has its own IDENTITY PlaybookItem. `resolveSpecs()` outer loop hardened with a defensive `continue`. Structural follow-up (`AnalysisSpec.isArchetype` schema field) tracked as #608-A. |
| 2026-05-23 | **§9 L9 — preamble criticalRules archetype-aware (#604).** Added landmine L9: `computePreamble` RETURNING_CALLER rule now varies by playbook `teachingMode`. Code default `RETURNING_CALLER_BY_MODE` typed `Record<TeachingMode, string>` so a new mode forces a compile error. COMP-001 spec config carries an extension point at `prompt_preamble.config.criticalRules.returningCallerByMode[mode]` (initially populated for recall / comprehension / syllabus / practice). Counter `playbooksWithoutTeachingMode` (already in `scripts/audit-epic-100.ts`) flags playbooks where the new contract has no input. |
| 2026-05-23 | **§9 L10 — defaults/ directory convention (#610).** Code-side default for `RETURNING_CALLER_BY_MODE` lifted from `transforms/preamble.ts` into `lib/prompt/composition/defaults/critical-rules.ts`. New convention: behavioural content lives in spec config first, in `defaults/` second, never inline in `transforms/`. Audit counter `hardcodedRulesRemainingInTransforms` enforces this by greping the `transforms/` directory for tracked phrases — sibling `defaults/` is intentionally not scanned, so a transform that imports a default constant is not flagged. Counter drops 1 → 0 after this refactor. |
| 2026-06-20 | **§4 — `instructions.ts` mock-exam mode directive (#2013, epic #2009 S4).** `computeInstructions` now resolves a `module_mock_exam_directive` from `Playbook.config.modules[].mode`. When the locked module's `mode === "mock-exam"`, the directive frames the session as a board-chair scenario exam (4–6 probes, no MCQs, no mid-session teaching, per-LO per-dimension close). Appends a "prior mastery doesn't carry in" line when `Playbook.config.useFreshMastery === true` so AI narration matches the data-layer isolation contract at `Call.scratchMastery`. All other modes return null. Lattice survey confirmed `lib/curriculum/build-per-segment-measure-prompt.ts:122` (the IELTS examiner scoring prompt) is pipeline-gated and does NOT fire for CIO/CTO compose paths. Producer↔consumer pairing pinned by `coverage-producer-consumer.test.ts::PAIRS::module_mock_exam_directive`. |
| 2026-06-19 | **§4 — `instructions.ts` quiz-mode directive (#2011, epic #2009 S2).** `computeInstructions` now resolves a `module_quiz_directive` from `Playbook.config.modules[].mode`. When the locked module's `mode === "quiz"`, the directive reframes the session as a timed MCQ drill (8–12 questions from the per-Unit ContentQuestion bank). Non-quiz modes return null — byte-identical pre-PR output. MCQ infrastructure unchanged. Paired with renderer push in `renderPromptSummary.ts` (`parts.push(quizDirective.directive)` under "[QUIZ MODE]"); pairing pinned by `coverage-producer-consumer.test.ts::PAIRS::module_quiz_directive`. |
| 2026-05-25 | **§4 / §5 — Tolerance cascade resolver (#598 Slice 1).** New `lib/tolerance/resolve-tolerance.ts::resolveMasteryThreshold` (7-layer cascade per ADR 2026-05-22-tolerance-placement.md) replaces all 8 hardcoded `0.7` mastery-threshold reads in `transforms/modules.ts`. `computeSharedState` calls the resolver once and exposes the result on `sharedState.resolvedMasteryThreshold` for downstream transforms. New `PlaybookConfig.tolerances` + `PlaybookConfig.firstCall` field groups. Per-learner write path lives at `lib/tolerance/apply-learner-tolerances.ts` (upserts `CallerAttribute(scope=TOLERANCE)`, audited via `AuditAction.TOLERANCE_WRITE`). Three follow-up sites in `lib/prompt/compose-content-section.ts` (lines 603 / 641 / 709) marked with `TODO(#598 Slice 1 follow-up)` and intentionally NOT migrated — they sit in the structured-mode reader scheduled for replacement. Memories transform `applyDecay` accepts a course-level `memoryDecayScale`; scheduler-presets `getPresetForPlaybook` shallow-merges `retrievalCadenceOverride`; pedagogy + quickstart honour the new `firstCall.*` knobs on call 1. Default behaviour (absent tolerances / absent firstCall) is byte-identical to pre-PR output. |
