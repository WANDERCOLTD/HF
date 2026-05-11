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
| `__teachingDepth` array-property hack | ongoing | `SectionDataLoader.ts::registerLoader("curriculumAssertions")` stashes `teachingDepth` on the result array via `(result as any).__teachingDepth = ...`. Only `transforms/teaching-content.ts::renderTeachingContent` knows to read it. Any future caller that maps/filters the array silently drops it. |
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

### 3.1 `resolveContentScope` — three-tier resolution

`SectionDataLoader.ts::resolveContentScope` runs ONCE per composition and is shared via `loaderConfig.contentScope` to the five content loaders above (`subjectSources`, `curriculumAssertions`, `curriculumQuestions`, `curriculumVocabulary`, `courseInstructions`, `visualAids`).

Order:

1. **Resolved single playbook** — `resolvePlaybookId(callerId)` returns one course → `getSubjectsForPlaybook(playbookId, domainId)`. Sets `scoped: true`, populates `playbookId`.
2. **Union of all enrolled playbooks** — when ≥1 `CallerPlaybook ACTIVE` exists but the resolver didn't pick one. PRIMARY: `PlaybookSource` rows for those playbookIds (post-2026-04-17 boundary). FALLBACK within this tier: legacy `Subject → SubjectSource` chain. `scoped: true`.
3. **Domain-wide last resort** — no enrollments at all → all `SubjectDomain` rows for `caller.domainId`. `scoped: false`. **Intentional for unenrolled previewing, structurally leaky for multi-course domains** (ENTITIES.md §4.3, E8).

Anti-bleed invariant: when `subjectSourceIds` is non-empty, `curriculumAssertions` uses a strict `subjectSourceId IN (…)` filter with **no null fallback**. Adding `OR subjectSourceId IS NULL` revives Leak B (ENTITIES.md §9, E2).

---

## 4. Transforms — master table

All declared in `transforms/*.ts` via `registerTransform("<name>", fn)`. `CompositionExecutor.ts` imports each file so the registry self-populates at module load. A section's `transform` field references the registered name; arrays are chained left-to-right.

| File | Registered transform(s) | Mutates `context.sections.<outputKey>` | Source-of-state inputs |
|------|-------------------------|----------------------------------------|------------------------|
| `personality.ts` | `mapPersonalityTraits` | `personality` | `loadedData.personality` |
| `memories.ts` | `deduplicateAndGroupMemories`, `deduplicateMemories`, `groupMemoriesByCategory`, `scoreMemoryRelevance` | `memories` | `loadedData.memories` |
| `targets.ts` | `mergeAndGroupTargets` | `behaviorTargets` | `loadedData.behaviorTargets` + `callerTargets` |
| `modules.ts` | `computeModuleProgress` (+ `computeSharedState` helper used pre-section-loop) | `curriculum` | `_assembled`; reads `CallerModuleProgress` directly (non-blocking) |
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
| `pedagogy.ts` | `computeSessionPedagogy` | `instructions_pedagogy` | `_assembled` — picks onboardingFlowSource: Playbook → Domain → Spec |
| `offboarding.ts` | `computeOffboarding` | `offboarding` | `_assembled` — gated by `sharedState.isFinalSession` |
| `voice.ts` | `computeVoiceGuidance` | `instructions_voice` | `_assembled` + `resolvedSpecs.voiceSpec` |
| `instructions.ts` | `computeInstructions` | `instructions` | `_assembled` (depends on every prior content / pedagogy / voice section) |
| `actions.ts` | `formatActions` | (embedded inside `instructions`) | `loadedData.openActions` |
| `quickstart.ts` | `computeQuickStart` | `_quickStart` | `_assembled` (caller_info + memories + targets + curriculum + goals + identity) |
| `preamble.ts` | `computePreamble` | `_preamble` | `_assembled` (identity only) |

`_quickStart` and `_preamble` are prefixed with `_` so the executor strips them from the final `llmPrompt` JSON output — they're consumed by `instructions.ts` and `renderPromptSummary.ts` but not exposed as top-level sections.

---

## 5. Data contracts gate

The composition layer uses contracts indirectly. The hard gates:

| Gate | Where | Contract / source |
|------|-------|-------------------|
| Module extraction shape | `transforms/modules.ts::computeSharedState` | `CURRICULUM_PROGRESS_V1` contract (see `lib/prompt/compose-content-section.ts` which calls `ContractRegistry.getContract`). Drives `metadata.curriculum.moduleSelector` and storage key pattern. |
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
| L1 | **`__teachingDepth` array-property hack** — `curriculumAssertions` loader stashes `teachingDepth` on the result array via `(result as any).__teachingDepth = teachingDepth;` then `transforms/teaching-content.ts::renderTeachingContent` reads it back via the same cast. Any caller that maps / filters / spreads the array drops it silently. | `SectionDataLoader.ts::registerLoader("curriculumAssertions")` (read in `transforms/teaching-content.ts::renderTeachingContent`) | ⚠ OPEN — tech debt. Proper fix: thread `teachingDepth` through a typed field on `LoadedDataContext` (e.g. `curriculumMeta.teachingDepth`) or pass via section `config`. Documenting; do NOT fix in this PR. |
| L2 | **Isolated `PrismaClient` in the template compiler** — `PromptTemplateCompiler.ts` does `const prisma = new PrismaClient()` at module scope rather than importing the shared `lib/prisma::prisma` singleton. Means it has its own connection pool, sidesteps query logging instrumentation, and is not torn down between hot reloads in dev. | `PromptTemplateCompiler.ts` (module scope) | ⚠ OPEN. Fix: replace with `import { prisma } from "@/lib/prisma";`. Verify no test still mocks the local `PrismaClient` constructor before changing. |
| L3 | **`visualAids` historical leak** — `subjectId + mimeType` was the only filter; tutor-only docs (`COURSE_REFERENCE`, `LESSON_PLAN`, `QUESTION_BANK`, `POLICY_DOCUMENT`) leaked into the learner media palette. | `SectionDataLoader.ts::registerLoader("visualAids")` | ✅ **FIXED 2026-05-10** via `isTutorOnlyDocumentType` post-filter (see CONTENT-PIPELINE.md §8 L1). Allow-list over `DocumentType` so new tutor-only types are excluded by default. **Re-verify when adding new `DocumentType` enum values.** |
| L4 | **`subjectSources` cross-course metadata exposure** — no `playbookId` filter; surfaces `name` / `trustLevel` / `publisherOrg` of every source on any subject the playbook touches. | `SectionDataLoader.ts::registerLoader("subjectSources")` | ⚠ Documented intentional (metadata, not content); re-verify if you add a source-level field that's content-bearing. ENTITIES.md §9 E4. |
| L5 | **`filterSpecsByToggles` drops silently** — when `playbooks[0].config.systemSpecToggles[<id>].isEnabled === false`, the spec disappears from `loadedData.systemSpecs` with no log. Downstream `extractIdentitySpec` then can't find it. | `SectionDataLoader.ts::filterSpecsByToggles` | ⚠ OPEN. Add a `console.log("[compose] filtered spec: <slug>")` when filtering kicks in. |
| L6 | **Onboarding-flow override source precedence** — Playbook beats Domain beats Spec. Easy to mis-set when adding a playbook-level override and forgetting the domain has one too. | `transforms/pedagogy.ts::computeSessionPedagogy` (mirrored in `buildComposeTrace.ts`) | Documented. Use the `onboardingOverriddenByPlaybook` trace flag to debug. |
| L7 | **`AnalysisSpec.promptTemplate` Mustache compiler isolation** — `PromptTemplateCompiler.ts` runs outside `executeComposition`. It's used by `lib/prompt/compose-content-section.ts` and select pipeline runners; it does NOT participate in `buildComposeTrace`, so its outputs are invisible to the standard observability surface. | `PromptTemplateCompiler.ts` (consumed by `compose-content-section.ts`) | Documented. If you compose via template, log separately. |

---

## 10. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. Fourth pillar alongside CONTENT-PIPELINE.md (classification), ENTITIES.md (model), WIZARD-DATA-BAG.md (inputs). Landmines L1–L3 promoted from `memory/flow-prompt-composition.md` after verification against current code. |
