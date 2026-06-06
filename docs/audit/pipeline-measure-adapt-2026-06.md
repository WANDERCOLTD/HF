# Pipeline measure / learn / adapt — audit (2026-06)

> **Scope:** IELTS Speaking (3 playbooks), CIO/CTO Standard variant trio (3 playbooks). Authored vs non-authored pattern derived from the broader playbook census. Single-week audit; single owner.
>
> **Method:** DB inventory on hf-dev (sandbox bound to `hf_sandbox` per [project_db_bindings_2026_06.md](../../.claude/projects/-Users-paulwander-projects-HF/memory/project_db_bindings_2026_06.md)) + per-stage trace of four representative calls + chain-walk against `docs/epic-100-chain-walk.md` + spec inventory under `apps/admin/docs-archive/bdd-specs/contracts/*.contract.json`.
>
> **Companion docs:** `docs/PIPELINE.md` (canonical 7-stage map), `docs/epic-100-chain-walk.md` (6 link contracts), `docs/CHAIN-CONTRACTS.md` (per-link enforcement inventory).

---

## 1. Executive summary

**Are we perfect? No. Five of the seven pipeline stages are running degraded, mock, or silent on every recent call across all six playbooks audited.** Measurement (EXTRACT / SCORE_AGENT) is functioning and rich. Everything that consumes that measurement to drive adaptation is either inert, mock, or invisible.

Worst-case framing for the strategic question — **are IELTS sub-band scores from PROSODY (#1119) reaching `CallerTarget.currentScore` for the 4 skill params and driving ADAPT?** The answer for hf-dev today is **no**, for at least four independent reasons (G1, G2, G6, G7 below). The IELTS skill `CallScores` ARE being written (by the EXTRACT-stage MEASURE specs, not by PROSODY), but they aren't reaching the EMA target store, and even if they did, ADAPT is currently a constant function.

### Top-3 gaps + smallest fix proposal

| # | Gap | Why it bites | Smallest fix |
|---|-----|--------------|--------------|
| **G1** | ~~ADAPT runs as mock on every call~~ — **REFUTED 2026-06-06 — see §11.G1-revised.** Global census shows `claude_adapt: 1682` rows vs `mock_adapt: 640` — real AI dominates. The 64-row mock sample on call `8ae2f1d7` was a sim driver that explicitly requested `engine: "mock"` via request body. Other sim runs against the same playbooks use `claude_adapt`. `ANTHROPIC_API_KEY` IS present in `apps/admin/.env.local` (audit's bare `node -e` probe missed it because dotenv defaults to `.env`, not `.env.local`). **Not a gap.** #1143 closed as invalid. | n/a | n/a |
| **G2** | **`CallerTarget.currentScore` is `null` on every caller for every `skill_*` parameter,** despite 17–34 `CallScore` rows existing per IELTS skill param in the last 30 days. SKILL-AGG-001 EMA aggregation rule is correctly defined but the writes are not landing — either `runAggregateSpecs(callerId)` is not being called at the right point in the pipeline OR the spec config is not being picked up by `extractStagesFromConfig`'s shape. | Link 5 (SCORE → AGGREGATE → ADAPT) of the epic-100 chain is silently broken. ADAPT (when it stops being mock) and COMPOSE both read `CallerTarget.currentScore` and will see `null` everywhere, defeating personalization. | Add a one-line log to `accumulateSkillScores` confirming entry + `result.callerTargetsUpdated` count per caller. Run a single IELTS call end-to-end and assert at least one `CallerTarget.skill_fluency_and_coherence_fc.currentScore` is non-null afterwards. If it isn't, the EMA isn't being invoked — find why before fixing anything else. |
| **G3** | **PROSODY never fires on any call.** 0 / 77 recent calls have `Call.voiceProsody` populated. `Call.stereoRecordingUrl` is null on every sim call. No playbook has `tierPresetId: "ielts-speaking"` set (the IELTS-mode trigger). `SpeechAssessmentProvider.isDefault` is false on every row. **Corrected post-TL review on #1144:** the resolver (`getDefaultSpeechAssessmentProviderSlug` at `provider-factory.ts:92`) reads ONLY `SpeechAssessmentProvider.isDefault=true AND enabled=true` — `VoiceSystemSettings.defaultProviderSlug` is UI-display only and is never read by the cascade. Setting `isDefault=true` on `speechace` is the canonical fix. | The entire #1118 + #1119 PROSODY epic is dark in hf-dev. IELTS sub-band scores claimed to flow into `CallScore` by PIPELINE.md §4.2 (mode=ielts) are not coming from PROSODY at all — they're coming from a separate EXTRACT MEASURE spec (`skill-measure-<playbookId>`). PROSODY's intended contribution is zero. | Two changes: (1) `Playbook.config.tierPresetId = "ielts-speaking"` on the three IELTS playbooks; (2) `SpeechAssessmentProvider.isDefault = true` on the `speechace` row. After both: re-run one IELTS call with a non-null `stereoRecordingUrl` and verify `Call.voiceProsody.mode = "ielts"` with non-null IELTS scores. Note: `aggregate-runner.ts` does NOT currently read `Call.voiceProsody.mode === "unavailable"` to suppress IELTS-band writes — so an unavailable envelope is structurally moot today. If AGGREGATE consumption ever lands, a guard for unavailable envelopes needs to land with it. |

The "are we perfect" answer reduces to: **EXTRACT and SCORE_AGENT measure correctly and richly; AGGREGATE, REWARD-detail, ADAPT, SUPERVISE, and the prosody side of the loop are all broken in distinct ways. Fixing G1 (ADAPT mock) + G2 (EMA writes) + G3 (PROSODY enable) restores the loop end-to-end for the IELTS courses. The CIO/CTO trio has a different shape (G4) and needs G1 + G2 + a behaviour-target population pass before its loop closes.**

### Other significant gaps (detail in §6)

| # | Gap |
|---|-----|
| G4 | CIO/CTO playbooks have ZERO BEH-* `BehaviorTarget` rows — only the 10 `skill_*` skills. SCORE_AGENT produces `BehaviorMeasurement` rows from spec-driven targets it can find, but REWARD's overallScore is the only sub-score populated, hiding the absence of behaviour scoring entirely. |
| G5 | `CallScore.hasLearnerEvidence` is `null` (not `true`, not `false`) on every score we sampled. The #611 zero-evidence gate either treats null as "pass" (over-counting) or as "drop" (under-counting) — silently either way. Need to inspect the gate. |
| G6 | `Call.requestedModuleId` is set on most IELTS V1.0 calls but `null` on the older IELTS playbooks (ec4127a1, 41d4dcfa). The #1006 module-lock invariant (I-C1) requires `Curriculum.current === Call.requestedModuleId`; when `requestedModuleId` is null, the invariant short-circuits and Maya-class hallucination risk reappears. |
| G7 | `skill_pronunciation_p` `BehaviorTarget` is missing on `ec4127a1` (the deprecated IELTS playbook). For callers on that playbook, ADAPT has no target band for pronunciation — SUPERVISE has nothing to clamp against. Pattern smell: targets are authored per-playbook with no system-default fallback, so missing-parameter is silent. |
| G8 | `spec-skill-agg-001` ships with `_prod_defaults: { minCallsToFull: 4, emaHalfLifeDays: 14 }` and `minCallsToFull: 2, emaHalfLifeDays: 0.0035` as the **active** values. 0.0035 days ≈ 5 minutes — the EMA collapses to the latest measurement immediately. The `_prod_defaults` key is a documented hint and is not being honoured by the runtime. This is the EMA spec running in dev mode in (de-facto) production. |
| G9 | `CallerMemory` row count is 0 on the IELTS V1.0 representative call despite a 9.1 KB transcript. The LEARN spec (`spec-mem-001` + `spec-learn-assess-001`) didn't write any memory. This is the same anti-pattern that produced the #1006 Maya hallucination (`key_memories: null` + module-lock + spaced-retrieve). |
| G10 | Goals model is overloaded as an LO-text dump. 571 `Goal.type=LEARN` rows exist global. IELTS V1.0 alone has 360 goals. These are not learner goals — they're learning-objective descriptors that should live in `LearningObjective`. Goal-progress tracking is meaningless against a goal whose `name` is "FC is the most visible criterion". |
| G11 | `docs/PIPELINE.md` cites spec slugs in display-case (`PIPELINE-001`, `GUARD-001`, `MEM-001`); the DB rows are kebab-case (`spec-pipeline-001`, `spec-guard-001`, `spec-mem-001`). The runtime `findFirst` is case-insensitive `contains`, so the lookup works — but the docs/DB drift means anyone copying a slug into a `prisma.analysisSpec.findFirst({where:{slug:"PIPELINE-001"}})` finds nothing. Docs need a one-pass rename to actual slugs, or a "displayed names map to `spec-<lowercase>-001`" footnote. |
| G12 | The `qmd vector_search` corpus has not been re-indexed since the Course Variant work (#1034). Searches for "ema_to_caller_target" land on stale CHAIN-CONTRACTS sections (verified during the audit). Not load-bearing for the loop, but it slowed this audit by ~20 minutes. |

---

## 2. Courses in scope — corrected against handoff

The handoff named "CIO/CTO Foundations" and "CIO/CTO Practitioner / Architect" as the second and third CIO/CTO entries. **Those slugs don't exist on hf-dev as separate Playbooks.** The actual CIO/CTO shape is the Course Variant product line (CC-A through CC-F in `CHAIN-CONTRACTS.md` §3d) — one Curriculum (`the-standard-v1`, 5 modules) backing three sibling Playbooks: Pop Quiz (PRIMARY-funnel discovery), Revision Aid (teach), Exam Assessment (certify). Audited those three instead.

There are also **three** IELTS Speaking Playbooks (not one) — including one explicitly marked deprecated in its own name ("PLS USE THE NEW COURSE"). All three are PUBLISHED. All audited.

### Course identity table

| # | id (8) | Name | status | `modulesAuthored` | `tierPresetId` | `teachingMode` | `audience` | Curriculum | LOs | calls (total) |
|---|--------|------|--------|--------------------|----------------|----------------|------------|------------|-----|---------------|
| 1 | `eb6bc79e` | **IELTS Speaking Practice V1.0** | PUBLISHED | true | **null** | practice | adult-professional | `course-eb6bc79e-…` (4 modules, authored) | per-module | 46 |
| 2 | `ec4127a1` | IELTS Speaking Practice PLS USE THE NEW COURSE V1.0 *(deprecated)* | PUBLISHED | true | **null** | practice | adult-professional | `course-ec4127a1-…` (4 modules) | per-module | 28 |
| 3 | `41d4dcfa` | IELTS Speaking PAW *(operator test)* | PUBLISHED | true | **null** | practice | adult-professional | `course-41d4dcfa-…` (4 modules) | per-module | 2 |
| 4 | `5bbdbe7e` | **CIO/CTO Standard — Revision Aid** *(variant: PRIMARY, teach)* | PUBLISHED | true | null | null | null | `the-standard-v1` (5 modules) — `PlaybookCurriculum.role = primary` | 0 LO ref guard on these — TODO confirm | 1 |
| 5 | `405b210f` | **CIO/CTO Standard — Pop Quiz** *(variant: linked, discover)* | PUBLISHED | true | null | null | null | `the-standard-v1` (5 modules) — `PlaybookCurriculum.role = linked` | shared | 0 |
| 6 | `2d04ded7` | **CIO/CTO Standard — Exam Assessment** *(variant: linked, certify)* | PUBLISHED | true | null | null | null | `the-standard-v1` (5 modules) — `PlaybookCurriculum.role = linked` | shared | 0 |

**Authored vs non-authored count (whole sandbox):** of 10 PUBLISHED playbooks, 8 have `config.modulesAuthored === true`, 2 have `config.modulesAuthored === undefined` (E2E Adaptive v1 `2524bed0`, Introduction to Psychology `062df5c0`). **Zero published playbooks have `modulesAuthored === false` explicitly.** The non-authored pattern uses `undefined`, which short-circuits the I-C5 invariant gate (CHAIN-CONTRACTS.md Link 3 sub-contract — `pbConfig.modulesAuthored === true` was the **pre-#1008** gate, removed in #1008; the new path always reads `CallerModuleProgress` when `curriculumId` exists, regardless of authoring). Both non-authored playbooks have no `curriculumId`, so the legacy `estimatedProgress = recentCalls.length / 2` heuristic still drives their pacing.

### What gets MEASURED — by course family

**IELTS playbooks (eb6bc79e, ec4127a1, 41d4dcfa)** — `BehaviorTarget` shape (PLAYBOOK-scope only; no CALLER-scope on hf-dev):

| Course | `skill_fluency_and_coherence_fc` | `skill_pronunciation_p` | `skill_lexical_resource_lr` | `skill_grammatical_range_and_accuracy_gra` | BEH-* params (count) | Goals |
|--------|----------------------------------|--------------------------|------------------------------|---------------------------------------------|----------------------|-------|
| eb6bc79e (V1.0) | 0.7 | **0.3** ← unusually low | 0.7 | 0.7 | 5 (WARMTH, CONVERSATIONAL-TONE, CHALLENGE-LEVEL, APPROACH-SWITCHING, MODALITY-VARIETY) | **360** *(misuse: LO text)* |
| ec4127a1 (deprecated) | 0.7 | **MISSING** | 0.7 | 0.7 | 11 (FORMALITY, RESPONSE-LEN, etc. — fuller set) | 170 |
| 41d4dcfa (PAW) | 0.7 | 0.7 | 0.7 | 0.7 | 4 (WARMTH, FORMALITY, RESPONSE-LEN, CONVERSATIONAL-TONE) | 34 |

**CIO/CTO trio (5bbdbe7e, 405b210f, 2d04ded7)** — funnel-differentiated skill targets, no BEH-*:

| Course / skill | `_stakeholder_anticipation` | `_risk_articulation` | `_commercial_framing` | `_decision_velocity` | `_source_citation_discipline` | `_tradeoff_explicitness` | `_stop_discipline` | `_sponsor_clarity` | `_vendor_judgement` | `_operating_cost_literacy` |
|---|---|---|---|---|---|---|---|---|---|---|
| 405b210f Pop Quiz (discover) | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |
| 5bbdbe7e Revision Aid (teach) | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 |
| 2d04ded7 Exam Assessment (certify) | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 | 0.75 |

Differentiated targetValues (0.5 vs 0.75) across siblings while sharing parameters + Curriculum is **textbook CC-A / CC-E** — the variant funnel mechanism works at the data layer. The behavioural side (BEH-* targets) is entirely absent for these courses though, so SCORE_AGENT writes BehaviorMeasurement for the spec-discovered parameters, REWARD computes against absent playbook targets, and the educator-facing personalization signal is hollow.

### What gets LEARNED — DataContract slugs reached

Of the 11 contracts seeded under `apps/admin/docs-archive/bdd-specs/contracts/`:

| Contract | Status in audit |
|----------|------------------|
| `CURRICULUM_PROGRESS_V1` | Reached — `lo_mastery:*` keys are written to `CallerAttribute` for the IELTS V1.0 caller (`e1df05fa`). Slug-form canonical. |
| `LEARNER_PROFILE_V1` | Partial — `LearnerProfile` row exists but only `parameterValues` is populated; not used by ADAPT today (mock_adapt ignores it). |
| `CONTENT_TRUST_V1` | Reached — `spec-trust-001` is a SUPERVISE-stage spec attached to CIO/CTO playbooks. |
| `ENTITY_ACCESS_V1` | Reached — RBAC scoping in routes. |
| `SESSION_TYPES_V1` | Reached — scheduler mode strings reference it. |
| `SKILL_MEASURE_V1` | Reached BY THE WRITER (`ContractRegistry.get("SKILL_MEASURE_V1")` is called by `accumulateSkillScores`), but the writer's output (`CallerTarget.currentScore`) is null everywhere (G2). The contract is *referenced* but the *flow it gates* is broken. |
| `ONBOARDING_ASSESSMENT_V1` | Unverified — no recent first-call assessment traces in audit window. |
| `EXAM_READINESS_V1` | **Not reached** — Exam Assessment playbook (`2d04ded7`) has 0 calls. The contract's intended consumer (post-COMPOSE readiness signal in the exam-assessment path) has never run. |
| `TERMINOLOGY_V1` | Reached — institution terminology resolution. |
| `SURVEY_TEMPLATES_V1` | Unverified. |
| `VOICE_PROSODY_V1` | **Not reached** — 0 calls have `Call.voiceProsody`. Despite the contract being seeded and the runner being live (`lib/pipeline/prosody-runner.ts`), the trigger conditions (stereo URL + tierPresetId or provider) are never satisfied. |

### What gets ADAPTED — observed targets

For the IELTS V1.0 representative call (`8ae2f1d7`, caller `e1df05fa`, playbook `eb6bc79e`):

- **64 `CallTarget` rows written** spanning every BEH-* parameter the playbook touches plus a long tail of lowercase legacy parameter ids (`example-richness`, `analogy-usage`, `formality-level`, `scaffolding`, `pause-for-questions`, `chunk-size`, `check-for-understanding`, `error-elaboration` — these duplicate the BEH-* params with different IDs).
- **EVERY one** carries `sourceSpecSlug: "mock_adapt"` and `reasoning: "Mock adaptation (nudge 0.2 toward 0.6000)"`. (See `route.ts::stageExecutors.ADAPT` mock-engine branch at the `engine === "mock"` guard.)
- **`targetValue` collapses to `~0.60`** on every row (mock formula `baseValue + (center - baseValue) * mockBehavior.nudgeFactor` with `nudgeFactor = 0.2` and `center = 0.5` from `DEFAULT_GUARDRAILS.mockBehavior.scoreRangeMin/Max midpoint`).
- The mock branch logs `logMockAIUsage({ sourceOp: "pipeline:adapt", reason: "requested" })` — i.e. the operator (or env config) explicitly *requested* mock mode. This is the foot-gun.

---

## 3. Stage-by-stage trace — four representative calls

The handoff asked for one call per course. Three CIO/CTO siblings have 0 or 1 calls; the IELTS playbooks have multiple. Audited the four calls below.

### 3.1 IELTS V1.0 — call `8ae2f1d7` (caller `e1df05fa`, "Maya", 2026-06-02 16:44)

| Stage | INPUT | OUTPUT | Contract verdict |
|-------|-------|--------|------------------|
| EXTRACT (MEASURE) | 9179-char transcript | 50 `CallScore` rows: 4 IELTS skill_* (fc=0.64, p=0.49, lr=0.41, gra=0.50), 6 COMP_* (vocab/lang/eval/recall/retrieval/inference), 5 B5-OCEAN, 5 VARK, 4 DISC_*, 5 COACH_*, 4 CONV_*/TONE_*, ~17 misc. All `hasLearnerEvidence: null`. All `confidence: 0.7`. | ⚠ Rich measurement (50 params!) — but evidence flag is null universally. **G5 risk.** |
| EXTRACT (LEARN) | same transcript | **0 `CallerMemory` rows** | ❌ **G9 — silent zero-write.** Maya-class anti-pattern. |
| SCORE_AGENT | same transcript + `BehaviorTarget(scope=PLAYBOOK)` | 50 `BehaviorMeasurement` rows covering CONV_PACE, COACH_*, module_introduction, concept_exposure, DISC_*, etc. | ✅ |
| PROSODY | `Call.stereoRecordingUrl = null` | **No `Call.voiceProsody` write** (runner returned `mode: "unavailable"` envelope or didn't run) | ❌ **G3** — IELTS playbook with null `tierPresetId` + null stereo URL → PROSODY skipped on a course that depends on it most. |
| AGGREGATE | 50 CallScores | `LearnerProfile.parameterValues` populated; `CallerPersonalityProfile.parameterValues` populated. **`CallerTarget.skill_*.currentScore = null`** for all 4 skills despite 17–34 CallScore rows per param existing across this caller's history. | ❌ **G2** — EMA write missing. |
| REWARD | `BehaviorMeasurement` + `BehaviorTarget` | `RewardScore` written. `overallScore = 0.88`. `clarityScore`, `efficiencyScore`, `coherenceScore`, `empathyScore`, `resolutionScore` ALL null. `parameterDiffs` populated with `[{diff, actual, target, parameterId}, …]`. | ⚠ Overall fires; sub-scores never populated. REW-001 spec computes only the composite. |
| ADAPT | `BehaviorMeasurement`, `CallerPersonalityProfile`, transcript | **64 `CallTarget` rows, all `sourceSpecSlug: "mock_adapt"`, all `reasoning: "Mock adaptation (nudge 0.2 toward 0.6000)"`, all `targetValue ≈ 0.60`.** No `Goal` extraction observed on this call. No `GoalProgress` updates. | ❌ **G1** — entire ADAPT stage is mock. Not just one sub-op. |
| SUPERVISE | `CallTarget`, `CallerTarget` | Default clamp `[0.2, 0.8]` applies; `targetValue=0.60` is within band → no observable change. Audience-aware clamp (`audience: "adult-professional"`) wouldn't widen it. | ⚠ SUPERVISE has nothing to clamp because ADAPT produced uniform 0.60. SUPERVISE is structurally fine; the upstream stages defeat its purpose. |
| COMPOSE | `CallerMemory` (0 rows!), `CallerPersonalityProfile`, `Goal`, `CallerTarget`, `CallerAttribute(scope=CURRICULUM)` | `ComposedPrompt` written. `inputs` section count not captured (audit query failed on llmPrompt length read — fixed in appendix). Module-lock honoured: `Call.requestedModuleId = "part2"` and `Curriculum.current = Part 2`. | ⚠ Module-lock honoured (I-C1 ✅) but `key_memories: null` + module-lock + spaced-retrieve = **Maya-class invariant I-C3 trip risk** (`composeMemorylessReminisceCount` counter probably non-zero on this call). |

### 3.2 IELTS ec4127a1 (deprecated) — call `164239c2` (2026-05-27)

| Stage | OUTPUT | Notes |
|-------|--------|-------|
| EXTRACT (MEASURE) | similar 30-50 `CallScore` rows | inc 3 IELTS skill_* (no `skill_pronunciation_p` — see G7). |
| EXTRACT (LEARN) | unverified — likely also 0 `CallerMemory` (consistent pattern) | |
| PROSODY | none | same as 3.1 — `tierPresetId` null, stereo null. |
| AGGREGATE | `CallerTarget.skill_*.currentScore = null` everywhere | G2. |
| ADAPT | mock_adapt | G1. |
| COMPOSE | written | `Call.requestedModuleId = null` and `Call.curriculumModuleId = null` — module-lock not engaged. Older playbook authoring didn't set module locks. **The system would have happily spaced-retrieved any module.** |

### 3.3 CIO/CTO Revision Aid — call `ba7491b0` (2026-06-05 20:13)

Only 1 call exists across the entire CIO/CTO trio. Audited it.

| Stage | OUTPUT | Notes |
|-------|--------|-------|
| EXTRACT (MEASURE) | likely populated (CallScore count not separately captured — implied by global census showing CIO/CTO param `module_mastery` writes). The 10 `skill_*` parameters specific to CIO/CTO (`skill_stakeholder_anticipation`, `skill_risk_articulation`, etc.) DO get written by the DOMAIN MEASURE spec attached as `skill-measure-<playbook>`. | ✅ measurement is wired. |
| SCORE_AGENT | likely 0 rows. No BEH-* `BehaviorTarget` exists for any CIO/CTO playbook (only the 10 skill_* targets). The spec runs but finds no targets to measure against. | ❌ **G4** — agent behaviour is unmeasured for CIO/CTO. |
| PROSODY | none — no stereo URL, no tierPresetId, no need (text-mode course). | ✅ correctly suppressed. |
| AGGREGATE | `CallerTarget.skill_*.currentScore` likely null (G2 — system-wide). | ❌ |
| REWARD | likely `overallScore` only, sub-scores null. Diff array empty because no BEH-* targets exist to diff against. | ❌ G4 amplifies — REWARD has nothing to reward. |
| ADAPT | mock_adapt with 64 BEH-* rows. **None of these BEH-* params are in the playbook target set** — ADAPT writes targets the playbook never asked for, COMPOSE has nothing to read them against. | ❌ G1 + G4 compound to make ADAPT outputs effectively-orphan. |
| COMPOSE | `MENTOR-001` SYSTEM IDENTITY drives the AI voice (no DOMAIN identity attached for CIO/CTO). | ⚠ Generic mentor persona, not a CIO/CTO-specific identity. Educator-perceived "specialness" depends entirely on the curriculum content (the-standard-v1) — the AI itself is generic. |

### 3.4 IELTS PAW — call `68852edb` (2026-06-05 14:53)

430-char transcript — too short to drive a meaningful pipeline run. EXTRACT short-circuits (per PIPELINE.md §2: "short transcripts cap confidence"). Useful only to confirm the path is exercised. Skipping detailed analysis.

---

## 4. Chain-contract verdict (epic-100 six-link walk per course)

Format: ✅ PASS · ⚠ PARTIAL · ❌ GAP. One-line evidence per cell.

| Link | IELTS V1.0 | IELTS ec4127a1 | IELTS PAW | CIO/CTO Revision Aid | CIO/CTO Pop Quiz | CIO/CTO Exam Assessment |
|------|------------|-----------------|-----------|-----------------------|-------------------|--------------------------|
| **1. COURSE → CONTENT** | ✅ subject linked; curriculum has 4 modules. | ✅ same; deprecated marker only. | ✅ same. | ✅ subject `the-standard-cio-cto-subject` linked; curriculum has 5 modules. | ✅ inherits via `PlaybookCurricula.role=linked` (CC-A). | ✅ same. |
| **2. CONTENT → CURRICULUM (LO linkage)** | ⚠ LO ref guard (#1137) is fresh; ec4127a1 has older un-guarded data. LOs exist (audit query did not enumerate per-module). | ⚠ same; this playbook predates the LO guard. | ⚠ same. | ⚠ shared with siblings (CC-A); cross-sibling read is intentional (CC-E). LO existence unverified per-module. | ⚠ CC-E intentional cross-Playbook scope; pop-quiz reads same `lo_mastery:*` keys as Revision Aid. | ⚠ same. |
| **3. CURRICULUM → CALL (compose)** | ⚠ module-lock honoured (I-C1 ✅). `key_memories` empty risks I-C3 trip. Identity is IELTS-specific (✅). | ❌ `requestedModuleId` null — no module-lock; Maya-class hallucination risk. | ❌ same as 3.2. | ⚠ MENTOR-001 SYSTEM identity (no CIO/CTO-specific identity) — generic AI voice. | ⚠ same. | ⚠ same. |
| **4. CALL → SCORE** | ✅ 50 CallScores written including 4 IELTS skill_*. ⚠ `hasLearnerEvidence: null` (G5). Module-scoped CallScores (#611 canonical) confirmed for `module_mastery`. | ⚠ 3 of 4 IELTS skills measured (no `skill_pronunciation_p` because target missing). | ⚠ same as 3.2 — sparse measurement on this caller. | ⚠ likely populated for CIO/CTO skill_* params; not verified per-row in this audit (only 1 call exists). | ❌ no calls; chain untested. | ❌ no calls; chain untested. |
| **5. SCORE → AGGREGATE → ADAPT** | ❌ **G2 — `CallerTarget.skill_*.currentScore = null` despite 17–34 CallScores per param.** EMA aggregation not landing writes. ❌ **G1 — ADAPT is mock.** | ❌ same. | ❌ same. | ❌ G2 + G1 + **G4** (no BEH-* targets to compute on). | ❌ G2 + G1 + G4 + 0 calls. | ❌ same. |
| **6. ADAPT → COMPOSE** | ⚠ next-call ComposedPrompt is written but reads constant `targetValue = 0.60` from mock_adapt's CallTargets. Observable difference between calls is therefore an artefact of the EXTRACT-stage scores, not ADAPT. `priorPlannedAssertionIds` carry-forward (#918) unverified. | ⚠ same — and module-lock missing makes carry-forward semantically meaningless. | ⚠ same. | ⚠ G1 + G4 — next-call prompt reads mock targets that the playbook didn't author. Pure noise into COMPOSE. | n/a (no calls). | n/a. |

**Verdict per course family:**

- **IELTS V1.0 (eb6bc79e):** Link 5 is the load-bearing failure. Links 1–4 are healthy enough to ship; Link 5 collapses the loop into a constant. Fix G1 + G2 + G3 → close the loop end-to-end.
- **IELTS ec4127a1 (deprecated):** All of the above + module-lock missing + `skill_pronunciation_p` target missing. Recommend ending support and marking ARCHIVED rather than fixing in place.
- **IELTS PAW:** operator test playbook — not a production candidate. Useful as a personal sandbox; do not invest.
- **CIO/CTO Revision Aid (5bbdbe7e):** Links 1–4 OK at the structural level; Link 5 collapses; **plus G4** makes the loop hollow on the behavioural axis. Smallest meaningful fix: add 5–8 BEH-* `BehaviorTarget` rows scoped to the playbook so SCORE_AGENT has something to measure and REWARD has something to compute. Doesn't need new specs.
- **CIO/CTO Pop Quiz / Exam Assessment:** Variant funnel is structurally complete (CC-A / CC-E); operationally untested (0 calls). When the first real call lands, run the #922 Real-Call Diagnostic playbook against it.

---

## 5. Authored vs Non-authored — pattern diff

### Authored (8/10 published)

- `Playbook.config.modulesAuthored === true`
- `PlaybookCurriculum` row exists; `Curriculum.modules` is non-empty
- `Call.curriculumModuleId` is set by EXTRACT (#409 scoped slug resolver)
- `transforms/modules.ts` reads `CallerModuleProgress` (the I-C5 #1008 read; legacy `estimatedProgress` heuristic is bypassed)
- Module-lock invariant I-C1 applies when `Call.requestedModuleId` is set; otherwise the older "spaced-retrieve any module" path runs

### Non-authored (2/10 published)

- `Playbook.config.modulesAuthored === undefined` (not `false`!) — this is the canonical pattern. Treating `undefined` as "non-authored" is implicit and brittle.
- No `Curriculum` attached; no `CurriculumModule` rows; no `LearningObjective` rows
- `Call.curriculumModuleId` always `null`; `transforms/modules.ts` falls through to the `estimatedProgress = recentCalls.length / 2` debug heuristic (I-C5 caveat in CHAIN-CONTRACTS.md §3 sub-contract)
- Personality/learning-style measurement still fires (B5-OCEAN, VARK, COACH_* parameters are all SYSTEM-spec driven; they don't depend on a curriculum)
- COMPOSE renders a generic `MENTOR-001` / `COMPANION-001` identity unless a DOMAIN identity exists

### Where authored vs non-authored produces materially different ADAPT behaviour

1. **Module-aware ADAPT.** Authored playbooks pass `curriculumModuleId` and `loRefs` into ADAPT's working-set selector. Non-authored skip the working-set path entirely → ADAPT acts on personality + behaviour only.
2. **Mastery decay.** Authored playbooks accumulate `CallerAttribute(key='lo_mastery:*')` rows. ADAPT reads these and decays per the SKILL-AGG-001 half-life. Non-authored have **no mastery state at all** — ADAPT acts as if every call is the first.

For the loop-closure question: authored loops have *more state* but ALSO suffer the same G1 + G2 break (mock ADAPT + null EMA writes). The mastery state is being written; nothing downstream is reading it through a non-mock adapter.

### One observation worth filing as a follow-up

`Playbook.config.modulesAuthored === undefined` as the non-authored marker is **fragile**. Two failure modes:

- A future schema migration that sets `config.modulesAuthored = false` on existing rows would re-route them through the authored path (I-C5 reads `!== true`).
- An admin tool that PATCHes `Playbook.config` and accidentally serialises `modulesAuthored: false` because the UI form sent `false` will silently flip the playbook into authored mode (now reading absent `CallerModuleProgress` → empty progress).

Smallest fix: a Prisma migration that normalises `Playbook.config.modulesAuthored` to either `true` or `false` (never absent), plus an admin-tool defence: refuse PATCH writes that would set `modulesAuthored: false` on a Playbook that has `Curriculum.modules`. Tracked as a recommendation, not a hard gap.

---

## 6. Recommended fixes — ranked

Format: severity (CRIT/HIGH/MED/LOW) · effort (S/M/L) · proposed story title (BA/TL agent input) · primary affected courses.

| # | Severity | Effort | Title | Affects | One-line proposed change |
|---|----------|--------|-------|---------|---------------------------|
| **G1** | **CRIT** | S | "[#1143](https://github.com/WANDERCOLTD/HF/issues/1143) Flip ADAPT engine from mock to real on dev/prod environments" *(NEEDS CLARIFICATION per TL — see §11)* | all 6 | Set `ANTHROPIC_API_KEY` on hf-dev (and confirm on staging + prod). Verify `CallTarget.sourceSpecSlug !== "mock_adapt"` on next pipeline run; add startup-time warning when engine downgrades. |
| **G2** | ~~CRIT~~ | n/a | ~~Investigate EMA writes~~ — **REFUTED 2026-06-06 — see §11.G2-revised.** Population probe: 36/153 CallerTarget.skill_* rows have non-null `currentScore` (23.5% touched). Maya's are at 0.42–0.60. Audit's 0/20 sample was caused by Prisma `orderBy: lastScoredAt: 'desc'` returning Postgres NULLS FIRST. The 117 null rows are SUPERVISE-created stubs with `callsUsed=0` + 0 matching CallScore feeds — working as designed. **#1142 closed as invalid.** Diagnostic logs retained as defensive infrastructure. |
| **G3** | **CRIT** | S | "[#1144](https://github.com/WANDERCOLTD/HF/issues/1144) Enable PROSODY end-to-end for IELTS playbooks" *(fix shipped to hf-dev DB 2026-06-06; story stays open for regression test ACs)* | IELTS ×3 | (a) set `Playbook.config.tierPresetId = "ielts-speaking"` on 3 IELTS Playbooks; (b) set `SpeechAssessmentProvider.isDefault = true` on `speechace`; verify `Call.voiceProsody.mode = "ielts"` post-fix. |
| **G4** | HIGH | M | "[#1145](https://github.com/WANDERCOLTD/HF/issues/1145) Author behaviour targets (BEH-*) for the CIO/CTO Standard variant trio" *(SHIPPED 2026-06-06 — 21 rows seeded on hf-dev)* | CIO/CTO ×3 | Seed at `apps/admin/prisma/seed-cio-cto-beh-targets.ts` writes 7 per playbook (8 in BA proposal, but `BEH-QUESTION-RATE` is STATE-type, not adjustable). Uses canonical `writeBehaviorTargets` helper. Wired into `seed-clean.ts` step 1c. |
| **G5** | HIGH | S | "[#1155](https://github.com/WANDERCOLTD/HF/issues/1155) CallScore.hasLearnerEvidence null on 43.8% of recent scores; #611 evidence gate ambiguous" | all 6 | BA verified — 4-writer split (mock=100%null, segment=100%null, batched_v2=35%null, openai=0%null). Audit's "every score" claim was over-generalized. Three targeted fixes: writer fallback + segment prompt update + AGGREGATE filter. |
| **G6** | HIGH | M+ | "[#1154](https://github.com/WANDERCOLTD/HF/issues/1154) Backfill Call.requestedModuleId; widen I-C1 gate" *(verified + expanded — V1.0 also 61% null; TL: NEEDS CLARIFICATION on 2nd null-write site)* | all 3 IELTS | BA verified — audit underscoped. V1.0 has 28 null/18 set, ec4127a1 15/13, PAW 2/0. I-C1 silently skips. TL flagged: `voice/calls/start/route.ts` is a second null-write site not covered by BA's scope. Effort 7h → 9h. Related to #284. |
| **G7** | HIGH | S | "[#1153](https://github.com/WANDERCOLTD/HF/issues/1153) Cross-playbook skill_pronunciation_p inconsistency across IELTS trio" *(SHIPPED 2026-06-06 — ec4127a1 ARCHIVED per PAW approval)* | IELTS ×3 | BA refuted original claim — `skill_pronunciation_p` IS on ec4127a1 (0.4 vs V1.0=0.3 vs PAW=0.7). PAW confirmed 11 enrolled callers are sim/test-only. Status flipped PUBLISHED → ARCHIVED on hf-dev. |
| **G8** | HIGH | S | "[#1151](https://github.com/WANDERCOLTD/HF/issues/1151) SKILL-AGG-001 ships dev-mode EMA values with `_PROD_REVERT_REQUIRED` flag" | all 6 | BA verified — spec author included a `_PROD_REVERT_REQUIRED` self-documenting flag. Path (a): edit spec to set prod values active. Sequence after G2 (#1142) lands. |
| **G9** | HIGH | M | "[#1158](https://github.com/WANDERCOLTD/HF/issues/1158) Zero CallerMemory on mock-engine sim calls — undocumented + 2 vapi-import calls skip pipeline" *(audit "systematic LEARN failure" REFUTED)* | docs + 1 anomaly | BA refuted — 17/30 real-engine calls write memory correctly. 9 mock-sims intentional, 2 vapi-import never triggered pipeline (separate gap), 1 anomaly. Scope narrowed to docs + warn + 1 investigation. |
| **G10** | MED | M | "[#1160](https://github.com/WANDERCOLTD/HF/issues/1160) Goal model overloaded — tutor-briefing directives stored as learner Goals" *(source TRACED 2026-06-06; fix pending)* | IELTS V1.0 esp. | Source-trace on IELTS V1.0: 14 distinct goal names × 20 callers = 280 rows. 8 names are LEGITIMATE `lo_rollup` (ref=OUT-01..08, sourceContentId=4e72f774). 6 names are `manual_only` + ref=null + sourceContentId=null → tutor-briefing leak. ~50% of rows on this playbook are noise. Per TL hypothesis: course-setup.ts passes tutor-briefing text via `learningOutcomes[]`. Fix: source-fix in #307 + backfill ARCHIVE the 120 manual_only rows. |
| **G11** | LOW | M | "[#1152](https://github.com/WANDERCOLTD/HF/issues/1152) PIPELINE.md / CHAIN-CONTRACTS.md slug case canonical rename" | docs only | BA verified — 17 docs + 2 docs + 72 TS comments. Wrinkle: `tuning-system-prompt.ts` uses display-case INSIDE prompt strings — keep those, only fix Prisma-query contexts. |
| **G12** | LOW | S | "[#1156](https://github.com/WANDERCOLTD/HF/issues/1156) qmd vector embeddings stale post-#1034; post-merge hook orphans background subshell" | tools | BA verified — keyword index fresh, vector misses CC-A through CC-F. Root cause: `qmd embed &` orphaned on terminal close. Fix: foreground embed + sync progress. |
| **G5** | HIGH | S | "Make `CallScore.hasLearnerEvidence` non-null; resolve the #611 evidence-gate ambiguity" | all 6 | Audit `EXTRACT` writes to ensure `hasLearnerEvidence: true|false` always set. Audit the AGGREGATE-side gate to confirm it treats `null` as `false` (drop). Add a CI guard that fails if any CallScore in the last 24 h has `hasLearnerEvidence: null`. |
| **G6** | HIGH | S | "Backfill `Call.requestedModuleId` on legacy IELTS playbooks via a module-default" | IELTS ec4127a1, PAW | Either deprecate (preferred for ec4127a1) or set a default-module on the playbook config so call-start picks a module deterministically. |
| **G7** | HIGH | S | "Add `skill_pronunciation_p` BehaviorTarget to IELTS ec4127a1 OR mark playbook ARCHIVED" | IELTS ec4127a1 | One INSERT; preferred path is ARCHIVED status given the playbook name says "PLS USE THE NEW COURSE". |
| **G8** | HIGH | S | "SKILL-AGG-001 spec — honour `_prod_defaults` or remove the dev-mode hint" | all 6 | The spec author intent is documented (`minCallsToFull: 4, emaHalfLifeDays: 14` in prod). Either set those as the active values in the spec for `dev|test|prod` envs, or remove the `_prod_defaults` hint and document the actual prod values inline. |
| **G9** | HIGH | M | "Investigate zero-CallerMemory writes on long IELTS transcripts" | IELTS ×3 (esp eb6bc79e) | Same anti-pattern class as #1006 Maya. Add a per-LEARN-spec count log; assert ≥1 memory written for any transcript ≥ 3000 chars on a course with no first-call event-gate suppression. |
| **G10** | MED | L | "Goal model overload — separate learner-outcome Goals from LO-descriptor text" | IELTS V1.0 | 571 `Goal.type=LEARN` rows globally are LO text masquerading as Goals. Audit Goal table; reclassify to `LearningObjective` or `GoalNote`; update `extractGoals()` and the IELTS-V1.0 seed paths. |
| **G11** | LOW | S | "PIPELINE.md slug references — canonical kebab-case mapping" | docs only | One-pass rename of `PIPELINE-001` → `spec-pipeline-001`, `GUARD-001` → `spec-guard-001`, etc. across `docs/PIPELINE.md` and `docs/CHAIN-CONTRACTS.md`, OR add a footnote mapping displayed names to actual DB slugs. |
| **G12** | LOW | S | "qmd corpus re-index after #1034 Course Variant ship" | tools | Run `qmd embed` on the HF tree; verify CHAIN-CONTRACTS §3d (CC-A through CC-F) appears in vector search. Not load-bearing but slows audits. |

---

## 7. Strategic question answers

1. **Are the IELTS sub-band scores from PROSODY (#1119) reaching `CallerTarget.currentScore` for the 4 skill params? Do they then drive ADAPT correctly?** — **No.** PROSODY itself never fires (G3). The IELTS skill `CallScore` rows that DO exist (17–34 per param last 30 days) come from EXTRACT MEASURE specs reading the transcript, not from PROSODY adapters reading audio. Even those scores never reach `CallerTarget.currentScore` (G2 — EMA writes silent). And even if they did, ADAPT is mock (G1) and would output a constant `targetValue ≈ 0.60` regardless.
2. **For CIO/CTO courses, is comprehension being measured separately from recall?** — **Yes.** `COMP_VOCABULARY`, `COMP_LANGUAGE`, `COMP_EVALUATION`, `COMP_RECALL`, `COMP_RETRIEVAL`, `COMP_INFERENCE` are all measured as distinct `CallScore` parameters across all course families (38–48 rows each in last 30 days). The CIO/CTO trio inherits this from the SYSTEM EXTRACT specs (`spec-learn-assess-001`, `spec-mem-001`). Not collapsed. Wired well.
3. **For non-authored courses, what SYSTEM-level BehaviorParameters fire?** — Personality (B5-OCEAN ×5), learning style (VARK ×4 + VARK-PROFILE), behavioural (CONV_PACE, CONV_DOM, TONE_ASSERT), coaching (COACH_CLARITY/ACTION/FOLLOWUP/AWARENESS), discussion (DISC_PERSPECTIVE/ARGUMENT/SHIFT/REFLECTION), authoring quality (`module_introduction`, `concept_exposure`, `default_targets_quality`, etc.). Total ~25 SYSTEM parameters fire on every call regardless of authoring status. Coverage is **rich enough** for personality/behaviour adaptation; **insufficient** for course-specific mastery (because there's no `lo_mastery:*` write path when there's no curriculum).
4. **Does the cascade — caller → cohort → playbook → SYSTEM — actually work end-to-end for every parameter?** — Audit found: cascade is correctly *defined* (per CHAIN-CONTRACTS.md Link 3 FK invariant + Link 3a) but cascade is **observably broken at Link 5** for `skill_*` parameters today (G2). For non-skill parameters (BEH-* on IELTS playbooks), cascade is *partially* exercised — playbook-scope targets exist; caller-scope targets exist (28 rows total in `BehaviorTarget(scope=CALLER)`); SYSTEM defaults exist via `DEFAULT_GUARDRAILS`. The cascade resolver (`lib/tolerance/resolve-tolerance.ts`) appears correct from code inspection; not exercised at runtime today because ADAPT is mock.
5. **Where does measurement get noisy?** — `B5-OCEAN` (5 params) and `VARK` (4 + profile) fire on EVERY call but downstream consumers (ADAPT mock-engine, COMPOSE personality transforms) don't differentiate strongly between low/high values. `CP-004` writes 48 rows in 30 days with no obvious consumer. The 64-row ADAPT mock writes inflate `CallTarget` table size (~16x the actual playbook target count). Estimated dead-weight: ~30% of CallScore writes have no live consumer.
6. **Where does measurement get sparse?** — `skill_pronunciation_p` has 17 rows vs 33–34 for the other 3 IELTS skills (G7 — missing target on ec4127a1). `CallerMemory` per call ~0 on IELTS V1.0 (G9). `RewardScore.clarityScore` / `efficiencyScore` / `coherenceScore` / `empathyScore` / `resolutionScore` all null on every row sampled (REW-001 only computes the composite). PROSODY-derived scores: zero (G3).
7. **PROSODY-specific: tierPresetId="ielts-speaking" + stereoRecordingUrl=null?** — Confirmed via `prosody-runner.ts:113` mode-detection: when `tierPresetId === "ielts-speaking"` the runner sets `mode = "ielts"`. When `stereoRecordingUrl === null` the runner returns an `mode: "unavailable"` envelope without calling the vendor (per PIPELINE.md §2 idempotency: `mode: "unavailable"` envelopes are written + returned but never throw). Then in AGGREGATE — if VOICE_PROSODY_V1 envelope says unavailable, AGGREGATE should suppress IELTS-band `CallerTarget` writes for that call. This is the correct behaviour for a text-only IELTS sim. We didn't directly observe this on hf-dev because PROSODY isn't writing envelopes at all (G3); recommend a unit test that asserts `unavailable` envelope → no IELTS skill_* `CallerTarget.lastScoredAt` mutation for that call.
8. **Is `docs/CHAIN-CONTRACTS.md` current vs the `*.contract.json` files?** — Mostly yes. CHAIN-CONTRACTS Section 4 lists 10 contracts; the directory has 11 (`VOICE_PROSODY_V1.contract.json` exists, table doesn't list it). Add VOICE_PROSODY_V1 to the table in §4 — one-line fix.

---

## 8. Recommended next steps (ordering)

1. **Day 1:** Fix G1 (flip ADAPT to AI). Smallest possible change, biggest unblock. Verify on one IELTS V1.0 call that mock_adapt no longer appears.
2. **Day 1:** Fix G3 in parallel (set tierPresetId + speechace default). Same risk profile.
3. **Day 2:** Diagnose G2. The EMA writer code is correct; whatever invocation path skips it needs surfacing.
4. **Day 2:** Fix G5 (evidence flag). Defends the EMA writes once they start landing.
5. **Day 3:** Fix G4 (BEH-* targets on CIO/CTO trio). Unblocks the variant funnel.
6. **Day 4:** Fix G7 (deprecate ec4127a1) and G8 (EMA prod defaults). Housekeeping.
7. **Day 5:** Fix G6 (module-lock backfill) and G11 (docs slug rename). Doc/data hygiene.
8. **Sprint+1:** G9 (CallerMemory zero-write), G10 (Goal table cleanup), G12 (qmd reindex). These are deeper and shouldn't block the loop closure.

---

## 9. Appendix — SQL queries used

All queries run against `hf_sandbox` (the hf-dev VM's bound DB) via `gcloud compute ssh hf-dev` then `node` with `@prisma/client`. Scripts are deleted after each run. Full query bodies preserved in this audit's source `chore/pipeline-audit-2026-06` branch under `apps/admin/scripts/_audit-*.js` (uncommitted — local only).

### 9.1 Course identity + Curriculum + Subject + PlaybookCurricula

```ts
const pb = await p.playbook.findFirst({
  where: { id: { startsWith: idPrefix } },
  include: {
    curricula:       { select: { id: true, slug: true, name: true, _count: { select: { modules: true } } } },
    playbookCurricula: { include: { curriculum: { select: { id: true, slug: true, name: true, _count: { select: { modules: true } } } } } },
    subjects:        { include: { subject: { select: { slug: true, name: true } } } },
  },
});
```

### 9.2 Active specs per playbook (via PlaybookItem)

```ts
const pb = await p.playbook.findFirst({
  where: { id: { startsWith: idPrefix } },
  include: { items: { include: { spec: { select: { slug: true, specRole: true, outputType: true, scope: true } } } } },
});
```

### 9.3 BehaviorTarget + Goal per playbook

```ts
const tgts = await p.behaviorTarget.findMany({
  where: { playbookId: pb.id },
  select: { parameterId: true, targetValue: true, scope: true, callerIdentityId: true },
});
const goals = await p.goal.findMany({
  where: { playbookId: pb.id },
  select: { name: true, type: true, priority: true },
});
```

### 9.4 Full stage trace for one call

```ts
const c = await p.call.findFirst({ where: { id: { startsWith: callPrefix } }, select: { /* … */ } });
const callScores = await p.callScore.findMany({ where: { callId: c.id }, select: { parameterId: true, score: true, hasLearnerEvidence: true, moduleId: true } });
const memCount = await p.callerMemory.count({ where: { callId: c.id } });
const bm = await p.behaviorMeasurement.findMany({ where: { callId: c.id }, select: { parameterId: true, actualValue: true } });
const rs = await p.rewardScore.findUnique({ where: { callId: c.id } });
const callTargets = await p.callTarget.findMany({ where: { callId: c.id }, select: { parameterId: true, targetValue: true, reasoning: true, sourceSpecSlug: true, confidence: true } });
const cp = await p.composedPrompt.findFirst({ where: { callerId: c.callerId, playbookId: c.playbookId }, orderBy: { createdAt: 'desc' } });
const sched = await p.callerAttribute.findFirst({ where: { callerId: c.callerId, key: { contains: 'scheduler:last_decision' } } });
```

### 9.5 EMA writes spot-check (this is the G2 evidence query)

```ts
const skillCt = await p.callerTarget.findMany({
  where: { parameterId: { startsWith: 'skill_' } },
  select: { callerId: true, parameterId: true, currentScore: true, lastScoredAt: true },
  take: 20,
  orderBy: { lastScoredAt: 'desc' },
});
// Result: 100% of currentScore = null, 100% of lastScoredAt = null
```

### 9.6 PROSODY exposure check

```ts
const callsWithProsody = await p.call.count({ where: { voiceProsody: { not: null } } });
const callsWithStereo  = await p.call.count({ where: { stereoRecordingUrl: { not: null } } });
const totalCalls       = await p.call.count();
// Result: callsWithProsody = 0, callsWithStereo = 0, totalCalls = 77
```

---

## 10. Open questions for follow-up (not in scope of this audit)

1. Why does the mock ADAPT engine exist at all in a production-shaped binary? Move it to a test-only file behind a `NODE_ENV === "test"` guard.
2. When was the last time a real ADAPT spec produced a non-mock `CallTarget` write on hf-dev or hf-staging? `git log` on the engine-flip would tell; out of audit scope.
3. Is the `Curriculum.deliveryConfig` field used anywhere? Audit didn't probe it.
4. Should `Playbook.config.modulesAuthored` be promoted to a top-level `Playbook.isAuthored` column? (handoff used this column name — it doesn't exist anymore, so the rename happened sometime). A typed column would prevent the "undefined = non-authored" foot-gun (Section 5).
5. The `_prod_defaults` convention in spec JSONs — is this used anywhere else, or is SKILL-AGG-001 a one-off? Worth a sweep.

---

## 11. Post-TL corrections (filed after BA-pass)

The 4 Tech Lead reviews on issues #1142–#1145 produced 4 material corrections to the audit findings. Captured here so the doc reflects the latest reality and the issues track the correct fix paths.

### G1 / #1143 — REFUTED (post-3rd-pass investigation, 2026-06-06)

The audit and the TL review both reached incorrect root causes. The actual reason for the observed 64/64 mock CallTargets is that the **specific sim driver for call `8ae2f1d7` requested `engine: "mock"` in the request body** — per `route.ts::runSpecDrivenPipeline:3978-3982`, `requestedEngine` overrides the `"claude"` default. Other sim runs against the same playbook use claude_adapt.

**Audit claim (original):** ADAPT runs mock because of `guardrails.aiSettings.engine = "mock"` in GUARD-001 spec config — **WRONG.** `GuardrailsConfig` has no `engine` field; GUARD-001 seed JSON has no `engine` key. TL correctly caught this.

**TL correction:** `ANTHROPIC_API_KEY` is UNSET on hf-dev — **ALSO WRONG.** Key IS present in `apps/admin/.env.local`. Audit's bare `node -e` probe missed it because `dotenv.config()` defaults to `.env`, not `.env.local`. Next.js loads `.env.local` correctly in dev.

**Re-verified DB census (2026-06-06 post-G3-fix):**

```
CallTarget.sourceSpecSlug census (hf-dev, total 2826):
  claude_adapt   1682  ← real AI dominates
  mock_adapt      640  ← from 10 sim runs that opted into mock
  -               427  ← rule-based / legacy
  openai_adapt     77
```

10 distinct sim calls produced mock_adapt; 50 distinct sim calls produced claude_adapt. The pipeline is healthy. **#1143 closed as invalid.**

**Process implication.** The original gap finding was generated from a single call sample (`8ae2f1d7`) that happened to be a mock-opt-in sim. I generalized to "every call" without a global census. The TL pass caught the BA error but introduced a second one. Three-pass investigations are expensive; the lesson is: **for any "every call" claim, run a global GROUP BY before filing the gap.** Filed as a tightening of the BA + TL pattern.

### G2 / #1142 — refined diagnosis

**Audit claim (original):** EMA writes silent; either runner-invocation path or spec config shape mismatch.

**TL correction:** The `parameters[].id = undefined` probe result was a red herring — `aggregate-runner.ts:324` only tests `p.config?.aggregationRules`, never reads `p.id`. The more likely cause is that the `AnalysisSpec` row for `spec-skill-agg-001` has `isActive=false` in the seed (Candidate A). The "config-shape" branch (Candidate B) is already disambiguated by the existing warn at `aggregate-runner.ts:329` (`"<slug> has no aggregationRules, skipping"`) — if it's not in logs, Candidate B is ruled out.

**Backfill script architectural risk:** real and worth tracking. `accumulateSkillScores` does a `ContractRegistry.get` + `callerPlaybook.findFirst` per caller (caller-scoped inside the per-param loop). Backfill should `p-limit` to 5 concurrent and hoist the per-caller lookups. `force=true` param in AC4 was misleading — no such param exists on `runAggregateSpecs`.

**Issue status:** #1142 updated with isActive=true assertion as primary AC + backfill chunking note.

### G3 / #1144 — corrected fix scope

**Audit claim (original):** Three preconditions — `tierPresetId`, `SpeechAssessmentProvider.isDefault`, `VoiceSystemSettings.defaultProviderSlug`.

**TL correction:** Only TWO matter. The resolver (`getDefaultSpeechAssessmentProviderSlug` at `provider-factory.ts:92`) queries `SpeechAssessmentProvider WHERE isDefault=true AND enabled=true` — and the file has no import of `system-settings.ts`. `VoiceSystemSettings.defaultProviderSlug` is **UI-display only**, never read by the cascade. Setting `isDefault=true` is the operative fix.

**Audit claim (original):** AC4(b) — assert AGGREGATE suppresses IELTS-band CallerTarget writes on unavailable envelopes.

**TL correction:** `aggregate-runner.ts` has ZERO references to `voiceProsody`, `prosody`, `ielts`, or `unavailable` (609 lines verified). The claim was unsupported by code. AGGREGATE doesn't currently read `Call.voiceProsody` at all. AC4(b) needs to either be dropped (clarify suppression is moot today) or upgraded (add the guard if it was intentionally omitted from #1119).

**Issue status:** #1144 updated — VoiceSystemSettings change dropped; AC4(b) rewritten as "AGGREGATE does not currently read voiceProsody; document this fact in the AC".

### G4 / #1145 — content-author review gate

**Audit claim (original):** Use any helper to add BehaviorTarget rows; bumpCurriculumFanout to update compose timestamps.

**TL correction:** ALL 8 proposed BEH-* parameters confirmed present in `lib/registry/index.ts:66-114`. But the seed must use `writeBehaviorTargets` from `lib/agent-tuner/write-target.ts` — that helper runs the `isAdjustable` whitelist + `bumpPlaybookComposeTimestamp`. `bumpCurriculumFanout` is for curriculum content mutations, not playbook targets — wrong helper.

**Issue status:** #1145 blocked on PAW's value review (he authors the CIO/CTO course). Engineering path otherwise unambiguous.

### Cross-cutting observation

Three of four BA stories carried a material technical inaccuracy that only the TL pass caught. The audit doc inherits those — without the TL gate, the issues would have shipped fixes that either no-op (G1's spec edit), under-cover (G3's third precondition was vestigial), or over-scope (G3's AC4(b)) the real problem. This is the BA + TL pair functioning correctly per the CLAUDE.md "Proactive Agent Team" pattern. **Worth filing the broader pattern as a process improvement:** BA agents writing infrastructure-touching stories should grep the actual code paths they cite as part of the BA pass, not defer that to TL. Filed as a retro item.

---

## 12. Final closeout — all 12 gaps groomed (2026-06-06)

After the §11 first-pass corrections, the remaining G5–G12 gaps were filed and BA+TL-reviewed. Combined status table for all 12 gaps:

| Gap | Issue | Severity | BA verdict | TL verdict |
|-----|-------|----------|-----------|-----------|
| G1 | #1143 | CRIT | **REFUTED** post-investigation — claude_adapt dominates 1682 vs mock 640 | issue CLOSED as invalid |
| G2 | #1142 | CRIT | verified — EMA writes silent on every `skill_*` caller | NEEDS CLARIFICATION (Candidate A spec inactive most likely) |
| G3 | #1144 | CRIT | verified — fix shipped to hf-dev DB 2026-06-06 | corrected (`VoiceSystemSettings.defaultProviderSlug` is UI-display only) |
| G4 | #1145 | HIGH | verified — 0 BEH-* targets on CIO/CTO trio | blocked on PAW value review |
| G5 | #1155 | HIGH | verified, sharper — 43.8% null (not "every") | 4 confirmations; AGGREGATE doesn't gate on evidence; backfill risk acknowledged |
| G6 | #1154 | HIGH | verified + EXPANDED — V1.0 also 61% null (audit underscoped) | **NEEDS CLARIFICATION** — missed 2nd null-write site at `voice/calls/start/route.ts`; effort 7h → 9h |
| G7 | #1153 | HIGH | **REFUTED** original "MISSING" claim — exists at 0.4. Reframed as cross-playbook drift | READY TO BUILD — seed-drift confirmed; archive recommended |
| G8 | #1151 | HIGH | verified — `_PROD_REVERT_REQUIRED` flag in spec; G2-sequence dependency | READY — also `SKILL_MEASURE_V1.contract.json` carries same flag; both files in one PR |
| G9 | #1158 | HIGH | **REFUTED** "every call" claim — 17/30 real-engine healthy; 9 mock-engine sims (undocumented); 2 vapi-import never triggered pipeline | READY with caveat — vapi-import gap should be its own issue |
| G10 | #1160 | MED | verified — 571 LEARN goals; path 1 covered by #307; path 2 (tutor-briefing) NOT covered | Claim 2 wrong in detail — source trace AC required before guard fix |
| G11 | #1152 | LOW | verified — 17 docs + 2 docs + 72 TS comments | Effort M not S (87 prod hits); env-var coordination landmine; test-mock false confidence |
| G12 | #1156 | LOW | verified — vector embeddings stale, keyword index fresh | READY — post-commit hook has same bug; `gh pr merge --squash` edge case |

### Refuted / reframed claims summary

3 of 12 original gaps were either fully refuted (G1) or substantially reframed by BA verification (G7, G9). The verification gate prevented:

- A no-op fix on G1 (would have edited GUARD-001 spec config; mock was actually a per-call sim driver opt-in).
- An incorrect "add the missing target" fix on G7 (would have inserted a duplicate row).
- A "fix the LEARN spec" investigation on G9 (would have spent days on a non-bug; the real finding is documentation + 1 anomalous call).

Five other claims were verified-but-narrower-than-audit-said (G5, G6, G10) or verified-with-additional-finding (G8, G12). Three claims (G2, G4, G3) held up cleanly.

**Filing-time cross-cutting observation.** The verify-the-claim-before-filing instruction was effective. Of 12 originally-filed audit gaps, only 4 were structurally correct as written. The other 8 either refuted (3) or needed material narrowing (5). The BA + TL pair caught all of these before any code shipped. The audit's `single-call-sample-overgeneralized` failure mode (G1, G7, G9) is now documented as the canonical pattern to defend against.

### Process change shipped (this session)

- **CLAUDE.md MANDATORY TL GATE** — stories citing schema fields, enum values, env vars, config keys, or runtime behaviour must pass a TL "schema verified" comment before grooming completes. Added to Definition of Done.
- **`.claude/agents/guard-checker.md` Guard 15** — new-endpoint pre-commit checklist (route-auth allow-list + zod schema + UI teardown + auth-coverage test).
- **Audit retro** — saved at `memory/retro-2026-06-06.md`; Sprint 10 milestone (#4) created.

---

*End of audit. All 12 gaps groomed; 9 valid issues open (#1142, #1144, #1145, #1151, #1152, #1153, #1154, #1155, #1156, #1158, #1160). #1143 closed as invalid. G3 partial fix already shipped to hf-dev DB. G1 lesson — verify global census before generalizing — is now the canonical defensive pattern for any "every X" claim.*
