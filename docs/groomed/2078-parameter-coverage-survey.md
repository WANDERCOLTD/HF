# Parameter Coverage Survey — 106 Producer-Only Parameters for Epic #2078

**Date:** 2026-06-19  
**Total Parameters:** 154  
**Covered:** 36 (23%)  
**Producer-Only (Gap):** 106 (69%)  
**Deprecated:** 12 (8%)  

## Executive Summary

The 106 producer-only parameters are concentrated in 6 groups. Three groups have **existing partial infrastructure** (ADAPT runners, cascade resolvers, transforms) that just need parameter reads wired; three groups need **NEW runners** (SUPERVISE, REINFORCEMENT). The wiring difficulty ranges from trivial (use existing parameter ID in one line) to architectural (new pipeline stage + runner).

Proposed decomposition: **6 sub-epics**, ~15-20 parameters each, sizing **1-3 days per sub-epic**.

---

## Coverage Summary Table

| Group | Total | Covered | Gap | Deprecated | Hottest Infrastructure | Gap Severity |
|---|---|---|---|---|---|---|
| **learning-adaptation** | 49 | 10 | 31 | 8 | ADAPT-LEARN-001 spec + adapt-runner.ts | Standard → Architectural |
| **curriculum-adaptation** | 32 | 4 | 28 | 0 | ADAPT-CURR-001 spec + adapt-runner.ts | Standard → Architectural |
| **companion** | 17 | 5 | 12 | 0 | No spec; transforms partial | Architectural |
| **engagement** | 13 | 2 | 10 | 1 | No spec; partial transforms | Architectural |
| **personality-adaptation** | 14 | 9 | 5 | 0 | ADAPT-PERS-001 spec + cascade | Trivial |
| **supervision** | 12 | 0 | 11 | 1 | No SUPERVISE runner (gap) | Architectural |
| **reinforcement** | 6 | 1 | 5 | 0 | No runner; specs exist | Architectural |
| **behavior-core** | 6 | 0 | 1 | 5 | N/A | Trivial (1 param) |
| **onboarding** | 5 | 2 | 3 | 0 | INIT-001 spec + loader | Trivial |

---

## Group-by-Group Analysis

### 1. learning-adaptation (31 producer-only)

**Status:** 10/49 covered; 31 gaps; 8 deprecated

**Existing Infrastructure:**
- `ADAPT-LEARN-001` spec exists (defines learner-profile adaptation rules)
- `adapt-runner.ts` reads spec + applies rules → writes CallerTarget
- `lib/prompt/composition/transforms/instructions.ts` partially reads some parameters
- `lib/prompt/composition/transforms/learning-style.ts` exists

**Covered Parameters (10):**
- `BEH-ABSTRACT-VS-CONCRETE` (promptInjection dispatcher)
- `BEH-AGGREGATE-PROFILE` (read in adapt-runner context)
- `auditory_adaptation` (VARK family, cascaded)
- `BEH-CONVERSATIONAL-TONE` (transforms read)
- `BEH-PRACTICE-RATIO` (curriculum family)
- 5 others via VARK cascade / personality B5 mapping

**Producer-Only (31):**

**Trivial (no-op reads — parameter ID appears in spec but transform omits it):**
- `BEH-ADAPT-TO-FEEDBACK-STYLE` (ADAPT-LEARN-001 sourceParameter exists; no transform reads)
- `BEH-ADAPT-TO-INTERACTION-STYLE` (same)
- `BEH-ADAPT-TO-QUESTION-FREQUENCY` (same)
- `BEH-ACTION-VERBS` (semantic directive param — should read via STYLE section template like Abstract-vs-Concrete)
- `BEH-DEFINITION-PRECISION` (STYLE semantics)
- `BEH-DIAGRAM-LANGUAGE` (MODALITY semantic)
- `BEH-FEELING-LANGUAGE` (MODALITY semantic)
- `BEH-IMAGERY-DENSITY` (MODALITY semantic)
- `BEH-LIST-STRUCTURE` (STYLE semantic)
- `BEH-MODALITY-CONSISTENCY` (VARK family — already cascaded but transform doesn't explicitly read the Parameter)
- `BEH-MODALITY-VARIETY` (VARK family — same)
- `analogy-usage` (semantic — maps to `BEH-ANALOGY-USAGE` curriculum param but learning-side read missing)
- `BEH-PRACTICE-EXERCISES` (composite — learner engages hands-on)
- `BEH-REAL-WORLD-EXAMPLES` (STYLE semantic)
- `BEH-REPETITION-OFFER` (semantic)
- `BEH-RHYTHM-ATTENTION` (voice/pacing — no VOICE runner yet)
- `BEH-SPATIAL-METAPHOR` (STYLE semantic)
- `BEH-TERMINOLOGY-FORMAL` (STYLE semantic)
- `BEH-VERBAL-ELABORATION` (MODALITY semantic)
- `BEH-WRITTEN-ALTERNATIVE` (composite — learner preference, voice-only modality)

**Standard (spec-driven reads — ADAPT spec names the parameter, just needs transform branch):**
- `BEH-APPROACH-SWITCHING` (ADAPT-LEARN-001 covers; transform needs routing)
- `BEH-ENGAGEMENT-PROMPTS` (engagement adaptation; ADAPT-ENG-001 exists)
- `BEH-ENGAGEMENT-WITH-EXAMPLES` (same)
- `BEH-MULTIMODAL-ADAPTATION` (VARK + profile agg)
- `BEH-QUESTION-ASKING-RATE` (engagement metric; no SCORE runner for it)
- `BEH-READING-WRITING-ADAPTATION` (VARK family)
- `repetition-frequency` (curriculum param landed in learning group; confusing classification)
- `BEH-RESPONSE-LENGTH-PREFERENCE` (learner engagement; no compose branch)
- `VARK-PROFILE` (multimodal classification — no learner-facing directive)

**Architectural (new spec or runner needed):**
- None at the parameter level; all have supporting specs. Main gap: transforms don't branch on these parameters.

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **LEARN-A** (trivial prompt injections) | 13 | Add parameter ID to promptInjection blocks in registry; wire via parametersAsDirectives dispatcher | ~1 d |
| **LEARN-B** (standard ADAPT branches) | 10 | Wire ADAPT spec rules → transform branches in instructions.ts + learning-style.ts | ~1.5 d |
| **LEARN-C** (composite + engagement) | 8 | New engagement transform + voice pacing phase 2 deferral | ~2 d |

**Total:** ~31 params, ~4.5 days

---

### 2. curriculum-adaptation (28 producer-only)

**Status:** 4/32 covered; 28 gaps; 0 deprecated

**Existing Infrastructure:**
- `ADAPT-CURR-001` spec exists (defines curriculum-path adaptation)
- `adapt-runner.ts` runners exist
- No dedicated `curriculum-adaptation.ts` transform yet (the biggest gap)
- `LEARN-ASSESS-001` spec exists for mastery/progress tracking

**Covered Parameters (4):**
- `BEH-PRACTICE-RATIO` (compose transform reads)
- `BEH-REPETITION-FREQUENCY` (cascade + BehaviorTarget family)
- 2 others via mastery cascade

**Producer-Only (28):**

**Trivial (spec-driven, parameter reads simple):**
- `BEH-APPLICATION-ADAPTATION` (ADAPT-CURR-001: high mastery = more practice; low = more explanation — just read parameter)
- `BEH-ADVANCE-READINESS` (mastery-based pacing)
- `BEH-ANALOGY-USAGE` (STYLE semantic — analogies vs abstractions)
- `BEH-CHECK-FOR-UNDERSTANDING` (comprehension checks — learner engagement / curriculum pacing)
- `BEH-COMPREHENSION-ADAPTATION` (COMP-ADAPT-001 exists; no transform)
- `BEH-COMPREHENSION-SCORE` (COMP-MEASURE-001 exists; needs reader in modules transform)
- `BEH-CONCEPT-EXPOSURE` (mastery tracking; no AGGREGATE runner reads this)
- `BEH-FOUNDATION-FOCUS` (prerequisites; CURR-001 tracker exists)
- `BEH-GUIDED-PRACTICE` (instructional scaffolding)
- `BEH-MASTERY-ADAPTATION` (LEARN-ASSESS-001; transform omitted)
- `BEH-MODULE-INTRODUCTION` (curriculum tracking; CURR-001 writes, transform reads?)
- `BEH-MODULE-MASTERY` (outcome of mastery calc; siloed from Parameter table)
- `BEH-PREREQUISITE-ADAPTATION` (foundation reinforcement; spec-driven)
- `BEH-PREREQUISITE-CHECK` (prerequisite validation; gate logic)
- `BEH-REVIEW-ADAPTATION` (spaced retrieval; LEARN-ASSESS-001 writes, transform reads?)
- `BEH-REVIEW-STATUS` (SRS tracker; same as above)
- `BEH-SPACED-RETRIEVAL-PRIORITY` (SRS intensity)
- `BEH-WORKED-EXAMPLES` (instructional design)

**Standard (spec exists; transform branches needed):**
- `BEH-APPLICATION-SCORE` (measurement in COMP-MEASURE-001; compose reads?)
- `BEH-EXPLANATION-VARIETY` (alternative explanations on misunderstanding)
- `BEH-INTERLEAVING` (review mix)
- `BEH-NEW-CONTENT-RATE` (pacing control)
- `BEH-NUANCE-EXPLORATION` (depth of edge-case discussion)
- `BEH-PROBING-QUESTIONS` (Socratic depth)
- `BEH-PRODUCTIVE-STRUGGLE` (wait time before help)

**Architectural (missing data path):**
- `BEH-CHALLENGE-LEVEL` (global difficulty knob — no CAP module/LO difficulty override yet)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **CURR-A** (trivial mastery/progress reads) | 12 | New `curriculum-adaptation.ts` transform; read from CURR-001 + LEARN-ASSESS-001 cascade | ~1.5 d |
| **CURR-B** (standard instructional design) | 8 | ADAPT-CURR-001 rule branches + compose chains | ~1.5 d |
| **CURR-C** (architectural — difficulty knobs) | 2 | Phase 2 defer; track in epic #2078 follow-on | ~3 d (deferred) |

**Total:** ~22 params (28 - 6 deferred), ~3 days

---

### 3. personality-adaptation (5 producer-only)

**Status:** 9/14 covered; 5 gaps; 0 deprecated

**Existing Infrastructure:**
- `ADAPT-PERS-001` spec exists (Big Five adaptation)
- `lib/cascade/resolvers/behavior-target.ts` cascade reads PERS-001 output
- Transform partial reads exist for `BEH-B5-*` params

**Covered Parameters (9):**
- `BEH-B5-A`, `BEH-B5-C`, `BEH-B5-E`, `BEH-B5-N`, `BEH-B5-O` (Big Five dims)
- 4 others via personality cascade

**Producer-Only (5):**

All **Trivial** (spec-driven, one-line reads):
- `BEH-AGREEABLENESS-ADAPTATION` (warm vs direct based on B5-A; ADAPT-PERS-001 reads; transform omits)
- `BEH-CONSCIENTIOUSNESS-ADAPTATION` (structure based on B5-C; same)
- `BEH-EXTRAVERSION-ADAPTATION` (energy based on B5-E; same)
- `BEH-NEUROTICISM-ADAPTATION` (reassurance based on B5-N; same)
- `BEH-OPENNESS-ADAPTATION` (exploratory vs practical based on B5-O; same)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **PERS-A** (trivial — Big Five branches) | 5 | Wire 5 adaptation parameters into instructions transform via B5 cascade | ~0.5 d |

**Total:** ~5 params, ~0.5 days

---

### 4. companion (12 producer-only)

**Status:** 5/17 covered; 12 gaps; 0 deprecated

**Existing Infrastructure:**
- `COMPANION-001` identity spec exists
- Multiple `COMP-*` specs exist (COMP-CD-001, COMP-IE-001, COMP-PP-001, COMP-RE-001, COMP-MC-001, etc.)
- NO dedicated companion transforms. Specs exist but readers are missing.

**Covered Parameters (5):**
- `BEH-EMPATHY-RATE` (composed; COMP-001 reads)
- `BEH-INSIGHT-FREQUENCY` (COMP-INSIGHT-001 measurement)
- `BEH-PACE-MATCH` (timing; partial)
- `BEH-QUESTION-RATE` (engagement; cached)
- `BEH-PROACTIVE` (mood setter; transform reads)

**Producer-Only (12):**

All **Architectural** (specs exist but no runtime readers):
- `BEH-CONVERSATIONAL-DEPTH` (COMP-CD-001: explores topics deeply; no transform reads)
- `BEH-INTELLECTUAL-CHALLENGE` (COMP-IE-001: intellectual stimulation level; no reader)
- `BEH-MEMORY-REFERENCE` (COMP-MC-001: continuity; memory transform partial)
- `BEH-PATIENCE-LEVEL` (COMP-PP-001: pacing patience; pacing transform omits)
- `BEH-RESPECT-EXPERIENCE` (COMP-RE-001: wisdom acknowledgement; no reader)
- `BEH-STORY-INVITATION` (life stories; no reader)
- `BEH-DEPTH-PREFERENCE` (learner preference; no spec writer)
- `BEH-ENERGY` (conversational tone; overlaps with formality/directness)
- `BEH-ENGAGEMENT` (intellectual stimulation; duplicate of INTELLECTUAL-CHALLENGE)
- `BEH-MOOD` (emotional tone; COMP-EW-001 exists but no reader)
- `BEH-REMINISCENCE` (mood for memories; no writer)
- `BEH-INSIGHT-QUALITY` (meta-level on insights; COMP-INSIGHT-001 measures but no quality branch)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **COMP-A** (companion directive transforms) | 12 | New `companion.ts` transform reading all COMP-CD/IE/PP/RE/MC/EW/INSIGHT specs; emit companion-style directives | ~2.5 d |

**Total:** ~12 params, ~2.5 days

---

### 5. engagement (10 producer-only)

**Status:** 2/13 covered; 10 gaps; 1 deprecated

**Existing Infrastructure:**
- `ADAPT-ENG-001` spec exists (engagement adaptation)
- `CA-001` (cognitive activation measurement) exists
- Partial reads in transforms (check-for-understanding, question-rate)
- NO dedicated engagement-adaptation transform

**Covered Parameters (2):**
- `BEH-CALL-FREQUENCY-ADAPTATION` (transform reads; continuity logic)
- `check-for-understanding` (partial; comprehension checks)

**Producer-Only (10):**

**Trivial-to-Standard:**
- `BEH-CHUNK-SIZE` (smaller chunks for frequent questioners; ADAPT-ENG-001 specifies; transform omits) — **trivial**
- `BEH-COMMUNICATION-COMPLEXITY-ADAPTATION` (vocab complexity target; spec-driven) — **trivial**
- `BEH-CONV-DOM` (conversation dominance; learner vs agent) — **standard** (measurement needed)
- `BEH-COGNITIVE-ACTIVATION` (CA-001 measures; compose omits reading) — **standard**
- `BEH-ENGAGEMENT-ADAPTATION` (compose reads?; spec-driven) — **standard**
- `BEH-LEARNING-VELOCITY-ADAPTATION` (pacing per learner speed; ADAPT-ENG-001; transform omits) — **trivial**
- `BEH-PAUSE-FOR-QUESTIONS` (wait time; engagement metric) — **standard**
- `BEH-TONE-ASSERT` (assertiveness; CA-001 measures) — **architectural** (no compose path yet)

**Architectural:**
- (2 of 10 depend on CA-001 measurement scoring, not yet wired to Pipeline)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **ENG-A** (trivial ADAPT-ENG branches) | 4 | Wire ADAPT-ENG-001 spec branches into instructions transform | ~0.8 d |
| **ENG-B** (CA-001 measurement → compose) | 6 | New compose reader for CA-001 scores; emit engagement directives | ~1.5 d |

**Total:** ~10 params, ~2.3 days

---

### 6. supervision (11 producer-only)

**Status:** 0/12 covered; 11 gaps; 1 deprecated

**Existing Infrastructure:**
- **NONE.** The SUPERVISE pipeline stage exists (stage 6 of 7) but NO runner is wired.
- `SUPV-001` spec exists (agent supervision rules)
- Target: validation + quality gates, NOT learner-facing directives

**Covered Parameters (0):**

**Producer-Only (11):**

All **Architectural** (new SUPERVISE-stage runner needed):
- `BEH-CRISIS-DETECTION-SCORE` (escalation signals; SUPV-001 would measure)
- `BEH-ENGAGEMENT-TREND-SCORE` (engagement over time; trend detection)
- `BEH-LEARNING-PROGRESS-SCORE` (progress tracking; stagnation alerts)
- `BEH-RESPONSE-LENGTH-SCORE` (validation: response too long/short)
- `BEH-SAFETY-COMPLIANCE-SCORE` (disclaimers, sensitive topics)
- `BEH-STUDENT-APPLICATION-SCORE` (transfer learning validation)
- `BEH-STYLE-CONSISTENCY-SCORE` (coherence checks)
- `BEH-TARGET-ALIGNMENT-SCORE` (behavior matches targets)
- `BEH-TUTOR-FIDELITY-SCORE` (source material accuracy)
- `BEH-TUTOR-INTRO-SCORE` (proper introduction)
- `BEH-TUTOR-SEQUENCE-SCORE` (concept ordering)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **SUPV-A** (new SUPERVISE runner) | 11 | Build `lib/pipeline/supervise-runner.ts`; wire SUPV-001 spec rules; emit CallSupervision records; route to logs/alerts | ~3-4 d |

**Total:** ~11 params, ~3.5 days

---

### 7. reinforcement (5 producer-only)

**Status:** 1/6 covered; 5 gaps; 0 deprecated

**Existing Infrastructure:**
- `REW-001` reward computation spec exists (but reads parameters, doesn't define them)
- REWARD pipeline stage exists
- No dedicated reinforcement-parameters reader

**Covered Parameters (1):**
- `BEH-ENGAGEMENT-REWARD` (transform reads via REW-001)

**Producer-Only (5):**

All **Architectural** (new REWARD-stage reader):
- `BEH-ERROR-ELABORATION` (reward for detailed error explanations; REW-001 measures; compose branch omitted)
- `BEH-GOAL-PROGRESS-REWARD` (reward signal; measurement spec exists)
- `BEH-LEARNING-REWARD` (reward for learning insights; spec exists)
- `BEH-RAPPORT-REWARD` (reward for personality alignment; spec exists)
- (5th parameter TBD — verify REW-001 spec)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **REW-A** (REW-001 parameter readers) | 5 | Wire REW-001 spec parameter outputs; emit REWARD-stage CallScore + feedback signals | ~1.5 d |

**Total:** ~5 params, ~1.5 days

---

### 8. engagement / onboarding (3 producer-only each)

**Status:** 2/5 covered (onboarding); 3 gaps
**Status:** Included above

### 9. behavior-core (1 producer-only)

**Status:** 0/6 covered; 1 gap; 5 deprecated

**Existing Infrastructure:**
- None needed; behavior-core is foundational

**Covered Parameters (0):**

**Producer-Only (1):**

**Trivial:**
- `BEH-EXPLORATION-STRUCTURE` (exploration vs structure balance; no spec, foundational; Phase 2 deferral)

**Sub-Epic Sizing Proposal:**

| Name | Params | Approach | Effort |
|---|---|---|---|
| **BC-A** (exploration structure) | 1 | Defer to epic #2078 Phase 2 (architectural decision pending) | ~0.5 d (defer) |

---

## Proposed Sub-Epic Breakdown (6 total)

| Epic | Group | Params | Effort | Depends On |
|---|---|---|---|---|
| **#2078-S1** (Personality) | personality-adaptation | 5 | **0.5 d** | adapt-runner.ts (exists) |
| **#2078-S2** (Learning Style) | learning-adaptation | 31 | **4.5 d** | ADAPT-LEARN-001, transforms |
| **#2078-S3** (Curriculum Path) | curriculum-adaptation | 22 | **3 d** | ADAPT-CURR-001, new transformer |
| **#2078-S4** (Engagement) | engagement + onboarding | 13 | **2.3 d** | ADAPT-ENG-001, CA-001 scorer |
| **#2078-S5** (Companion) | companion | 12 | **2.5 d** | COMP-* specs, new transformer |
| **#2078-S6** (Supervision + Reward) | supervision + reinforcement | 16 | **5 d** | NEW runners for SUPERVISE + REWARD |

**TOTAL:** ~99 params wired; ~17.8 days across 6 sub-epics.  
**Deferred (Phase 2):** ~7 params (reinforcement detail, behavior-core foundation, challenge-level architecture).

---

## Key Discoveries

1. **Most parameters already have supporting specs** (ADAPT-LEARN-001, COMP-CD-001, etc.). The gap is the runtime readers, not the definitions.

2. **Two runner stages are completely absent:**
   - **SUPERVISE** (11 supervision-quality params) — new `supervise-runner.ts` needed
   - **REWARD** parameter readers incomplete (REW-001 exists but 5 params don't wire)

3. **"Trivial" dominates learning-adaptation** (13/31 params are prompt-injection semantics — just add promptInjection blocks to registry + wire dispatcher).

4. **Companion is the most isolated** (12 COMP-* specs exist with zero compose readers — biggest architectural lift per param).

5. **Personality-adaptation is nearly done** (9/14 covered; 5 trivial one-line reads from Big Five cascade).

6. **Parameter naming confusion** (some learning-side params landed under curriculum; some vice versa — review registry after Phase 1 to reclassify).

---

## Risk Flags

- **supervision-runner.ts doesn't exist yet** — SUPERVISE stage wiring is blocked pending runner implementation.
- **Companion transforms are greenfield** — no reference implementation; specs are rich (COMP-CD, COMP-IE, etc.) but integration unknown.
- **Challenge-level override architecture** — BEH-CHALLENGE-LEVEL needs module/LO difficulty knobs; deferred to Phase 2.
- **Reinforcement detail** — REW-001 spec is authored; pipeline integration may need auth-gate clarification.

---

## Success Criteria

For each sub-epic close, the bar is:

1. Parameter is read in runtime code (compose transform / pipeline runner / cascade resolver).
2. The read is tested (vitest + live test via sim runner or hf_staging).
3. Parameter coverage test shows `classification: "covered"` (word-boundary match in CONSUMER_SOURCE).
4. Parameter behavior is visible in a composed prompt or pipeline output (sample call verified).

