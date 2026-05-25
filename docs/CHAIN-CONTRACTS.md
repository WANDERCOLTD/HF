# Chain Contracts — Adaptive-Loop Stage Boundary Inventory

> **Read this before you touch any code that crosses an adaptive-loop stage boundary** (EXTRACT, SCORE_AGENT, AGGREGATE, REWARD, ADAPT, SUPERVISE, COMPOSE). One row per producer → consumer handoff. If a contract has no enforcement code path, no test, or no memory doc reference, that's a gap to fix — not a row to omit.
>
> Companion to:
> - [`docs/PIPELINE.md`](./PIPELINE.md) — the 7-stage pipeline mechanics.
> - [`docs/PROMPT-COMPOSITION.md`](./PROMPT-COMPOSITION.md) — COMPOSE-stage loaders + transforms.
> - [`docs/ENTITIES.md`](./ENTITIES.md) — the model layer (who-owns-what, who-can-see-what).
> - [`docs/CONTENT-PIPELINE.md`](./CONTENT-PIPELINE.md) — EXTRACT classification + audience filters.
> - [`docs/epic-100-chain-walk.md`](./epic-100-chain-walk.md) — the 2026-05-22 source walk that catalogued these contracts (Epic [#600](https://github.com/WANDERCOLTD/HF/issues/600)).

---

## 1. Why this doc exists

Every "implicit contract" bug in Epic 100 was a stage boundary where producer and consumer agreed on shape verbally (in commit messages, in someone's head) but not in code. Examples from the 2026-05-22 chain-walk:

| Bug | Producer | Consumer | What broke |
|---|---|---|---|
| Tutor directives rendered as quiz questions (#605) | EXTRACT (`categoryToTeachMethod`) | COMPOSE (loaders) | INSTRUCTION_CATEGORIES silently mapped to `teachMethod="recall_quiz"` via fallback. |
| Duplicate CONTENT AUTHORITY blocks (#607) | wizard `create_course` step 4b | COMPOSE (`subjects` loader) | Two parallel paths each linked a `PlaybookSubject`; DB `@@unique` blocks only same-subject pairs, not cross-subject coexistence. |
| ADVISOR-001 leak into IELTS prompts (#608) | SYSTEM-spec seed | `transforms/identity.ts::resolveSpecs` | Archetypes seeded as `scope=SYSTEM, role=IDENTITY` entered the IDENTITY-fallback pool. |
| Mastery loss between calls (#614) | AGGREGATE (`track-progress.ts`) | COMPOSE (`transforms/modules.ts`) | `lo_mastery` key form drifted (name vs slug); reader's tolerant matcher produced non-deterministic mastery. |
| Practice-archetype sessions opened with recall (#604) | code (`transforms/preamble.ts`) | LLM | RETURNING_CALLER rule hardcoded for recall archetype regardless of playbook `teachingMode`. |

**Rule of thumb:** *if you're adding a producer that writes data another stage will read, add a row here in the same PR. If you're tightening a reader, walk the producer rows first to confirm no legacy shapes still exist.*

---

## 2. The chain at a glance

```
COURSE (Playbook + Curriculum + LOs + Subjects)
   │
   ▼
LEARNER (Caller + Memories + Profile + Personality)
   │
   ▼
MEASURES (CallScore + LO mastery + parameters + targets)
   │
   ▼
PROMPTS (ComposedPrompt + transforms)
   │
   └──── next call ───────────► back to MEASURES
```

Six numbered links cross stage boundaries. Each has its own section in §3.

---

## 3. Stage boundary inventory

Format per link:
- **Producer** — code path that writes the contract output.
- **Consumer** — code path that reads it.
- **Data shape** — describes the contract; links to the `DataContract` slug if registered.
- **Enforcement** — guard/validator code path.
- **Test that pins it** — file:line.
- **Memory doc** — where the contract is documented for humans.

---

### Link 1 — COURSE → CONTENT (extraction)

| Field | Value |
|---|---|
| **Producer** | `lib/content-trust/extract-assertions.ts`, `lib/content-trust/extractors/base-extractor.ts` |
| **Consumer** | `lib/prompt/composition/SectionDataLoader.ts::registerLoader("curriculumAssertions"|"curriculumQuestions"|"courseInstructions")` |
| **Data shape** | `ContentAssertion` + `ContentQuestion` rows with `teachMethod`, `assessmentUse`, `learningObjectiveId`, `subjectSourceId`. Tutor-instruction rows MUST carry `teachMethod="tutor_instruction"` (#605 invariant I8 in ENTITIES.md). |
| **DataContract slug** | implicit — no DB-registered contract; enforced via TypeScript types + runtime invariants. |
| **Enforcement** | `lib/content-trust/resolve-config.ts::categoryToTeachMethod` (short-circuit on INSTRUCTION_CATEGORIES) + `assertNoLearnerMethodOnInstructionCategory` at extraction boundaries; loaders filter `TUTOR_ONLY` (`SectionDataLoader.ts::registerLoader("curriculumQuestions")`). |
| **Test** | `tests/lib/content-trust/category-to-teach-method.test.ts` (73 cases); `tests/lib/composition/loader-tutor-only.test.ts` (#606 regression). |
| **Memory doc** | `docs/ENTITIES.md` §6 invariants I1 (subjectSourceId), I8 (tutor_instruction); `docs/CONTENT-PIPELINE.md`. |
| **Audit counter** | `recallQuizOnInstructionCategories` (target 0), `tutorOnlyQuestionsLeakSurface` (informational). |
| **Reinforced by** | #605, #606. |

---

### Link 2 — CONTENT → CURRICULUM (LO linkage)

| Field | Value |
|---|---|
| **Producer** | `lib/content-trust/reconcile-lo-linkage.ts` (sets `ContentAssertion.learningObjectiveId`). |
| **Consumer** | `lib/curriculum/track-progress.ts`, AGGREGATE-stage mastery derivation. |
| **Data shape** | `ContentAssertion.learningObjectiveId` is a **nullable soft-FK** (`schema.prisma::model ContentAssertion`, no DB-level FK constraint). When non-null, MUST resolve to a live `LearningObjective`. |
| **DataContract slug** | implicit. |
| **Enforcement** | `reconcile-lo-linkage.ts` nulls dangling FKs on its cadence; `scripts/check-fk-consistency.ts::dangling-content-assertion-lo` catches lag (#615 CI step 5). |
| **Test** | `tests/lib/content-trust/reconcile-lo-linkage.test.ts`; FK consistency check is itself the verification surface. |
| **Memory doc** | `docs/ENTITIES.md` §6 (invariant I7 projection provenance); `.claude/rules/ai-to-db-guard.md` Existing Guards row for `check-fk-consistency.ts`. |
| **Audit counter** | `orphanLearningObjectives` (target 0), `danglingContentAssertionLOs` (target 0). |
| **Reinforced by** | #615. |

---

### Link 3 — CURRICULUM → CALL (compose)

| Field | Value |
|---|---|
| **Producer** | COMPOSE stage entry: `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.COMPOSE` and `app/api/callers/[callerId]/compose-prompt/route.ts`. |
| **Consumer** | LLM (via VAPI / sim chat / dry-run). |
| **Data shape** | `ComposedPrompt` row with `prompt` (markdown summary), `llmPrompt` (structured JSON), `inputs` snapshot, `model="deterministic"`, status `active`. Supersedes prior active rows for the same `(callerId, playbookId)`. |
| **DataContract slug** | implicit; COMP-001 spec defines section list + thresholds in `docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json`. |
| **Enforcement** | `executeComposition()` topo-sorts sections; `persistComposedPrompt()` enforces single-active-per-(caller, playbook); `transforms/identity.ts::resolveSpecs` filters SYSTEM IDENTITY archetypes (#608-C runtime + #608-A structural). |
| **Test** | `tests/lib/prompt/composition/identity-resolve-specs.test.ts` (9 cases for #608-C); `tests/lib/preamble-archetype.test.ts` (16 cases for #604); `tests/lib/composition/renderPromptSummary.test.ts`. |
| **Memory doc** | `docs/PROMPT-COMPOSITION.md` §3 loaders + §4 transforms + §9 landmines L8/L8b/L9/L10. |
| **Audit counter** | `advisorInInputsSnapshot` (target 0 after #608-A applies), `playbooksWithoutTeachingMode` (target 0 — operator data), `hardcodedRulesRemainingInTransforms` (target 0). |
| **Reinforced by** | #604, #607, #608-C, #608-A, #610, #819 (settings-change fan-out). |

#### Link 3 sub-contract — TUNER → COMPOSE (input-change propagation)

**Mechanism rewritten 2026-05-25 (#825 / EPIC #832): "fan-out on save" → "stamp on write, check on read".**

| Field | Value |
|---|---|
| **Producer** | Any helper that mutates a compose-affecting field (`Playbook.config`, `Domain.config`, `AnalysisSpec.config`, `BehaviorTarget`, `CallerTarget`, identity edits, curriculum / LO / assertion writes) bumps the corresponding `composeInputsUpdatedAt` on the scope row (`Playbook` / `Caller` / `Domain`) or the `SystemSetting` key `"compose_inputs_updated_at"`. |
| **Consumer** | `lib/compose/staleness.ts::isPromptStale` at `lib/enrollment/auto-compose.ts::autoComposeForCaller` and `app/api/callers/[callerId]/compose-prompt/route.ts` (when called within `skipIfFreshMs` window). Reads `ComposedPrompt.composedAt` vs the max of the upstream timestamps; recomposes when stale, serves cache when fresh. |
| **Invariant** | Every active caller's `ComposedPrompt` MUST reflect the latest compose-affecting inputs before their next call. Mechanism: **timestamps on scope rows; COMPOSE-entry-points read staleness and recompose if stale.** Null upstream timestamps are treated as epoch (never-stale); only a populated timestamp newer than `composedAt` makes a prompt stale. Output is byte-identical with eager-fan-out under deterministic composition. Educators see staleness via `<StalePromptPill />` (Story 7 #831) with a `[Recompose now]` action. |
| **Pipeline COMPOSE carve-out** | `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.COMPOSE` is INTENTIONALLY exempt from the staleness check — it runs at the END of every pipeline (after SCORE_AGENT / AGGREGATE / ADAPT / SUPERVISE have updated CallerAttribute / CallerMemory) and ALWAYS recomposes to incorporate just-produced scores. Pipeline-internal writes do NOT bump `composeInputsUpdatedAt` (carve-out in `lib/playbook/bump-timestamp.ts` per Story 6) — they're followed by pipeline COMPOSE which recomposes unconditionally. |
| **Enforcement** | Per-table ESLint rules (`hf-playbook/no-direct-config-write` etc., one per producer table — see Stories 2–8) block direct DB writes outside the helpers. Helpers diff against `COMPOSE_AFFECTING_KEYS` and bump on change. |
| **Race window** | INTENTIONAL. A write committing between `isPromptStale`'s read and `persistComposedPrompt`'s `composedAt` write is silently missed for one compose cycle. Self-heals on next save. Documented in `lib/compose/staleness.ts` file header. **Do NOT add row-level locks or serialise compose** — alternative fixes create queue-up-on-save problems that are objectively worse. If stronger guarantees needed, surface in UI (Story 7 pill). |
| **Test** | `tests/lib/compose/staleness.test.ts` (11 cases — null timestamps, each upstream source, domain skip, malformed system-setting fail-safe, strict >, parallel queries). |
| **Memory doc** | This row; `lib/compose/staleness.ts` file header (race-window rationale); per-helper file headers in `lib/playbook/`, `lib/domain/`, `lib/agent-tuner/` (Stories 2–8). |
| **Reinforced by** | #819 (initial fan-out attempt, superseded); #825 (foundation: schema + staleness check + autoComposeForCaller + compose-prompt wire-in); #826 (Playbook.config helper pivot); #827 (8 Playbook.config writers); #828 (Domain); #829 (AnalysisSpec); #830 (BehaviorTarget + CallerTarget + Caller identity); #831 (StalePromptPill UI); #834 (curriculum / LO / assertion writers). |
| **FK invariant — `BehaviorTarget(scope=CALLER)`** | `BehaviorTarget.callerIdentityId` references **`CallerIdentity.id`**, NOT `Caller.id`. (`prisma/schema.prisma:549` aliases this column via `@map("callerId")` — the original tripwire. See `docs/ENTITIES.md` invariant I10.) Resolvers and writers operating on per-learner BehaviorTarget rows MUST fan out via `prisma.caller.findUnique({ select: { callerIdentities } })` (or the dedicated helper `lib/agent-tuner/write-target.ts::resolveCallerIdentityIds`) and query with `callerIdentityId: { in: identityIds }`. Multi-identity tie-break is **MAX `targetValue`** so a higher per-identity override is never silently undercut. Canonical readers: `lib/tolerance/resolve-tolerance.ts::readCallerBehaviorTargetValue`. Canonical writer: `lib/agent-tuner/write-target.ts::writeCallerBehaviorTarget`. Caught by empirical repro (#836) — pre-fix, layer 1 of the mastery cascade was dead in prod. |

---

### Link 4 — CALL → TRANSCRIPT → SCORE (pipeline MEASURE/AGGREGATE)

| Field | Value |
|---|---|
| **Producer** | `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.SCORE_AGENT` then `stageExecutors.AGGREGATE`. |
| **Consumer** | ADAPT stage (mastery + next-module selection); COMPOSE reader (`transforms/modules.ts`). |
| **Data shape** | `CallScore` row with `(callId, parameterId, moduleId?)`, score ∈ [0,1], `hasLearnerEvidence`, `evidenceQuality`. `moduleId` MUST be the canonical `CurriculumModule.slug` (post-#611). |
| **DataContract slug** | `CURRICULUM_PROGRESS_V1` (`docs-archive/bdd-specs/contracts/CURRICULUM_PROGRESS_V1.contract.json`) — defines storage-key patterns for `lo_mastery:{moduleId}:{loRef}` keys. |
| **Enforcement** | `lib/curriculum/resolve-module.ts::resolveModuleSlug` canonicalises every AGGREGATE write; `track-progress.ts:174-185` refuses the write when slug cannot be resolved (rather than writing a corrupt key); evidence gate drops zero-evidence scores. |
| **Test** | `tests/lib/lo-mastery-key-migration.test.ts` (12 cases for parser + reader tolerance); `tests/curriculum/track-progress.test.ts`. |
| **Memory doc** | `docs/PROMPT-COMPOSITION.md` reader grace-window comment block at `transforms/modules.ts:687`. |
| **Audit counter** | `dualLoMasteryKeysSameLO` (informational — drains via #614), `callScoreZeroStorms` (informational), `callerAttributeOldKeyFormCount` (target 0 after #614 `--apply`). |
| **Reinforced by** | #611 (Fix A canonicalisation, Fix B evidence gate, Fix C priorCallFeedback), #614 (historical drain). |

---

### Link 5 — SCORE → AGGREGATE → ADAPT (mastery tracking)

| Field | Value |
|---|---|
| **Producer** | AGGREGATE-stage mastery accumulation (consumes `CallScore` rows). |
| **Consumer** | ADAPT-stage module selection (`lib/curriculum/working-set-selector.ts`, `lib/pipeline/scheduler-decision.ts`). |
| **Data shape** | Per-LO mastery in `CallerAttribute` (`scope="CURRICULUM"`, `valueType="NUMBER"`, `key` matching the `lo_mastery:{moduleId}:{loRef}` pattern). |
| **DataContract slug** | `CURRICULUM_PROGRESS_V1` (same as Link 4 — they share the key-shape contract). |
| **Enforcement** | Conflict-merge via `MAX(numberValue)` in #614 drain script; `validUntil = NOW()` for soft-delete; tolerant `includes(':lo_mastery:')` reader during grace window. |
| **Test** | `tests/lib/lo-mastery-key-migration.test.ts` reader-tolerance pin. |
| **Memory doc** | `.claude/rules/ai-to-db-guard.md` Existing Guards row for `resolveModuleSlug` + drain script pair. |
| **Audit counter** | `callerAttributeOldKeyFormCount` (target 0 after `--apply`). |
| **Reinforced by** | #611, #614. |

---

### Link 6 — ADAPT → COMPOSE (loop closure)

| Field | Value |
|---|---|
| **Producer** | ADAPT writes to `CallerAttribute` (mastery + memory keys); LEARN writes to `CallerMemory`. |
| **Consumer** | Next COMPOSE call's `loadAllData()` — `callerAttributes` + `memories` loaders. |
| **Data shape** | `CallerAttribute` rows must use canonical slug-form keys (Link 4 / Link 5 contract); `CallerMemory` rows must respect domain scoping. |
| **DataContract slug** | `CURRICULUM_PROGRESS_V1` (mastery); implicit (memory). |
| **Enforcement** | Tolerant reader at `transforms/modules.ts:702` + `transforms/retrieval-practice.ts:71` accepts both key forms during #614 grace window; `validUntil` filter excludes soft-deleted rows. |
| **Test** | `tests/lib/lo-mastery-key-migration.test.ts` grace-window section. |
| **Memory doc** | `docs/PROMPT-COMPOSITION.md` reader comments at the two callsites. |
| **Audit counter** | `dualLoMasteryKeysSameLO` (informational), `callerAttributeOldKeyFormCount` (target 0 after #614). |
| **Reinforced by** | #614 + reader-tightening follow-on (post-drain). |

---

## 4. DataContract registry

The runtime DataContract registry (`lib/contracts/`) is the DB-backed source of truth for storage-key patterns. Contract files live in `apps/admin/docs-archive/bdd-specs/contracts/` and are seeded into `DataContract` rows on `db:seed`.

Active contract slugs (verified against `docs-archive/bdd-specs/contracts/` 2026-05-23):

| Slug | Purpose | Used by Link |
|---|---|---|
| `CURRICULUM_PROGRESS_V1` | `lo_mastery:{moduleId}:{loRef}` key pattern + module-mastery storage | 4, 5, 6 |
| `LEARNER_PROFILE_V1` | Cross-call learner profile aggregation | (not in chain — separate path) |
| `CONTENT_TRUST_V1` | `ContentSource.trustLevel` enum + override semantics | 1 (indirect) |
| `ENTITY_ACCESS_V1` | RBAC scoping contracts | (cross-cutting) |
| `SESSION_TYPES_V1` | Session-type enum + flow markers | 3 |
| `SKILL_MEASURE_V1` | Skill-parameter measurement shape | 4 |
| `ONBOARDING_ASSESSMENT_V1` | First-call assessment shape | 3 (first-call path) |
| `EXAM_READINESS_V1` | Pre-exam readiness scoring | 5 |
| `TERMINOLOGY_V1` | Institution-type terminology preset | (cross-cutting) |
| `SURVEY_TEMPLATES_V1` | Periodic survey question shape | (separate path) |

If a chain row above references "DataContract slug: implicit" and the contract is load-bearing for safety, that's a gap — file an issue to register it.

---

## 5. Recent reinforcements (Epic 100, 2026-05-22 → 2026-05-23)

| PR | Story | Link affected | What changed |
|---|---|---|---|
| #646 | #631 | (harness) | Audit script + golden caller + behaviour evals + sim proof + CI step 6 |
| #648 | #606 | 1 | TUTOR_ONLY loader filter |
| #650 | #611 | 4 | MEASURE/AGGREGATE canonical moduleId + universal evidence gate + module-scoped priorCallFeedback (monolithic) |
| #659 | (harness fixup) | (harness) | Audit counters honest — invariant vs informational |
| #664 | #605 | 1 | INSTRUCTION_CATEGORIES → `tutor_instruction` (no recall_quiz bleed) |
| #665 | #607 | 1, 3 | One primary PlaybookSubject per playbook (wizard unlink + cleanup script) |
| #666 | #608-C | 3 | SYSTEM IDENTITY fallback guard in `resolveSpecs` |
| #667 | #604 | 3 | Preamble RETURNING_CALLER archetype-aware |
| #668 | #614 | 4, 5, 6 | Drain script for legacy lo_mastery name-form keys |
| #669 | #615 | 2 | CI step 5: orphan-LO + dangling-CA-LO checks |
| #670 | #610 | 3 | `defaults/` directory convention — transforms hold mechanics, content lives elsewhere |
| #671 | #608-A | 3 | `AnalysisSpec.isArchetype` schema field + loader filter |
| #672 | #616 | (this doc) | Single inventory of chain contracts |
| TBD  | #819 | 3 (sub-contract) | PUT /api/courses/[id]/design fans out recompose-all when COMPOSE-affecting namespaces change — closes the stale-prompt-after-tuner-save gap |

---

## 6. Pre-change checklist

### Adding a new producer
- [ ] Identify which link this write crosses. Update the Producer cell in §3.
- [ ] If the data shape is non-obvious, register a DataContract slug in `lib/contracts/` and seed via `docs-archive/bdd-specs/contracts/`.
- [ ] Add enforcement at the boundary — either via the guard pattern in `.claude/rules/ai-to-db-guard.md` (for AI-driven writes) or via a deterministic validator (for code-driven writes).
- [ ] Add an audit counter to `apps/admin/scripts/audit-epic-100.ts` if the contract has a clear "this MUST be 0" invariant.
- [ ] Add a vitest covering the contract; link from §3.

### Tightening a reader
- [ ] Confirm the audit counter for legacy shapes reads 0 in dev/test/prod before tightening.
- [ ] If there's a drain script (e.g. #614's), confirm `--apply` ran on every env.
- [ ] Update the reader's comment block to reference the drain + counter.
- [ ] Add a regression test for both pre- and post-tightening shapes if a grace window applies.

### Touching a stage boundary
- [ ] Walk the relevant link section in §3 first.
- [ ] If you find the row stale (test path moved, memory doc renamed), update in the same PR.

---

## 7. Change log

| Date | Change |
|---|---|
| 2026-05-23 | Initial canonical inventory created post-Epic 100 (#616). Captures the 6 chain links + active DataContract slugs + the 13 Epic 100 PRs that reinforced them. |
| 2026-05-26 | **Link 3 — `BehaviorTarget(scope=CALLER)` FK invariant row added (#836).** Documents that `BehaviorTarget.callerIdentityId` references `CallerIdentity.id`, NOT `Caller.id` (the column is `@map("callerId")` aliased — see `docs/ENTITIES.md` invariant I10). Resolvers must fan out via the caller's `callerIdentities[]` relation and pick MAX `targetValue` across identities. Caught empirically via the #598 Slice 1 follow-up demo on hf_sandbox: pre-fix, the mastery cascade's layer 1 (per-learner adaptive override) was dead in prod because `lib/tolerance/resolve-tolerance.ts` was passing `Caller.id` into a column that joins on `CallerIdentity.id`. Fix split the previous `readBehaviorTargetValue` into per-scope helpers so the CALLER branch can encode the fanout. |
| 2026-05-25 | **Link 3 sub-contract — Caller-scope bumps landed (#830, Story 6/8).** `lib/compose/bump-timestamp.ts` exports `bumpPlaybookComposeTimestamp(playbookId)` and `bumpCallerComposeTimestamp(callerId)` — atomic single-column UPDATEs (P2025-tolerant) used by out-of-band compose-affecting writers. Wired into: `lib/agent-tuner/write-target.ts::writeBehaviorTarget` (playbook bump on successful PLAYBOOK-scope target write/remove), `writeCallerBehaviorTarget` (caller bump on successful CALLER-scope target write/remove), `app/api/calls/[callId]/ops/[opId]/route.ts` (caller bump on out-of-band LEARN memory writes), `app/api/goals/[goalId]/confirm/route.ts` (caller bump on goal confirm/dismiss — goals read by COMPOSE renderPromptSummary / simple / offboarding transforms), `app/api/student/assessment/route.ts` (caller bump on PRE/POST_TEST submission — pre-test score read by COMPOSE quickstart transform), `app/api/callers/[callerId]/route.ts` PATCH (caller bump on name/domain/role edits — caller name read by COMPOSE quickstart for the strip-name-questions logic). **Pipeline-internal writers excluded** by design: pipeline COMPOSE runs at the end of every pipeline invocation, so mid-pipeline bumps would set a timestamp later than the upcoming `ComposedPrompt.composedAt`, producing a spurious "not stale" verdict on the NEXT call. |
| 2026-05-25 | **Link 3 sub-contract — AnalysisSpec writer landed (#829, Story 5/8).** `lib/analysis-spec/update-analysis-spec-config.ts::updateAnalysisSpecConfig` is now the central writer for compose-affecting `AnalysisSpec` fields (`config`, `promptTemplate`, `isActive`, `scope`, `specRole`, `extendsAgent`). Routes the timestamp bump per spec scope: `SYSTEM` → `SystemSetting "compose_inputs_updated_at"` (global — every caller stale on next call), `DOMAIN` → `Domain.composeInputsUpdatedAt` when `domainId` option is supplied (warns + skips otherwise), `CALLER` → no-op. ESLint rule `hf-spec/no-direct-config-write` (severity error) blocks direct `prisma.analysisSpec.update({data:{config\|...:...}})` outside the helper + allowlist (seeds, scripts, recompile/triggers routes, content-trust sync, curriculum enricher). Migrated 4 sites: `app/api/analysis-specs/[specId]/route.ts` PUT + PATCH, `app/api/specs/[specId]/route.ts` PATCH, `lib/chat/admin-tool-handlers.ts::handleUpdateSpecConfig` (Cmd+K). The wizard course-identity upsert at `lib/chat/wizard-tool-executor.ts` is CREATE-only and inherits staleness via the linking Playbook write. One ESLint-disable retained at `lib/domain/generate-content-spec.ts::patchContentSpecForContract` (writer accepts TxClient; helper can't enlist in interactive tx — TODO #834). |
