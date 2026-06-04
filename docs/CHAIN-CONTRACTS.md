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
| **Pipeline COMPOSE carve-out** | `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.COMPOSE` is INTENTIONALLY exempt from the staleness check — it runs at the END of every pipeline (after SCORE_AGENT / AGGREGATE / ADAPT / SUPERVISE have updated CallerAttribute / CallerMemory) and ALWAYS recomposes to incorporate just-produced scores. Pipeline-internal writes do NOT bump `composeInputsUpdatedAt` (carve-out in `lib/compose/bump-timestamp.ts` per Story 6) — they're followed by pipeline COMPOSE which recomposes unconditionally. |
| **Enforcement** | Per-table ESLint rules (`hf-playbook/no-direct-config-write` etc., one per producer table — see Stories 2–8) block direct DB writes outside the helpers. Helpers diff against `COMPOSE_AFFECTING_KEYS` and bump on change. |
| **Race window** | INTENTIONAL. A write committing between `isPromptStale`'s read and `persistComposedPrompt`'s `composedAt` write is silently missed for one compose cycle. Self-heals on next save. Documented in `lib/compose/staleness.ts` file header. **Do NOT add row-level locks or serialise compose** — alternative fixes create queue-up-on-save problems that are objectively worse. If stronger guarantees needed, surface in UI (Story 7 pill). |
| **Test** | `tests/lib/compose/staleness.test.ts` (11 cases — null timestamps, each upstream source, domain skip, malformed system-setting fail-safe, strict >, parallel queries). |
| **Memory doc** | This row; `lib/compose/staleness.ts` file header (race-window rationale); per-helper file headers in `lib/playbook/`, `lib/domain/`, `lib/agent-tuner/` (Stories 2–8). |
| **Reinforced by** | #819 (initial fan-out attempt, superseded); #825 (foundation: schema + staleness check + autoComposeForCaller + compose-prompt wire-in); #826 (Playbook.config helper pivot); #827 (8 Playbook.config writers); #828 (Domain); #829 (AnalysisSpec); #830 (BehaviorTarget + CallerTarget + Caller identity); #831 (StalePromptPill UI); #834 (curriculum / LO / assertion writers). |
| **FK invariant — `BehaviorTarget(scope=CALLER)`** | `BehaviorTarget.callerIdentityId` references **`CallerIdentity.id`**, NOT `Caller.id`. (`prisma/schema.prisma:549` aliases this column via `@map("callerId")` — the original tripwire. See `docs/ENTITIES.md` invariant I10.) Resolvers and writers operating on per-learner BehaviorTarget rows MUST fan out via `prisma.caller.findUnique({ select: { callerIdentities } })` (or the dedicated helper `lib/agent-tuner/write-target.ts::resolveCallerIdentityIds`) and query with `callerIdentityId: { in: identityIds }`. Multi-identity tie-break is **MAX `targetValue`** so a higher per-identity override is never silently undercut. Canonical readers: `lib/tolerance/resolve-tolerance.ts::readCallerBehaviorTargetValue`. Canonical writer: `lib/agent-tuner/write-target.ts::writeCallerBehaviorTarget`. Caught by empirical repro (#836) — pre-fix, layer 1 of the mastery cascade was dead in prod. |

#### Link 3a — Authoring-side read parity for cascaded values

**Sister contract to Link 3's FK invariant: the runtime resolver is canonical; the authoring UI must read through it too.**

| Field | Value |
|---|---|
| **Producer** | The cascade layers themselves: `BehaviorTarget(scope=PLAYBOOK)` + `Playbook.config` (Bucket 1, course-level), `BehaviorTarget(scope=CALLER)` + `CallerAttribute(scope=TOLERANCE)` (Bucket 3, per-learner). Written by `lib/agent-tuner/write-target.ts`, `lib/playbook/update-playbook-config.ts`, etc. |
| **Consumer** | Any UI surface that *displays* a scope-cascaded value for a SYSTEM→PLAYBOOK→CALLER pipeline parameter. Today: `apps/admin/components/callers/caller-detail/PromptTunerSidebar.tsx` (#911 target). |
| **Invariant** | Authoring surfaces MUST read via the canonical resolver in `lib/tolerance/resolve-tolerance.ts` (or a thin bulk wrapper composed against the same primitives — `lib/tolerance/getEffectiveBehaviorTargetsForCaller`, landing in #911). Ad-hoc two-endpoint fetches that merge cascade layers in-component are forbidden. The runtime adaptive loop already reads through `resolve-tolerance.ts`; the authoring UI deviating means the educator can see a stale value while the loop reads the correct one. |
| **Enforcement** | (1) `apps/admin/scripts/audit-epic-100.ts` counter `authoringBehTargetBypassCount` — static grep over `apps/admin/components/**/*.{ts,tsx}` for files containing BOTH `/api/playbooks/[id]/targets` AND `/api/callers/[id]/behavior-targets` (or `/effective-behavior-targets`) patterns AND not importing from `@/lib/tolerance/resolve-tolerance` or `@/lib/tolerance/getEffectiveBehaviorTargetsForCaller`. Today: 1 (Tune sidebar). After #911 lands: 0. (2) `.claude/agents/arch-checker.md` Check F — same condition surfaced at review time. Soft warning until #911 fixes the existing violation; promote to error once counter reads 0. |
| **Test** | `tests/scripts/audit-epic-100-authoring-bypass.test.ts` (smoke test confirming the counter surfaces a numeric value and respects the import-allowlist) — landing with the counter in this PR. Resolver-parity vitest lands with #911. |
| **Memory doc** | This row; `docs/decisions/2026-05-22-tolerance-placement.md` (cascade resolution order — Section 'Cascade resolution order'); `docs/decisions/2026-05-26-tray-model-a-semantics.md` (sibling Model A ADR — surfaced in same debugging session). |
| **Reinforced by** | Empirical 2026-05-26 — `PromptTunerSidebar.tsx:940` rendered `p.effectiveValue` from `/api/playbooks/[id]/targets` and ignored the separately-fetched `learnerOverrides`. After a learner-scope save the sidebar continued to show the course-level value because the in-component merge never re-ran. Epic #909, PR 1 (#910) lands the contract + audit + arch-checker rule; PR 2 (#911) fixes the violation; PR 3 (#912) renames the tray labels under the sibling ADR. |

#### Link 3 sub-contract — AI write paths (registry + capability inventory)

**Every AI surface that can mutate compose-affecting state MUST declare its tools in a registry; the human-readable index is auto-derived and CI-gated.**

| Field | Value |
|---|---|
| **Producer** | Three AI tool registries: `apps/admin/lib/chat/admin-tools.ts` (Cmd+K admin chat, 33 tools), `apps/admin/lib/chat/conversational-wizard-tools.ts` (course-creation wizard, 10 tools), `apps/admin/lib/chat/course-ref-tools.ts` (course-reference chat, 5 tools). Each registry is read by the AI directly at every chat turn; the registries are the **canonical source of truth** for "what can the AI do?". |
| **Consumer** | (a) The AI's tool-call planner — refuses to invent calls outside the registry. (b) `apps/admin/scripts/generate-ai-capabilities.ts` — walks all three registries + the `TOOL_MIN_ROLE` map in each registry's handler and writes `docs/AI-CAPABILITIES.md`. (c) Humans reading `docs/AI-CAPABILITIES.md` for the inventory. |
| **Invariant** | (1) Every AI write path is declared in one of the three registries. (2) Every entry has a `TOOL_MIN_ROLE` entry in its handler (Cmd+K + Course-Ref); wizard tools are gated at the route layer. (3) Every NOT YET AVAILABLE tool carries the `NOT YET AVAILABLE — ` prefix in its description AND is listed in `NOT_YET_AVAILABLE_TOOLS`. (4) Every compose-affecting write inside a handler routes through a `update*Config` helper or calls a `bump*ComposeTimestamp` helper — direct `prisma.{playbook,domain,analysisSpec}.update` is blocked by ESLint rules `hf-playbook/no-direct-config-write`, `hf-domain/no-direct-onboarding-write`, `hf-spec/no-direct-config-write` (severity `error`). (5) `docs/AI-CAPABILITIES.md` is auto-derived — CI fails on drift. |
| **Shared writer plumbing** | All three AI surfaces converge on the same set of compose-stamping helpers: `lib/playbook/update-playbook-config.ts`, `lib/domain/update-domain-config.ts`, `lib/analysis-spec/update-analysis-spec-config.ts`, `lib/agent-tuner/write-target.ts`, `lib/compose/bump-timestamp.ts`. **A change to any helper benefits every surface automatically** — the registries are presentation, not duplication. |
| **Stub semantics** | Tools marked `NOT YET AVAILABLE` route to `handleNotYetAvailable(toolName)` which returns `{ ok: false, not_yet_available: true, tool, message }`. The schema description carries the **verbatim** line the AI should say to the user + the UI surface to fall back to. The AI never silently invents capabilities; promotion is a 4-step inline checklist. |
| **Enforcement** | `npm run docs:ai-capabilities:check` (CI step in `.github/workflows/test.yml`) — exits 1 on drift between any registry and the generated doc. Sibling-style to `docs:knowledge-map:ci` / `docs:health:ci` / `docs:citations:ci`. ESLint rules above block direct compose-affecting writes outside the helpers. |
| **Test** | `tests/lib/admin-tools.test.ts` (RBAC + handler shape, 40 cases), `tests/lib/admin-tools-coverage-gaps.test.ts` (10 cases — domain compose fields, curriculum module, LO link, goal confirm/dismiss), `tests/lib/admin-tools-read-parity.test.ts` (14 cases — reads + recompose), `tests/lib/admin-tools-not-yet-available.test.ts` (25 cases — stub schema presence, NOT YET AVAILABLE prefix, payload shape, RBAC ordering). |
| **Memory doc** | `docs/AI-CAPABILITIES.md` (auto-derived inventory — never edit by hand); promotion checklist inline at the top of `admin-tools.ts`'s NOT YET AVAILABLE section. |
| **Reinforced by** | #852 (Cmd+K coverage gaps closed), #859 (Cmd+K read-parity + 3 more edits), #862 (NOT YET AVAILABLE stubs), #866 (auto-derive AI-CAPABILITIES.md from Cmd+K registry), #867 (CI drift guard), and this row's expansion (auto-derive all three registries). |
| **One known eslint-disable** | `lib/domain/generate-content-spec.ts::patchContentSpecForContract` — accepts a `TxClient` and cannot enlist in the helper's interactive tx. TODO(#834). All other compose-affecting writers route through helpers; verified by ESLint `--no-warnings` on the four `hf-*` rules. |

#### Link 3 sub-contract — COMPOSE → LLM (output invariants)

**Added 2026-06-03 (#1008 / closes #1006). Five output invariants enforced inside `executeComposition` before `persistComposedPrompt`. Source: confirmed hallucination on caller `e1df05fa-9c85-4972-9bbe-b13e52784841` (Maya, IELTS Prep Lab). ComposedPrompt `cd8e2995-5eca-45c2-9b96-64f5b9a48bc0` fabricated Part 1 progress because the prompt simultaneously locked focus to Part 2, told the AI to spaced-retrieve Part 1, asked it to "reference last session specifically", and supplied `key_memories: null`. Same anti-pattern class as #605 (`categoryToTeachMethod` fallback) and #608 (SYSTEM IDENTITY fallback) — silent code-side defaults masking missing data.**

| Field | Value |
|---|---|
| **Producer** | All transforms under `lib/prompt/composition/transforms/**` + every loader registered via `SectionDataLoader.registerLoader`. |
| **Consumer** | The LLM (via VAPI / sim chat / dry-run). |
| **I-C1 Module-lock honoured** | When `Call.requestedModuleId` is set, `Curriculum.current` MUST equal that module AND `pedagogy.flow.moduleToReview` MUST equal the **last actually-touched module** from `CallerModuleProgress`, never catalogue-order index 0. Closes the #1006 "spaced-retrieve Part 1 even though learner locked Part 2" failure mode. |
| **I-C2 Call-counter coherence** | Every `(call #N)` or `"This is call N"` reference in the same prompt MUST resolve to the same N, derived from `sharedState.callNumber = data.callCount + 1`. The raw `loadedData.callCount` (count of ENDED calls at compose time) is debug-only; `quickstart.this_caller` and every other surface read `sharedState.callNumber`. Empty-state default uses `?? 1`, NOT `\|\| 1`. |
| **I-C3 No memory-less reminisce** | When `key_memories === null` AND `priorCallFeedback.hasFeedback === false`, NO transform may emit any of: `"reference last session"`, `"as we covered"`, `"pick up where we left off"`, `"remember from before"`, `"reference the learning journey so far"`. The advisory rule in `transforms/preamble.ts::criticalRules` is promoted into a hard pre-persist gate. |
| **I-C4 No generic-noun fallback in instructions** | No template literal in `lib/prompt/composition/transforms/**` may emit `${x?.name \|\| "previous concept"}` / `"old"` / `"new material"` / `"next concept"` / `"first concept"` / `"previous"` as a fallback for missing data. **Drop the line instead** of filling with a generic noun — generic nouns are fabrication invitations. ESLint-enforced via `hf-compose/no-orphan-instruction-fallback`. |
| **I-C5 `estimatedProgress` heuristic is debug-only** | `lastCompletedIndex` MUST be derived from real `CallerModuleProgress` rows whenever the caller's playbook has a `curriculumId`. The `pbConfig.modulesAuthored === true` gate is **removed**: courses with a `curriculumId` always read `CallerModuleProgress`. The legacy `estimatedProgress = recentCalls.length / 2` heuristic remains in `computeSharedState` for trace-debugging only and MUST NOT be read by any other transform. |
| **Enforcement** | (1) Build-time: ESLint rule `hf-compose/no-orphan-instruction-fallback` blocks I-C4 patterns in `lib/prompt/composition/transforms/**` (rule-family pattern, sibling to `hf-curriculum/no-unscoped-slug-lookup` and `hf-playbook/no-direct-config-write`). Lands as `"warn"` so legacy violators in commits 4–6 don't block lint mid-PR; promoted to `"error"` once `composeGenericNounFallbackCount` reads 0. (2) Compose-time: `lib/prompt/composition/CompositionExecutor.ts::runComposeInvariants` fires after section assembly and before `persistComposedPrompt`. **I-C1 and I-C2 are `severity: "error"` from day 1** (binary invariants — failure throws before persist; Maya's fixture is the reproducer, not a signal-threshold question). **I-C3, I-C4, I-C5 are `severity: "warn"` initially** (log to `console.warn` with `ComposedPrompt.id` + invariant id + offending text), promoted to `error` per-invariant after the matching audit counter reads 0 across dev/test/prod for ≥7 days. (3) Run-time: structured logs emit to `console.warn` regardless of severity so the educator-facing call-feedback chain (`lib/prompt/composition/loaders/priorCallFeedback.ts`) can surface them. |
| **Pipeline COMPOSE compatibility** | The invariant runner fires in BOTH the pipeline `stageExecutors.COMPOSE` path AND the out-of-band `app/api/callers/[callerId]/compose-prompt/route.ts` path. It does NOT bump `composeInputsUpdatedAt` — staleness tracking is untouched. The TUNER → COMPOSE carve-out (pipeline COMPOSE exempt from staleness check) is preserved: this invariant runs DOWNSTREAM of staleness and runs unconditionally inside `executeComposition`. Non-blocking `stageErrors` semantics from `docs/PIPELINE.md` §3 are honoured for `warn`-severity violations; `error`-severity violations throw before `persistComposedPrompt` and surface as a pipeline `stageErrors` entry (HTTP still 200, COMPOSE marked failed only in `prompt` mode per §3.1). |
| **Test** | `tests/lib/prompt/composition/compose-invariants.test.ts` — Maya-shape fixture (`callerId="e1df05fa-9c85-4972-9bbe-b13e52784841"`, single `CallerModuleProgress` on `part2` mastery 0.59 COMPLETED, zero memories, `Call.requestedModuleId="part2"`) replays the #1006 failure and asserts: `Curriculum.current="Part 2"`; no `"Part 1"` token in the assembled prompt; no `"reference last session"` / `"pick up where we left off"` / `"as we covered"` token; every `(call #N)` resolves to the same N; no `"previous concept"` / `"new material"` / `"next concept"` token. Plus per-invariant pin tests at `tests/lib/prompt/composition/transforms/{modules,pedagogy,quickstart}.test.ts` covering each invariant in isolation. Test file lands BEFORE the code fixes (commit 2 in the sweep) so each fix turns a red test green. |
| **Memory doc** | This row; `docs/PROMPT-COMPOSITION.md` §4 transforms + §9 landmines (new L11 entry); `memory/flow-prompt-composition.md` invariants section; the file header on `lib/prompt/composition/CompositionExecutor.ts::runComposeInvariants` (rationale + severity-escalation path). |
| **Audit counter** | (in `apps/admin/scripts/audit-epic-100.ts` + `tests/fixtures/epic-100-audit-baseline.json`): `composeLockedModuleMismatch` (I-C1, target 0), `composeCallCounterIncoherent` (I-C2, target 0), `composeMemorylessReminisceCount` (I-C3, target 0 after grace window), `composeGenericNounFallbackCount` (I-C4, target 0 — ESLint-enforced at build time), `composeHeuristicProgressFallback` (I-C5, target 0). All `kind: "invariant"`. Baseline JSON MUST be updated in the same commit as the counter definitions or CI step 6 breaks for every subsequent story. |
| **Reinforced by** | #1006 (root bug — Maya IELTS hallucination); #1008 (this PR — invariants + ESLint rule + audit counters + Maya-fixture vitests + spec-driven mutation hardcoding sweep); planned follow-ups for severity escalation per invariant. |
| **Spec-driven mutation hardcoding sweep (in-scope, same PR)** | The Tech Lead audit for #1008 found three sibling instances of the same anti-pattern class operating on **mutation paths** rather than prompt text. Replaced in this PR alongside the invariant rollout: (1) bare `masteryThreshold: 0.7` literals in `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.SCORE_AGENT` (authored-module paths 0a + 0b) and `runLearningAssessmentFallback` → use `DEFAULT_MASTERY_THRESHOLD` from `lib/curriculum/compute-mastery.ts` (or `ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1')?.masteryComplete` — the same file already uses the registry correctly at line 397, then bypasses it two functions later with bare literals). (2) bare `confidence: 0.7` in the mock engine → `guardrails.confidenceBounds.defaultConfidence` (already in scope from GUARD-001 earlier in the same pipeline run). (3) `// TODO(ai-guard):` comment on `lib/pipeline/adapt-runner.ts::applyAdaptationAction`'s `targetValue ?? 0.5` / `currentValue ?? 0.5` fallbacks (silent `CallerTarget` writes when an ADAPT-* spec author omits `action.value`) — child issue filed for the proper fix (adapt spec must declare a value for every action). Nine additional MED/LOW findings logged for follow-up (working-set-selector magic numbers, `transforms/modules.ts` review-schedule and HIGH/LOW thresholds, memory category decay defaults). |

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

#### Link 6.a — COMPOSE → COMPOSE (carry-forward, #918)

| Field | Value |
|---|---|
| **Producer** | COMPOSE writes `SchedulerDecision.workingSetAssertionIds` to `CallerAttribute(scope=CURRICULUM, key="scheduler:last_decision")` via `persistSchedulerDecision` (Scheduler v1 Slice 1, #155). |
| **Consumer** | Next COMPOSE call's `transforms/modules.ts` — reads `priorDecision.workingSetAssertionIds`, diffs against `tpProgress` to compute `priorPlannedAssertionIds` (TPs the prior call planned but never moved past `not_started`), passes into `selectWorkingSet` as `WorkingSetInput.priorPlannedAssertionIds`. **This is the first bi-directional contract on the loop closure link** — same producer + consumer stage. |
| **Data shape** | `SchedulerDecision.workingSetAssertionIds: string[]` (assertion IDs only, no LO refs); diff result is a subset. |
| **DataContract slug** | None — uses the existing `scheduler:last_decision` CallerAttribute payload. |
| **Enforcement** | `tpProgress` filter at the diff site uses `status === undefined \|\| status === "not_started"` (conservative — any progress signal counts as "covered"). Picker-locked path at `modules.ts:929+` deliberately writes `workingSetAssertionIds: []`, suppressing carry-forward for educator/learner-driven sessions. |
| **Test** | `tests/lib/working-set-selector.test.ts` `#918 carry-forward` describe block — 8 cases incl. picker-locked-suppression + first-call-no-crash + boost-off-regression. |
| **Memory doc** | `docs/PIPELINE.md` §4.2 COMPOSE; `lib/curriculum/working-set-selector.ts::WorkingSetInput` JSDoc. |
| **Audit counter** | None added — `effectiveBoost > 0 && priorPlannedAssertionIds.length > 0` fires a structured `console.log` from `modules.ts` instead. Add a counter to `scripts/audit-epic-100.ts` only if the loop produces miscount evidence in production. |
| **Reinforced by** | #918. Tolerance entry at `Playbook.config.tolerances.carryForwardBoost` follows the #598 Slice 1 ADR placement (`@bucket 1 — Course parameter`, no per-learner override). |

---

## 3a. Authoring-time contracts

The links above cover the runtime adaptive loop (CALL → … → COMPOSE). The contracts below cover the **authoring-time boundaries** — when humans or AI agents propose changes to config and data that the loop will later read. Same shape (producer → consumer, enforced, tested, doc-linked), different timing.

### Link A1 — AI TOOL CATALOGUE → DB WRITE (privilege & tenancy)

| Field | Value |
|---|---|
| **Producer** | The Cmd+K AI assistant chooses and calls tools from `ADMIN_TOOLS` (`apps/admin/lib/chat/admin-tools.ts`). Tool input_schema is the per-tool whitelist of writable fields. |
| **Consumer** | `executeAdminTool()` dispatcher in `admin-tool-handlers.ts`, which writes via `prisma.*` to caller/playbook/domain/spec/curriculum_module/learning_objective tables. |
| **Data shape** | Each `update_<entity>` tool's `input_schema.properties` MUST NOT include any field in `AI_FORBIDDEN_FIELDS[entity]` (`apps/admin/lib/chat/ai-forbidden-fields.ts`). Forbidden classes: privilege escalation (`role`), cross-tenant moves (`domainId`, `ownerId`, `userId`), hard-delete (`deletedAt`), and per-parent identity slugs that downstream mastery keys depend on (`slug`, `ref`). |
| **Enforcement** | (1) Schema layer: forbidden fields removed from `input_schema.properties`. (2) Handler layer: defence-in-depth scrub at `handleUpdateCaller` (etc.) drops `role`/`domainId` even if a future schema regression adds them back, logs a warning. (3) RBAC layer: `TOOL_MIN_ROLE` per-tool minimum role enforced at dispatcher entry; meta-test asserts every tool in `ADMIN_TOOLS` is gated. |
| **Test** | `tests/lib/admin-tools-no-forbidden-fields.test.ts` walks `ADMIN_TOOLS` and fails CI if any schema exposes a forbidden field, AND asserts every tool blocks a DEMO-tier caller. `tests/lib/admin-tools-no-role-escalation.test.ts` covers the handler scrub. `tests/lib/admin-tools.test.ts` `RBAC enforcement` block covers behavioural cases. |
| **Memory doc** | `.claude/rules/ai-to-db-guard.md` ("update_caller / update_playbook_*" guard row, added 2026-05-26) + the JSDoc on `AI_FORBIDDEN_FIELDS` itself. |
| **Reinforced by** | 2026-05-26 sandbox demo — `update_caller` schema exposed `role` and an operator typed "change Brynn's role to admin"; the tool fired and Brynn was elevated. Fix removed `role`+`domainId` from the schema, added handler scrub, and built the central registry + meta-test so the next over-permissive tool fails CI before merge. |

### Link A2 — PENDING-CHANGES TRAY → /api/recompose/apply (human gate on AI proposals)

| Field | Value |
|---|---|
| **Producer** | Tray push sites: `PromptTunerSidebar`, Course Design tabs, Cmd+K palette, wizard chat, AI tool executors (#878). Each push lands a `TrayEntry` with `aiSuggested: boolean` and `fanoutScope: 'none' | 'caller' | 'all'`. |
| **Consumer** | `POST /api/recompose/apply` route — writes pending config/target changes via `update-playbook-config.ts` / `update-behavior-target` and optionally triggers `autoComposeForCaller` (Toggle 1) or `recompose-all` (Toggle 2). |
| **Data shape** | Tray invariants: (a) `aiSuggested` is **sticky** — once true for a `(key, scopeId)`, subsequent re-pushes (even from human surfaces) keep it true. (b) `beforeValue` is **frozen at first push** — diffs are against original DB state, not intermediate edits. (c) The fanout-class set is derived from `key` against `FANOUT_CLASS_PLAYBOOK_KEYS`, not stored per-entry. |
| **Enforcement** | Five layers: (1) TypeScript `TrayEntry` interface requires `aiSuggested: boolean`. (2) Reducer in `use-pending-changes-tray.tsx::push` enforces stickiness + frozen `beforeValue`. (3) zod `.strict()` validates the apply payload server-side. (4) Runtime guard at `apply/route.ts:125-126` rejects `aiSuggested + toggleAll` (cohort fan-out from an AI-touched batch). (5) ESLint rule `hf-recompose/no-ai-fanout-all` blocks AI tool executor files from passing `fanoutScope: 'all'`. Audit row written for every Save & apply regardless of toggles. |
| **Test** | `tests/hooks/use-pending-changes-tray.test.tsx` — reducer invariants (stickiness, frozen beforeValue). `tests/api/recompose-apply.test.ts` — server-side `aiSuggested + toggleAll` rejection + audit shape. ESLint rule self-tests at lint time. |
| **Memory doc** | `.claude/rules/ai-to-db-guard.md` ("Pending-changes tray + apply route" guard row, added 2026-05-26). |
| **Reinforced by** | Epic #854 / Stories #856 / #857 / #874 / #877 / #878. Safety property: **no AI surface, anywhere, can trigger a cohort fan-out** — only an explicit human Toggle 2 click on a batch with zero `aiSuggested:true` entries can. |

### Link A2-extension — Tray label honesty (Model A semantics)

| Field | Value |
|---|---|
| **Producer** | Tray push sites (same as Link A2 producer). Every push has *already written to the DB* by the time the entry appears — Model A semantics (see ADR `2026-05-26-tray-model-a-semantics.md`). |
| **Consumer** | The educator reading the tray + the human-readable button labels on `PendingChangesTray.tsx`. |
| **Invariant** | Tray entry CTAs must not promise rollback (`"Discard all"`) or imply that writes happen at apply time (`"Save & apply"`). Underlying writes are immediate at push time — `hooks/use-pending-changes-tray.tsx:264-266` `clear()` is `setEntries([])`, no DB call. Per-row dismiss clears visualisation only. Recompose-trigger buttons must say what they do (e.g. `"Recompose now"` or split CTAs `"Recompose this learner"` / `"Recompose cohort"`). |
| **Enforcement** | Code review against ADR `2026-05-26-tray-model-a-semantics.md` for any PR touching `PendingChangesTray.tsx` / `use-pending-changes-tray.tsx`. No audit counter — label honesty is verified at review time. The structural invariants under it (sticky `aiSuggested`, runtime `aiSuggested + toggleAll` rejection, ESLint `hf-recompose/no-ai-fanout-all`) are covered by Link A2 above. |
| **Test** | Snapshot test on the rendered tray button labels lands with the rename in #912. |
| **Memory doc** | `docs/decisions/2026-05-26-tray-model-a-semantics.md` (the ADR); `.claude/rules/ai-to-db-guard.md` Pending-changes tray guard row (existing, references this contract). |
| **Reinforced by** | Empirical 2026-05-26 — `"Save & apply"` and `"Discard all"` were UX contract violations under Model A. Epic #909 PR 1 (#910) documents the contract; PR 3 (#912) does the rename. |

---

## 3c. Learner-surfacing contracts

The links above cover pipeline-internal (3) and authoring-time (3a) boundaries. The contracts below cover **learner-facing read-outs** — when pipeline-written state is surfaced via a student-scoped API to the SimProgressPanel or other learner UI. Same shape (producer → consumer, enforced, tested, doc-linked), different audience: a human learner reads the result, so the contract has copy/sanitization requirements that pipeline-internal boundaries don't.

### Link L1 — SCHEDULER → LEARNER (Today's call panel)

| Field | Value |
|---|---|
| **Producer** | `lib/pipeline/scheduler.ts` + `lib/prompt/composition/transforms/modules.ts` (3 write sites total — empty-set fallback, happy-path, picker-locked from #538). All go through `persistSchedulerDecision()` → `CallerAttribute` (key `scheduler:last_decision`, scope `CURRICULUM`). |
| **Consumer** | `GET /api/student/scheduler-decision` (uses `readSchedulerDecision()` helper) → `useSchedulerDecision` hook → `SimProgressPanel` "Today's call" section. |
| **Data shape** | `reason` must be a complete learner-facing sentence; no log prefix (`/^[a-z][a-z_-]*:\s/` forbidden); no internal counts in parens; no internal jargon (`fallback`, `gate`, `working set`, `weight`); ≤100 chars at write-time (sanitizer caps at 137). Internal fields (`outcomeId`, `contentSourceId`, `workingSetAssertionIds`) MUST never reach the learner — stripped at the route boundary. |
| **DataContract slug** | implicit — copy contract enforced via `SCHEDULER_REASONS` constants module (`lib/pipeline/scheduler-reasons.ts`) + regression test, not via a `DataContract` row. (Candidate for `SCHEDULER_DECISION_V1` if a third writer appears.) |
| **Enforcement** | Five layers: (1) **Writer-side copy constants** — all reason strings come from `SCHEDULER_REASONS` (no inline literals). (2) **Build-time regression** — `tests/lib/pipeline/scheduler-reasons.test.ts` greps source files for `reason: '<lowercase-prefix>:'` patterns and fails CI. (3) **Route-side sanitizer** — `lib/scheduler/sanitize-reason.ts` strips HTML tags / UUIDs / spec slugs / collapses whitespace / truncates at word boundary / returns `null` below 20-char threshold. (4) **Route-side strict shape** — internal fields stripped, response schema is `{ mode, reason, callsSinceAssess, writtenAt }` only. (5) **Defensive guards** — multi-curriculum (`>1 active CallerPlaybook` → null; until #919 fixes the writer key shape) + stale (`writtenAt < lastCall.endedAt` → null). |
| **Test** | `tests/lib/pipeline/scheduler-reasons.test.ts` (writer copy contract). `tests/lib/scheduler/sanitize-reason.test.ts` (route sanitizer, 9 cases). `tests/lib/scheduler/mode-labels.test.ts` (4 modes). `tests/api/student-scheduler-decision.test.ts` (route end-to-end: auth, cold-start, multi-curriculum, stale, internal-field strip, sub-threshold reason). |
| **Memory doc** | `.claude/rules/ai-to-db-guard.md` (consider adding row — AI-written `reason` field is now a learner-facing surface). JSDoc on `SCHEDULER_REASONS` + the API route. |
| **Known gap** | **#919** — `CallerAttribute` unique constraint `(callerId, key, scope)` has no curriculumId; a learner in 2+ active playbooks races to overwrite a single row. Defended at read-time (multi-curriculum guard) until writer-side fix lands. |
| **Reinforced by** | #917 / PR #920 (Slice 2 panel + sanitizer + guards) + #923 / PR #924 (writer copy constants + regression test). 2026-05-27. |

---

### Link L9 — Learner-Facing Module Picker Reachability

**Every learner-facing page that mounts a session on a Playbook with `config.modulesAuthored = true` MUST resolve the active `playbookId` before rendering the chat surface.** Resolution falls back through:

1. `?playbookId=` URL param (deep-link from picker, wizard, etc.)
2. The caller's single ACTIVE `CallerPlaybook` enrollment
3. The caller's most-recently-enrolled ACTIVE playbook (`orderBy: enrolledAt desc`)

A page that mounts without a resolved `playbookId` either renders a learner-readable "no enrollment" empty state OR is unreachable from learner navigation. **Never** a silent no-op (no banner, no picker, no error).

| Field | Value |
|---|---|
| **Producer** | The fallback chain itself — implemented as the shared resolver `apps/admin/lib/caller/resolve-active-playbook.ts::resolveActivePlaybookId(callerId, urlOverride?)` and its API wrapper `app/api/callers/[callerId]/active-playbook/route.ts`. Single source of truth for the L9 pick rule. |
| **Consumer** | Every learner-facing page that mounts a chat / call surface on a Playbook. Today: `apps/admin/app/x/sim/[callerId]/page.tsx`. Future: any new `/x/sim/**` or `/x/student/**` page that reads `?playbookId=` and renders module-aware UI. |
| **Defends against** | The silent-reachability class of bug exemplified by #948 / PR #947: a learner deep-links into `/x/sim/[callerId]` without `?playbookId=`, the page reads URL only, `playbookId` stays `undefined`, the downstream playbook fetch never fires, `modulesAuthored` stays `false`, and the module-picker banner conditional silently no-ops — even though the learner has exactly one ACTIVE enrollment on a playbook with an authored module catalogue. No banner, no error, no entry to the picker. |
| **Invariant** | A learner with at least one ACTIVE enrollment lands on a page that resolves `playbookId` from enrollments when the URL didn't pass one. A learner with zero ACTIVE enrollments lands on a page that renders an explicit empty state. There is no third "page silently mounts with no picker and no error" outcome. |
| **Enforcement** | Three layers: (1) **Shared helper** — `lib/caller/resolve-active-playbook.ts::resolveActivePlaybookId` is the canonical pick rule; the admin-side `CallerDetailPage.tsx:386-401` carries an inline copy with a JSDoc note pinning it to the helper (must stay byte-identical). (2) **API wrapper** — `/api/callers/[callerId]/active-playbook` so client-side learner pages have a single endpoint instead of duplicating the resolver in React effects. (3) **`.claude/agents/arch-checker.md` Check G** — static check across `apps/admin/app/x/sim/**/page.tsx` + `apps/admin/app/x/student/**/page.tsx`: any file that reads `searchParams.get('playbookId')` MUST also use the helper or hit the endpoint. Soft warning today; promote to error once no violations remain. |
| **Test** | `apps/admin/tests/lib/caller/resolve-active-playbook.test.ts` (13 cases — URL override always wins; 1/2+/0 ACTIVE branches; non-ACTIVE excluded; SQL shape pin; nullish-override fall-through). `apps/admin/tests/integration/journey/learner-picker-reachability.integration.test.ts` (live-DB end-to-end on 4 caller shapes). |
| **DataContract slug** | None — the contract is the shape of the pick rule, not the shape of a DB row. (If a third learner-facing surface ever needs the rule with a different scope, this becomes a candidate for `LEARNER_SESSION_MOUNT_V1`.) |
| **Memory doc** | This row; JSDoc at `lib/caller/resolve-active-playbook.ts`; `docs/TEST-BANK.md` entries D003 (unit) + D004 (integration). |
| **Related** | #947 (the fix that exposed the gap) · #948 (this follow-up that pins the contract) · `docs/TEST-BANK.md` D003 + D004. |
| **Reinforced by** | #948 — this PR. |

---

## 3d. Course Variant product line (#1034)

The Variant product line lets one Curriculum back N sibling Playbooks (Pop Quiz, Revision Aid, Exam Assessment) — same content authority, different teaching profile. CallerModuleProgress and `lo_mastery:*` flow naturally across siblings for the same Caller; the funnel (Pop Quiz finds gap → Revision Aid teaches → Exam Assessment certifies) is a runtime emergent of the shared CurriculumModule UUIDs.

This section documents the six producer→consumer contracts that the variant work introduced. Treat each row as load-bearing for the funnel: violation means a sibling silently sees stale content or a foreign mastery state.

### CC-A — Playbook → Curriculum linkage (PlaybookCurriculum)

| Field | Value |
|---|---|
| **Producer** | `lib/wizard/apply-projection.ts::ensureCurriculum`, `lib/wizard/sync-authored-modules-to-curriculum.ts`, `lib/playbooks/create-variant.ts::createPlaybookVariant` |
| **Consumer** | `lib/curriculum/resolve-module.ts::resolveCurriculumIdForPlaybook` (called by pipeline `route.ts:148`, COMPOSE loaders, admin tools); `lib/curriculum/resolve-playbook-for-curriculum.ts::resolvePlaybookIdForCurriculum` (called by curriculum-side writes for CC-B) |
| **Data shape** | `PlaybookCurriculum{playbookId, curriculumId, role}` where `role ∈ {primary, linked}`. `@@unique([playbookId, curriculumId])`. Exactly one `primary` row per Curriculum (backfilled 1:1 from legacy `Curriculum.playbookId`). N `linked` rows per Curriculum allowed — that's the variant count. |
| **DataContract slug** | implicit |
| **Enforcement** | DB `@@unique` constraint; `createPlaybookVariant` writes `role='linked'` (never `primary`); wizard write sites dual-write `Curriculum.playbookId` (deprecated owner ptr) + `PlaybookCurriculum{role:'primary'}` row in the same `prisma.$transaction`. `resolveCurriculumIdForPlaybook` reads the join first and falls back to the deprecated column for transition safety. |
| **Test** | `tests/lib/curriculum/resolve-curriculum-for-playbook.test.ts` (5 cases — pins TL hard-block #1 regression: variant Playbook's `linked` row resolves to PARENT's Curriculum); `tests/lib/playbooks/create-variant.test.ts` (10 cases — pins CC-A invariants: writes `role:'linked'`, NEVER writes CurriculumModule or Curriculum). |
| **Memory doc** | `docs/ENTITIES.md` (Playbook + Curriculum relations); follow-up `#1038` drops the deprecated `Curriculum.playbookId` column once readers complete migration. |
| **Audit counter** | TBD — propose `variantSiblingsWithoutPrimary` once #1038 lands (target 0). |
| **Reinforced by** | #1034 (this story). |

### CC-B — Curriculum mutation fanout (composeInputsUpdatedAt across siblings)

| Field | Value |
|---|---|
| **Producer** | Any helper that mutates a Curriculum-scope compose-affecting field (LO write, module rename, lesson plan replace, assertion → LO link). Wired in: `app/api/curricula/[curriculumId]/lesson-plan/route.ts`, `app/api/curricula/[curriculumId]/modules/[moduleId]/route.ts` (PATCH + DELETE), `app/api/curricula/[curriculumId]/modules/route.ts` (POST + PUT), `lib/chat/admin-tool-handlers.ts` (3 sites). |
| **Consumer** | `lib/compose/staleness.ts::isPromptStale` at every sibling Playbook's COMPOSE call-start. |
| **Data shape** | `Playbook.composeInputsUpdatedAt` (DateTime) — one bump per sibling per Curriculum mutation. Driven by `resolvePlaybookIdForCurriculum(curriculumId) → string[]` (the array of every sibling) iterated through `bumpPlaybookComposeTimestamp(playbookId)`. |
| **Invariant** | Every sibling Playbook sharing the mutated Curriculum MUST have its `composeInputsUpdatedAt` bumped before the next call. Variant Courses become stale TOGETHER when the teacher edits an LO. |
| **Enforcement** | `resolvePlaybookIdForCurriculum` and `resolvePlaybookIdForCurriculumModule` return `string[]` (changed from `string|null` in #1034). Inline loops at the 7 caller sites + the canonical helper `lib/compose/bump-curriculum-fanout.ts::bumpCurriculumComposeFanout` for new write sites. |
| **Pipeline carve-out** | Inherits the #825 carve-out: pipeline-internal writes do NOT bump (the unconditional pipeline COMPOSE handles them). Fanout only fires for teacher / wizard / admin mutations. |
| **Test** | `tests/lib/curriculum/resolve-playbook-for-curriculum.test.ts` (signature change + multi-sibling resolution); `tests/lib/compose/bump-curriculum-fanout.test.ts` (5 cases — multi-sibling bump, empty-siblings no-op, single-sibling, module-walk variant). |
| **Memory doc** | This sub-section + `lib/compose/bump-curriculum-fanout.ts` header. |
| **Audit counter** | TBD — propose `curriculumMutationMissedSiblings` once #1038 lands (target 0). |
| **Reinforced by** | #1034 (extends #825 / #834). |

### CC-C — Enrollment → Call.playbookId scoping (per-Course entry surfaces)

| Field | Value |
|---|---|
| **Producer** | Enrollment surfaces — `Invite.playbookId` non-null FK (existing). Each sibling Course gets its own join URL (`/join/[token]`), its own dashboard card, its own Quick-Launch deep link. |
| **Consumer** | Call start (Sim, VAPI, web voice, phone) → sets `Call.playbookId` to the entry-surface's Playbook. Pipeline reads `Call.playbookId` for all downstream stages. |
| **Data shape** | `Call.playbookId` (existing FK). One Call belongs to exactly one Playbook for its entire lifetime — no mid-call mode switching in v1. |
| **Invariant** | The entry point selects the sibling; the learner does not "pick a Course mid-call". Mode-switching (Pop Quiz → Revision Aid for the same learner) requires end-call + start-call. |
| **Enforcement** | Existing FK; Story A3 (#1040) adds the post-join landing page that lets a multi-Playbook-cohort learner pick which sibling to start. Out-of-scope tightening (`Invite.playbookId` mandatory) deferred to a separate story per #1034 TL review. |
| **Test** | E2E (per Story A3 scope when built) — same Caller enrolled in N siblings, click sibling A's "Start" card → `Call.playbookId == A`. |
| **Memory doc** | `docs/flow-call-lifecycle.md`; #1040 Story body. |
| **Audit counter** | n/a (existing FK is the surface). |
| **Reinforced by** | #1034 (groundwork) + #1040 (learner UI). |

### CC-D — Call → COMPOSE Curriculum resolution

| Field | Value |
|---|---|
| **Producer** | Call start (`Call.playbookId` is the input). |
| **Consumer** | Pipeline COMPOSE — `lib/curriculum/resolve-module.ts::resolveCurriculumIdForPlaybook(playbookId)` returns the shared Curriculum id. Used by `app/api/calls/[callId]/pipeline/route.ts:148`, `lib/prompt/composition/SectionDataLoader.ts:1128`, `lib/prompt/compose-content-section.ts:374` and `:564`. |
| **Data shape** | `resolveCurriculumIdForPlaybook(playbookId) → curriculumId | null` — reads PlaybookCurriculum first (any role, primary before linked, oldest createdAt within role), falls back to the deprecated `Curriculum.playbookId` column only when no join row exists. |
| **Invariant** | Variant Playbooks MUST resolve to the parent's shared Curriculum, not null. The pre-#1034 implementation queried the deprecated column directly and silently returned null for variants → pipeline skipped module-aware composition for every variant Call. Pinning this invariant is the TL hard-block resolution. |
| **Enforcement** | The resolver itself + 5 hot-reader migrations (Task 3 of #1034). Each hot reader keeps the deprecated-column fallback path for transition rollback safety; the fallback is removed in #1038. |
| **Test** | `tests/lib/curriculum/resolve-curriculum-for-playbook.test.ts` includes the explicit "REGRESSION (TL block #1): variant Playbook's linked row resolves to PARENT's Curriculum" case. Future: integration test that runs a variant Call through pipeline COMPOSE and asserts module-aware section renders. |
| **Memory doc** | `docs/flow-prompt-composition.md` + `lib/curriculum/resolve-module.ts` header. |
| **Audit counter** | Propose `variantCallsWithNullCurriculum` (target 0) once the variant flow is in production. |
| **Reinforced by** | #1034 (Task 2 + Task 3). |

### CC-E — AGGREGATE → cross-Playbook mastery scope (INTENTIONAL)

| Field | Value |
|---|---|
| **Producer** | AGGREGATE-stage writes — `CallerAttribute.lo_mastery:{moduleSlug}:{loRef}` (#611 canonical slug form) and `CallerModuleProgress` rows. |
| **Consumer** | COMPOSE on every sibling Playbook's next Call for the same Caller. Mastery flows naturally because: (a) `lo_mastery` keys are slug-keyed and the variant shares the parent's CurriculumModule slugs; (b) `CallerModuleProgress @@unique([callerId, moduleId])` shares one row across siblings because moduleId UUIDs ARE shared. |
| **Data shape** | Existing — no schema change. The new fact is that the rows are now CROSS-PLAYBOOK scoped by *design* for a given Caller. |
| **Invariant** | **Intentional cross-Playbook scope.** A Caller doing Pop Quiz → Revision Aid → Exam Assessment writes and reads the same mastery rows. Variants compose against the same EMA. This is the funnel mechanism and must not be "fixed" as a bug. |
| **Enforcement** | Documented here. Future test (Story A test bank): triple-enroll a Caller, run a Call against sibling A, assert sibling B's pipeline reads the same `lo_mastery:M3:LO2.3` row. |
| **Test** | Pending integration test for the triple-sibling funnel. Existing AGGREGATE unit tests (`tests/lib/pipeline/aggregate-*`) implicitly cover the write side; cross-sibling READ is the new assertion class. |
| **Memory doc** | `docs/ENTITIES.md` (CallerAttribute + CallerModuleProgress); this row. |
| **Audit counter** | TBD — `crossSiblingMasteryDivergence` (target 0) — non-trivial to compute, defer until needed. |
| **Reinforced by** | #1034 (documentation only — the mechanism is pre-existing). |

### CC-F — SIM playbook-curriculum precondition

| Field | Value |
|---|---|
| **Producer** | `scripts/sim-drive-call.ts` (and any future sim runner). |
| **Consumer** | Pipeline COMPOSE during the simulated Call. |
| **Data shape** | `(playbookId, curriculumId)` linkage MUST exist before sim runs. Pre-flight: `await prisma.playbookCurriculum.findFirst({where:{playbookId}})` returns a row OR `Curriculum.playbookId === playbookId` (transition fallback). |
| **Invariant** | A sim launched against a Playbook with no shared Curriculum MUST fail fast with a clear error, not proceed silently and produce a malformed Call. |
| **Enforcement** | Pre-flight check in `sim-drive-call.ts` (added per #1034 Task 9 scope). Future: shared precondition helper in `lib/sim/preflight.ts` so other sim runners pick it up automatically. |
| **Test** | `tests/scripts/sim-drive-call-preflight.test.ts` (new — pending Task 9): sim with un-linked Playbook exits non-zero; sim with primary or linked Curriculum proceeds. |
| **Memory doc** | `scripts/sim-drive-call.ts` header + this row. |
| **Audit counter** | n/a (sim is a CI/dev surface). |
| **Reinforced by** | #1034 (Task 9 — pre/post-snapshot CHAIN tests). |

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
| #920 | #917 | 3c | New learner-facing API + SimProgressPanel "Today's call" section; sanitizer + multi-curriculum + stale guards |
| #924 | #923 | 3c | Scheduler reason copy constants module + regression test against log-prefixed reasons |
| #947 | #948 (fix) | L9 | `/x/sim/[callerId]` auto-resolves playbookId from caller's enrollments when URL has none |
| TBD  | #948 (this PR) | L9 | Chain contract + shared `resolveActivePlaybookId` helper + `/api/callers/[id]/active-playbook` endpoint + arch-checker Check G + integration journey test |
| TBD  | #1008 (closes #1006) | 3 (sub-contract) | COMPOSE → LLM output invariants — I-C1..I-C5 + ESLint `hf-compose/no-orphan-instruction-fallback` + Maya-fixture vitests + 5 audit counters + spec-driven mutation hardcoding sweep in pipeline route (`masteryThreshold: 0.7` literals → `DEFAULT_MASTERY_THRESHOLD`) |

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
| 2026-06-04 | **Section 3d added — Course Variant product line (#1034).** Six new contracts (CC-A through CC-F) covering: PlaybookCurriculum join-table linkage; curriculum mutation fanout across siblings (`resolvePlaybookIdForCurriculum` signature changed from `string\|null` to `string[]`); Enrollment → Call.playbookId scoping (per-Course entry surfaces, no mid-call switching in v1 — Story A3 #1040 closes the learner-side UI); Call → COMPOSE Curriculum resolution (closes TL hard-block: pre-#1034 variants silently skipped module-aware composition because the resolver queried the deprecated `Curriculum.playbookId` column directly); AGGREGATE → cross-Playbook mastery scope (INTENTIONAL — slug-keyed `lo_mastery:*` and shared `CallerModuleProgress` rows are the funnel mechanism); SIM playbook-curriculum precondition (pre-flight in `sim-drive-call.ts`). Deprecated `Curriculum.playbookId` column stays for one release as a primary-owner pointer + transition fallback; dropped in #1038. Wizard write sites dual-write column + `PlaybookCurriculum{role:'primary'}` row in the same `prisma.$transaction` to prevent two-write divergence. Five preset config keys (`teachingProfile`, `welcomeMessage`, `maxCallDurationSeconds`, `modelTier`, `bloomLevelOverride`, `useFreshMastery`) on `Playbook.config` are forward-declared per the TL re-review — stored as JSON, no runtime effect today. Cost tiering (`modelTier`) and Bloom override ship in follow-up stories. Variant route NEVER writes `CurriculumModule` or `Curriculum` rows — the funnel depends on shared UUIDs (CC-A invariant pinned by `tests/lib/playbooks/create-variant.test.ts`). |
| 2026-06-03 | **Link 3 sub-contract added — COMPOSE → LLM output invariants (#1008 / closes #1006).** Five output invariants enforced inside `executeComposition` before `persistComposedPrompt`: I-C1 module-lock honoured; I-C2 call-counter coherence; I-C3 no memory-less reminisce; I-C4 no generic-noun fallback in instructions (ESLint-enforced); I-C5 `estimatedProgress` heuristic is debug-only. Source: confirmed hallucination on caller `e1df05fa-9c85-4972-9bbe-b13e52784841` (Maya, IELTS Prep Lab) — `ComposedPrompt cd8e2995` simultaneously locked Part 2, asked the AI to spaced-retrieve Part 1, and supplied `key_memories: null`, so the model fabricated Part 2 progress specifics ("from one-minute panic to past 90 seconds") to maintain conversational coherence. Same anti-pattern class as #605 (categoryToTeachMethod fallback) and #608 (SYSTEM IDENTITY fallback) — silent code-side defaults masking missing data. **I-C1 + I-C2 land as `severity: "error"` from day 1** (binary invariants; Maya's vitest fixture is the reproducer). **I-C3 / I-C4 / I-C5 land as `"warn"`** and promote per-invariant to `"error"` after the matching audit counter reads 0 across dev/test/prod for ≥7 days. New ESLint rule `hf-compose/no-orphan-instruction-fallback` blocks the `${x?.name \|\| "previous concept"}` pattern class in `lib/prompt/composition/transforms/**` (rule-family pattern, sibling to `hf-curriculum/no-unscoped-slug-lookup`). **Co-landing spec-driven mutation hardcoding sweep:** replaces bare `masteryThreshold: 0.7` literals in `app/api/calls/[callId]/pipeline/route.ts` authored-module paths and `runLearningAssessmentFallback` with `DEFAULT_MASTERY_THRESHOLD` / `ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1')?.masteryComplete` (the registry call is already correctly used at line 397 of the same file then bypassed two functions later — exact same miss class as #605). Mock-engine `confidence: 0.7` → `guardrails.confidenceBounds.defaultConfidence`. `lib/pipeline/adapt-runner.ts::applyAdaptationAction`'s silent-fallback `targetValue ?? 0.5` writes get `// TODO(ai-guard):` markers and a child issue for the proper fix. Five new audit counters: `composeLockedModuleMismatch`, `composeCallCounterIncoherent`, `composeMemorylessReminisceCount`, `composeGenericNounFallbackCount`, `composeHeuristicProgressFallback` — all `kind: "invariant"`, target 0, baseline JSON updated in the same commit. Also fixed stale path in the TUNER → COMPOSE row (`lib/playbook/bump-timestamp.ts` → `lib/compose/bump-timestamp.ts`) — the file lives in `lib/compose/`, never `lib/playbook/`. |
| 2026-05-27 | **Link L9 added — learner-facing module-picker reachability (#948).** Pins the silent-reachability invariant exposed by PR #947's `/x/sim` fix. Every learner-facing page that mounts a session on a Playbook MUST resolve `playbookId` via the canonical fallback (URL → single ACTIVE enrollment → most-recently enrolled ACTIVE → empty state). Shared helper at `lib/caller/resolve-active-playbook.ts` + API wrapper at `/api/callers/[id]/active-playbook` + arch-checker Check G (soft warn) + integration journey test on 4 caller shapes + 13-case vitest. Defends against a learner deep-linking into the sim view, missing the picker silently, and being unable to focus a session. |
| 2026-05-27 | **Section 3c added — learner-surfacing contracts. Link L1: scheduler → learner (PRs #920 (#917 Slice 2) + #924 (#923 writer copy)).** First pipeline→learner contract boundary: scheduler `reason` field, written to `CallerAttribute` during COMPOSE, exposed via `GET /api/student/scheduler-decision` and rendered in SimProgressPanel. Five-layer enforcement (writer copy constants + build-time regression + route sanitizer + strict response shape + multi-curriculum/stale guards). Known gap #919 (multi-curriculum writer key shape) documented at read-time guard, pending writer-side fix. |
| 2026-05-23 | Initial canonical inventory created post-Epic 100 (#616). Captures the 6 chain links + active DataContract slugs + the 13 Epic 100 PRs that reinforced them. |
| 2026-05-26 | **Link 3a added — authoring-side read parity (#910 / epic #909).** Sister contract to Link 3 FK invariant. Any UI surface displaying a scope-cascaded value must read through `lib/tolerance/resolve-tolerance.ts` (or the bulk wrapper landing in #911). Ad-hoc two-endpoint cascade-merge in components is forbidden. New audit counter `authoringBehTargetBypassCount` (CI step 6) — today 1 (`PromptTunerSidebar.tsx`, fixed by #911); target 0. Arch-checker Check F enforces at review time (soft warning, promoted to error once #911 lands). Caught empirically 2026-05-26 — sidebar showed course-level value after a learner-scope save because the in-component merge ignored the separately-fetched learner overrides. |
| 2026-05-26 | **Link A2-extension added — tray label honesty (#910 / epic #909).** Tray operates under Model A — writes immediate at push time, tray is a visualisation + recompose gate. `clear()` does not roll back. `"Save & apply"` / `"Discard all"` labels were UX contract violations and are forbidden. See ADR `docs/decisions/2026-05-26-tray-model-a-semantics.md`. Rename lands with #912. |
| 2026-05-26 | **Link 3 sub-contract — AI write paths now structural (3-surface registry + central inventory).** Promoted the AI-CAPABILITIES.md / registry / RBAC / stub model from change-log to a proper sub-contract under Link 3. `apps/admin/scripts/generate-ai-capabilities.ts` extended to walk all THREE registries (`admin-tools.ts` = Cmd+K, `conversational-wizard-tools.ts` = Wizard, `course-ref-tools.ts` = Course-Ref) rather than just Cmd+K. Single doc, three sections, one CI guard. Output: 48 tools across 3 surfaces (42 live, 6 stubs). Verified that all three surfaces converge on the same compose-stamping helpers — a change to any helper benefits every AI surface automatically. Audit found only ONE non-test eslint-disable on the hf-* rules (`patchContentSpecForContract` — TxClient enlist limitation, TODO(#834)); every other AI writer routes correctly. |
| 2026-05-26 | **Link 3 — `docs/AI-CAPABILITIES.md` auto-derived from `ADMIN_TOOLS[]`.** Closes the SPoT loop opened by the stubs PR (#862). `apps/admin/scripts/generate-ai-capabilities.ts` walks the registry + parses `TOOL_MIN_ROLE` and `NOT_YET_AVAILABLE_TOOLS` from `admin-tool-handlers.ts`, then writes `docs/AI-CAPABILITIES.md` — one row per tool with name, min role, required/optional params, and a one-sentence summary. `npm run docs:ai-capabilities` regenerates; `npm run docs:ai-capabilities:check` exits 1 when the doc drifts from the registry (CI guard, parallels `docs:health:ci` / `docs:citations:ci` / `docs:knowledge-map:ci`). Initial output: 33 tools, 27 live, 6 stubs. **The contract is now physical**: every promised AI capability is in `ADMIN_TOOLS[]`, every entry has an RBAC level, every stub is marked, and the human-readable index cannot lie because it's generated from code. |
| 2026-05-26 | **Link 3 — Cmd+K roadmap stubs (NOT YET AVAILABLE) added.** Six tools declared as roadmap stubs so the AI never silently invents them: `list_caller_memories`, `create_goal`, `rename_subject`, `replace_lesson_plan`, `add_curriculum_module`, `reset_caller`. Each stub's schema lives in `lib/chat/admin-tools.ts` with a description that starts `NOT YET AVAILABLE — ...` and tells the AI exactly what to say to the user + which UI surface to point at. All six dispatch through a single `handleNotYetAvailable(toolName)` handler that returns `{ ok: false, not_yet_available: true, tool, message }`. RBAC gates them at OPERATOR so STUDENT/VIEWER hit the auth refusal *before* the stub message — promoting a stub later does not change the auth posture. Promotion checklist documented inline in `admin-tools.ts`. 25 new unit tests verify schema presence, the `NOT YET AVAILABLE` prefix, the stub payload shape, RBAC ordering, and that unknown tool names still get "Unknown tool" rather than the stub copy. **Single source of truth:** `lib/chat/admin-tools.ts` is the canonical Cmd+K tool registry. CHAIN-CONTRACTS records the *contract* (every educator-facing write must bump compose timestamps + every promised tool must be declared so the AI cannot invent capabilities); the registry itself stays in code where the AI actually reads it. Follow-up: auto-derive `docs/AI-CAPABILITIES.md` from `ADMIN_TOOLS[]` at build time for a human-readable view. |
| 2026-05-26 | **Link 3 — Cmd+K read-parity for the new writers (post-#852).** Closed the loop on the writers landed in #852 + #851 by adding 7 read/edit tools so the AI can speak in delta terms ('raise warmth from 0.6 to 0.75') rather than blindly overwriting. New tools: `get_playbook_config` (Playbook + Playbook.config + composeInputsUpdatedAt hint), `list_behavior_targets` (PLAYBOOK or CALLER scope; CALLER picks MAX across identities matching `resolve-tolerance.ts`), `list_curriculum_modules` (curriculum_id or playbook_id with FK walk), `list_goals_for_caller` (filterable by status), `recompose_caller_prompt` (chat equivalent of the StalePromptPill #831 "Recompose now" click; replicates the POST /api/callers/[id]/compose-prompt logic), `update_learning_objective` (single-LO edit without rewriting the module's full LO list — direct LO edits bump the owning playbook), `update_curriculum_metadata` (Curriculum.name/description/sourceTitle/sourceYear/authors — pure metadata, bumps the owning playbook). RBAC unchanged — all gated at OPERATOR. 14 unit tests cover scope routing, FK walks, MAX-across-identities, RBAC. Verified via `tests/lib/admin-tools-read-parity.test.ts`. |
| 2026-05-26 | **Link 3 — Cmd+K AI tool coverage gap-closure (post-#849).** The admin chat (Cmd+K) is now a complete write surface for every compose-affecting setting an educator can change in the UI. Closed four gaps: (1) `update_domain` extended with the 4 compose-affecting onboarding fields (`onboardingFlowPhases`, `onboardingDefaultTargets`, `onboardingWelcome`, `onboardingIdentitySpecId`) routed through `updateDomainConfig` — previously these were unreachable from chat and the handler also wrote `prisma.domain.update` directly, latent risk for future field additions. (2) New `update_curriculum_module` tool — wraps the PATCH at `app/api/curricula/[curriculumId]/modules/[moduleId]/route.ts`, calls `bumpPlaybookComposeTimestamp` via `resolvePlaybookIdForCurriculum`. (3) New `update_assertion_lo_link` tool — wraps the PATCH at `app/api/assertions/[assertionId]/route.ts`, fans out playbook bumps via `resolvePlaybookIdsForContentSource`. (4) New `confirm_goal` + `dismiss_goal` tools — mirror `app/api/goals/[goalId]/confirm/route.ts`, call `bumpCallerComposeTimestamp` post-write. `update_playbook_config` description expanded to explicitly mention `tolerances.retrievalCadenceOverride`, `tolerances.memoryDecayScale`, `firstCallMode`, `firstSessionTargets`, `progressNarrative`, `offboardingSummary` so the AI knows they're reachable through the merge-style endpoint. RBAC unchanged — all new write tools require OPERATOR (educator level). Verified via 10 unit tests in `tests/lib/admin-tools-coverage-gaps.test.ts`. |
| 2026-05-26 | **Link 3 — `BehaviorTarget(scope=CALLER)` FK invariant row added (#836).** Documents that `BehaviorTarget.callerIdentityId` references `CallerIdentity.id`, NOT `Caller.id` (the column is `@map("callerId")` aliased — see `docs/ENTITIES.md` invariant I10). Resolvers must fan out via the caller's `callerIdentities[]` relation and pick MAX `targetValue` across identities. Caught empirically via the #598 Slice 1 follow-up demo on hf_sandbox: pre-fix, the mastery cascade's layer 1 (per-learner adaptive override) was dead in prod because `lib/tolerance/resolve-tolerance.ts` was passing `Caller.id` into a column that joins on `CallerIdentity.id`. Fix split the previous `readBehaviorTargetValue` into per-scope helpers so the CALLER branch can encode the fanout. |
| 2026-05-26 | **Link 3 sub-contract — Curriculum-side bumps landed (#834, Story 8/8).** EPIC #832 now complete. `lib/curriculum/resolve-playbook-for-curriculum.ts` exports four FK-walk helpers (`resolvePlaybookIdForCurriculum`, `resolvePlaybookIdForCurriculumModule`, `resolvePlaybookIdsForContentSource`, `resolvePlaybookIdsForAnalysisSpec`) that turn the various IDs curriculum writers already hold into the `Playbook.id` needed for `bumpPlaybookComposeTimestamp` (Story 6). Wired into: `app/api/curricula/[curriculumId]/modules/[moduleId]/route.ts` (PATCH module + LO upsert/delete, DELETE module), `app/api/curricula/[curriculumId]/modules/route.ts` (POST bulk-upsert, PUT reorder), `app/api/curricula/[curriculumId]/lesson-plan/route.ts` PUT (lesson plan replace), `app/api/assertions/[assertionId]/route.ts` PATCH (assertion → LO link via PlaybookSource fan-out), `lib/jobs/curriculum-enricher.ts` (post-enrolment background spec enrichment via PlaybookItem fan-out — supersedes the TODO(#834) left in Story 5). 10 resolver unit tests added. The "curriculum writers" known gap noted in #827 + #834 is now closed: every educator-facing curriculum write path stamps the owning playbook(s), and the staleness check at COMPOSE time picks it up on the caller's next call. |
| 2026-05-25 | **Link 3 sub-contract — UI surface landed (#831, Story 7/8).** New `GET /api/callers/[callerId]/prompt-staleness` endpoint returns `{ isStale, composedAt, upstreamChanges[] }` where `upstreamChanges` lists which scope rows (`playbook` / `caller` / `domain` / `system`) are newer than the cached `ComposedPrompt.composedAt`. Powers the new `<StalePromptPill />` component rendered above the calls list and tune panel on `/x/callers/[callerId]`. Pill is non-alarming (`hf-banner-warning`) with a "Recompose now" button that POSTs to `/api/callers/[callerId]/compose-prompt` and re-fetches staleness. Multi-playbook enrolment uses MAX across `Caller.enrollments[].playbook.composeInputsUpdatedAt`. 6 endpoint unit tests cover: no-active-prompt (stale), all-fresh, playbook-newer-than-prompt, multi-playbook MAX, multiple upstreams, caller-not-found. |
| 2026-05-25 | **Link 3 sub-contract — Caller-scope bumps landed (#830, Story 6/8).** `lib/compose/bump-timestamp.ts` exports `bumpPlaybookComposeTimestamp(playbookId)` and `bumpCallerComposeTimestamp(callerId)` — atomic single-column UPDATEs (P2025-tolerant) used by out-of-band compose-affecting writers. Wired into: `lib/agent-tuner/write-target.ts::writeBehaviorTarget` (playbook bump on successful PLAYBOOK-scope target write/remove), `writeCallerBehaviorTarget` (caller bump on successful CALLER-scope target write/remove), `app/api/calls/[callId]/ops/[opId]/route.ts` (caller bump on out-of-band LEARN memory writes), `app/api/goals/[goalId]/confirm/route.ts` (caller bump on goal confirm/dismiss — goals read by COMPOSE renderPromptSummary / simple / offboarding transforms), `app/api/student/assessment/route.ts` (caller bump on PRE/POST_TEST submission — pre-test score read by COMPOSE quickstart transform), `app/api/callers/[callerId]/route.ts` PATCH (caller bump on name/domain/role edits — caller name read by COMPOSE quickstart for the strip-name-questions logic). **Pipeline-internal writers excluded** by design: pipeline COMPOSE runs at the end of every pipeline invocation, so mid-pipeline bumps would set a timestamp later than the upcoming `ComposedPrompt.composedAt`, producing a spurious "not stale" verdict on the NEXT call. |
| 2026-05-25 | **Link 3 sub-contract — AnalysisSpec writer landed (#829, Story 5/8).** `lib/analysis-spec/update-analysis-spec-config.ts::updateAnalysisSpecConfig` is now the central writer for compose-affecting `AnalysisSpec` fields (`config`, `promptTemplate`, `isActive`, `scope`, `specRole`, `extendsAgent`). Routes the timestamp bump per spec scope: `SYSTEM` → `SystemSetting "compose_inputs_updated_at"` (global — every caller stale on next call), `DOMAIN` → `Domain.composeInputsUpdatedAt` when `domainId` option is supplied (warns + skips otherwise), `CALLER` → no-op. ESLint rule `hf-spec/no-direct-config-write` (severity error) blocks direct `prisma.analysisSpec.update({data:{config\|...:...}})` outside the helper + allowlist (seeds, scripts, recompile/triggers routes, content-trust sync, curriculum enricher). Migrated 4 sites: `app/api/analysis-specs/[specId]/route.ts` PUT + PATCH, `app/api/specs/[specId]/route.ts` PATCH, `lib/chat/admin-tool-handlers.ts::handleUpdateSpecConfig` (Cmd+K). The wizard course-identity upsert at `lib/chat/wizard-tool-executor.ts` is CREATE-only and inherits staleness via the linking Playbook write. One ESLint-disable retained at `lib/domain/generate-content-spec.ts::patchContentSpecForContract` (writer accepts TxClient; helper can't enlist in interactive tx — TODO #834). |
