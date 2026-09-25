# HF Pedagogy Audit

Sep 25, 2026 · @Paul

An audit of what pedagogy is actually implemented in HF, for an interview with an education expert. Written against the code and configuration surfaces, not the pitch. Unimplemented things are marked **not specified** rather than described aspirationally.

## Method and scope

Read directly: the 135 behaviour specs in `docs-archive/bdd-specs/` (the seeded source of every pipeline stage), the runners in `lib/pipeline/`, the mastery and unlock resolvers in `lib/curriculum/`, the scheduler and its presets, the course-reference parser in `lib/wizard/`, the glossary at `docs/glossary-skills-mastery.md`, and the live IELTS and CIO/CTO course references.

Three evidence grades are used throughout:

- **Implemented** — a named mechanism, running in the pipeline, carried by a specific file or spec.
- **Configured but dormant** — the mechanism exists and is wired, but no live course supplies the data that would make it fire.
- **Not specified** — no mechanism. Said plainly rather than described as forthcoming.

Two limits worth stating before the interview.

First, this audits *design as implemented*, not learner outcomes. HF has run one small pilot. Nothing here is efficacy evidence, and Section 11 is the list of things that would test it.

Second, HF's pedagogy is **configuration-resident**. Most of what a course teaches, and much of how, lives in a course-reference document the educator writes — parsed into skills, objectives, rubric bands and teaching rules. The engine supplies the loop, the measurement machinery and the sequencing policy; the course supplies the content, the criteria and most of the instructional stance. So "what pedagogy does HF implement?" has two answers, and conflating them is the main way this conversation could go wrong. This document separates engine commitments from course-author commitments wherever the distinction bites.

## 1. Principle inventory

Nine capabilities, each mapped to the principle it implements and the mechanism that carries it. Where a principle is named in the code itself, that is noted — several scheduler weights are literally called `difficultyZpd`, `spacedDue`, `interleave`, `retrievalOpportunity`, `cognitiveLoadPenalty`.

| Capability | Principle implemented | Concrete mechanism |
| --- | --- | --- |
| Curriculum-bound practice toward a bar | **Criterion-referenced assessment**; **constructive alignment** | Course reference declares Skills (`SKILL-01…`) with tier descriptors and a `targetBand`; projection writes each to a `Parameter` plus a PLAYBOOK-scope `BehaviorTarget` holding that course's target value. The bar is authored, not inferred. |
| Same | **Mastery learning** — partial | `computeModuleMastery()` gates module completion on a threshold (default 0.7, per-module and per-LO overridable). Partial because a two-attempt waiver also tries to fire, though it writes a value no reader honours (below). |
| Coach vs examine stances | **Assessment/instruction separation**; **deliberate practice** — partial | `AuthoredModuleMode` ∈ tutor / mixed / examiner / quiz / mock-exam. Examiner and mock-exam modes emit compose directives that suppress teaching ("board-chair framing. You are NOT the senior mentor today"). Deliberate practice is partial: repetition against a criterion with feedback is present; the defining feature — tasks targeted just past current capability — depends on the scheduler, which the flagship course bypasses (Section 4). |
| Same | **Dynamic assessment** — **none earned** | Would require scoring the learner's response *to graduated help*. Scaffolding and scoring both exist but nothing records what support was given or scores performance-with-support separately. |
| Scoring against the course rubric | **Analytic rubric scoring**; **standards-based grading** | Per-criterion scoring specs (`IELTS-MEASURE-001` scores FC / LR / GRA / P separately against the public band descriptors, each normalised band/9). The rubric text is the educator's; band descriptors are parsed into `Parameter.config.bandThresholds`. |
| Same | **Honest missingness** — unusual, worth naming | Specs mandate `null` when evidence is insufficient, with an operator rule forbidding fabricated defaults: "Honest empty bands surface gaps; fake scores corrupt the EMA." Pronunciation carries an explicit confidence cap when judged from transcript alone. |
| Updating per-skill positions | **Formative assessment**; **recency-weighted estimation** | `SKILL-AGG-001` folds per-call scores into `CallerTarget.currentScore` as an exponential moving average, 14-day half-life, 10-score window, minimum 3 pieces of evidence before any non-zero mastery. |
| Same | **Mastery as best-evidence** — conflicting second system | Per-LO mastery is a *monotonic max ratchet* — best score ever seen, never decays. Two mastery systems run in parallel with opposite time semantics. See Section 10. |
| Composing the next session from evidence | **ZPD**; **spaced practice**; **interleaving**; **retrieval practice**; **cognitive load theory** | The scheduler ranks candidate objectives on seven named weights — mastery gap, spaced-due bonus, interleave bonus, ZPD difficulty targeting, recently-used penalty, cognitive-load penalty, retrieval-opportunity bonus — bundled into six presets (Balanced, Interleaved, Comprehension, Exam-prep, Revision, Confidence-build) with a retrieval cadence forcing an assess turn every N calls. |
| Same | — but **dormant on the flagship course** | The scheduler runs only when course style is `structured` **and** no module is locked. IELTS learners pick a module, which sets the lock and bypasses the scheduler. The named-principle machinery above is real code that the main live course does not currently exercise. |
| Educator authors; engine hidden | **Teacher-owned curriculum**; **pedagogy-as-data** | Course reference parses into skills, objectives, rubric bands, teaching rules, scaffolding moves and edge cases (`ContentAssertion` categories). An architectural rule bans encoding pedagogy as code where it could be data. |
| Scores trace to session and criterion | **Assessment transparency**; **evidence-backed reporting** | Every `CallScore` carries `parameterId`, `callId`, `confidence` and an `evidence` field; a chokepoint rule requires each score to name the spec that produced it. |
| Behaviour dials | **Named instructional variables** — mechanism present, **calibration not earned** | 163 registered parameters include `BEH-PRODUCTIVE-STRUGGLE`, `BEH-SCAFFOLDING`, `BEH-WORKED-EXAMPLES`, `BEH-SPACED-RETRIEVAL-PRIORITY`, `BEH-INTERLEAVING`, `BEH-PREREQUISITE-CALLBACK`, `BEH-CHALLENGE-LEVEL`, `BEH-FOUNDATION-FOCUS`. These reach the tutor as prompt directives with a target value. What no value is anchored to is any empirical dose-response — 0.7 on productive struggle means what the prompt says it means. |
| Institutional traces | **Learning analytics** — descriptive only | Per-skill EMA, per-LO mastery, module progress, score drift across sessions, call-level evidence. Legitimate formative reporting. |
| Psychosocial / placement signals | **none earned** — see Section 9 | Big Five personality, VARK modality and cognitive-activation level run unconditionally and write per-learner profiles; the two wellbeing specs are domain-gated and probably not attached here. VARK in particular implements a construct with no empirical support for its instructional claim. |

Two capabilities in the brief have **no principle earned** in the current build: dynamic assessment (no record of support given, no scoring under support), and transfer (nothing measures performance on tasks structurally unlike the practised ones — the mock exam is the same format as practice, which tests consolidation, not transfer).

## 2. Intended theory of change

- **Learner.** Volume of criterion-aligned speaking or answering practice rises, because an always-available partner removes the scheduling constraint on one-to-one practice. Feedback each session is tied to the same criteria the real assessment uses, so attention concentrates on the gap rather than on general performance. Horizon: weeks, over roughly 6–20 sessions.
- **Educator.** A per-criterion, per-session evidence trail replaces recall and spot-checking, so the decision "is this learner ready, and on what" is made against data the educator's own rubric generated. Horizon: immediate, from the first scored session.
- **Institution.** Cohort-level criterion positions expose where a cohort is weak against the bar while there is still time to intervene, rather than after results. Horizon: one cohort cycle.

The mechanism connecting the first bullet to an actual outcome gain is **practice volume at the right criterion with fast specific feedback**. That is a defensible mechanism. It is also the one HF has not yet tested (Section 11).

## 3. What is measured vs what is improved

"Link specified" asks one question: is there anything in the system that connects the measure to the claimed improvement, beyond the assumption that they move together?

| Measure | Claimed improvement | Link specified? |
| --- | --- | --- |
| Per-criterion band score per session (FC / LR / GRA / P) | Performance on the real exam under the same criteria | **Weak** — criteria and descriptors are the official ones, which is genuine construct alignment. But no HF score has been compared against a real IELTS result. Concurrent validity is unmeasured. |
| Per-skill EMA across sessions | Durable skill growth rather than a good day | **Yes** — the EMA *is* the mechanism: 14-day half-life, 10-score window, 3-evidence minimum. Smoothing is specified and testable. |
| Per-LO mastery (max ratchet) | Learner has mastered this objective | **No** — best-ever-seen with no decay. A score hit once is retained indefinitely. No retention evidence links it to durable mastery. |
| Module mastery ≥ 0.7 | Ready for the next module | **Weak** — the threshold is a default, overridable per module and per objective. It was chosen as a sensible round number, not calibrated against downstream success. |
| Prerequisite completion counts (e.g. Mock needs 2× Part 1, 2× Part 3) | Ready for the mock | **No** — a dose gate, not a competence gate. Counting attempts, not checking quality. Deliberately simple; worth saying so plainly rather than dressing it up. |
| Session count and practice volume | More practice → better outcome | **No** — assumed, not established, and the practice-volume premise is the core claim (Section 2). |
| Big Five personality profile | Better-adapted teaching | **No** — written and adapted on, but nothing tests whether personality-matched adaptation improves anything. |
| VARK modality profile | Teaching matched to preferred modality | **No** — and the underlying meshing hypothesis is contradicted by the research literature. See Section 9. |
| Cognitive-activation level, emotional-wellbeing signals | Learner engagement / welfare insight | **No** — no construct validation, no defined action, no human gate specified. |
| Score drift, hesitation, vocabulary range | Institutional / cohort insight | **Weak** — the traces are real and descriptive reporting is fair. Any inference beyond "this changed" is unvalidated. |

The pattern: the measures closest to the educator's own rubric have the strongest links, and links weaken steadily as the inference moves away from the criterion the educator authored. That is the right shape for an honest system, and it is also exactly where an expert will push.

## 4. Adaptation logic

The loop is: call → transcript → EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE → next prompt. Each stage is spec-driven and the whole loop runs after every session, typically in under a minute.

**What evidence can change what happens next**

| Evidence | Changes |
| --- | --- |
| Per-criterion scores this session | The per-skill EMA, which drives which skill is named weakest |
| Weakest skill | The session focus pinned into the next prompt — on IELTS this maps the weakest criterion to a learner-facing *technique* label ("giving reasons", "expanding an answer"), never the criterion name |
| Per-LO and module mastery | Module completion status, and what the scheduler treats as frontier |
| Completed-attempt counts | Whether a gated module unlocks (Mock requires 1 baseline, 2× Part 1, 2× Part 3) |
| Transcript content | Extracted memories and goals, which surface as continuity in the next opening |
| Prior session's plan | Objectives planned but not covered get a priority boost next time |
| Behaviour measurements | ADAPT rules move `BehaviorTarget` values — with a large caveat below |

**What cannot change.** The rubric, the criteria, the tier descriptors and the target band are educator-owned and structurally protected: an ESLint rule blocks customer-facing write paths from touching a parameter's `definition` or interpretation text. Module structure, module mode, and the content sources are authored. Nothing in the adaptive loop can lower the bar, rewrite a criterion, or change what a band means. That boundary is real and enforced in code — it is one of the stronger things to show an expert.

**Three honest limits on the adaptation story.**

First, **the sophisticated sequencer is bypassed on the flagship course**. The scheduler — the component carrying the ZPD, spacing, interleaving and cognitive-load weights — runs only when the course is structured *and* no module is locked. The IELTS learner journey uses a module picker, which sets the lock. So for the main live course, sequencing today is: prerequisite gates, learner choice, and a linear default order. The named-principle ranking machinery is built and tested but not exercised there.

Second, **most adaptation writes have no reader**. A Coverage gate that walks every `targetParameter` an ADAPT spec writes and checks whether any compose-side code reads the resulting value currently freezes the gap at **136**. Those adaptations compute, persist, and never reach the next prompt. A companion gate on aggregation outputs sits at 2. This is known, measured and ratcheted rather than hidden — but the practical meaning is that the per-call adaptive gain is much narrower than the architecture diagram suggests.

Third, **"beats a fixed syllabus" is a design assumption, not a tested claim**. No comparison has been run against a fixed-order control. Given the first limit, the flagship course is currently much closer to a fixed syllabus with gates than to adaptive sequencing. This should be stated first, not conceded under questioning.

## 5. Assessment model

**Criterion-referenced throughout.** No norm-referencing exists anywhere in the codebase — no percentiles, no cohort ranking, no curve. A learner's position is judged against authored descriptors only. Four tier slots (approaching-emerging / emerging / developing / secure) carry per-course threshold presets; the IELTS preset maps them to bands 3 / 4 / 5.5 / 7 and relabels them with the course's own vocabulary.

**The educator owns the rubric — structurally, not just by convention.** The rubric enters through the course-reference document: skill definitions, tier descriptors, per-band text. A guard rule (`spec-readonly-boundary`) blocks any customer-driven write path from modifying a parameter's definition or interpretation text; those are set once from the authored source. The engine scores against the educator's words; it does not author or revise them.

**What would make a conversational score valid for the real bar** — and where HF actually stands:

| Validity requirement | Status |
| --- | --- |
| Construct alignment — scoring the right things | **Reasonable.** The four IELTS criteria are the official ones and the descriptors are the published band descriptors. |
| Concurrent validity — agrees with the real assessment | **Absent.** No HF band has been compared against a real IELTS result. This is the most important missing evidence. |
| Inter-rater reliability — agrees with human examiners | **Absent.** No double-marking study. |
| Test-retest reliability — stable across sessions | **Partially designed.** The EMA exists to smooth session noise, but its stability has not been characterised. |

**Construct underrepresentation** sits in three places, in descending severity. Pronunciation is judged from a *transcript*, inferred from self-corrections, hesitations and repair patterns — the spec is honest about this and caps its confidence at medium, but a criterion about sound is being estimated from text. Interactional competence under a real examiner's unpredictability is thinner in a conversational partner that is accommodating by design. And the practice format mirrors the exam format closely, so what is measured is consolidation within a familiar format rather than transfer.

**AI-interaction artefacts** are a real and under-addressed risk. Learners may accommodate to a machine interlocutor — speaking more slowly, self-monitoring more, or less. Transcription error propagates directly into lexical and grammatical judgement, and the transcript is the only evidence the scorer sees. And an LLM judge has scoring tendencies of its own: leniency drift, position and verbosity effects, and sensitivity to prompt wording. None of these are currently measured. The mitigations that exist are structural rather than empirical — forced nulls on thin evidence, confidence tiers, a per-criterion breakdown, and a ban on fabricated defaults. Those prevent fabrication. They do not establish accuracy.

## 6. Feedback and struggle

Feedback timing is set by module mode, which the educator authors per module. It is not inferred.

| Mode | Feedback behaviour | Justifying principle |
| --- | --- | --- |
| `tutor` | Immediate, conversational, corrective in flow | Formative feedback during acquisition |
| `quiz` | Immediate and rationed — exactly two sentences per item: correct/incorrect, then the underlying principle. No follow-up teaching | Retrieval practice with corrective feedback; the brevity rule protects retrieval strength from being diluted into re-teaching |
| `examiner` / `mock-exam` | Withheld during the session — "board-chair framing. You are NOT the senior mentor today" | Assessment/instruction separation: help during assessment invalidates the measurement |
| `mixed` | Tutor stance with assessment touches | Interleaved practice and assessment |

**Where productive struggle is explicit.** The strongest example is the stall-scaffold system in the IELTS course. Stalls are typed — `i-dont-know`, `opinion-gap`, `abstraction-freeze`, `vocabulary-search`, `blank-out`, plus early- and deep-stall — and each type has an authored pool of responses under an explicit doctrine the course reference names: **reframe, not resolve**. When a learner freezes on an abstract question, the tutor lowers the abstraction and returns the question; it does not supply the answer. That is a genuine, deliberately-designed productive-struggle mechanism, and it is worth leading with, because it is the clearest instance in the system of a pedagogical decision made on purpose.

Alongside it, `BEH-PRODUCTIVE-STRUGGLE` is a tunable parameter defined as "how long the AI lets a learner work through difficulty before stepping in", with siblings for scaffolding intensity and worked examples. These reach the tutor as prompt directives.

**Where it is accidental.** The dial has no unit. A value of 0.7 on productive struggle means whatever the prompt text makes it mean to the model in that moment — there is no calibration, no measured wait, no check that the intended behaviour occurred. Outside the authored stall pools, the struggle policy is a prompt instruction, not a controlled mechanism.

**The system never asks the learner to find their own error.** Self-explanation and error-detection prompts ("can you spot what went wrong there?") are not implemented anywhere — not as a mode, a dial, or an authored move. For a system whose stated aim includes self-regulated learning, this is a notable absence rather than a small one.

**One mechanism to flag before the expert finds it — and it is broken rather than wrong.** If a learner exits a module early twice, the second exit triggers a waiver intended to set the module's status so the picker stops re-prompting and the learner moves on. The intent is humane — don't trap someone in a module they keep abandoning — and abandonment is genuinely a signal worth acting on.

The implementation does not do it. `markModuleIncomplete` writes the literal string `MASTERED` into `CallerModuleProgress.status`, whose canonical vocabulary is `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED`. `MASTERED` is a *presentational* value the API layer produces **from** `COMPLETED`; written into the column directly it matches nothing. Both readers map unrecognised values to `NOT_STARTED`, and the prerequisite gate counts only `COMPLETED`. So a waived module renders to the learner as *not started*, does not satisfy any prerequisite, and the re-prompting the waiver exists to stop carries on. It is a dead write: it does not inflate the mastery record, and it does not deliver the humane behaviour either. The design question (should abandonment advance a learner?) is still worth asking the expert; the current answer is that nothing happens.

## 7. Sequencing and mastery

"Ready" means three different things depending on which gate is asking.

**Ready for the next module.** `computeModuleMastery()` requires at least 3 pieces of scored evidence, then takes an exponentially-weighted mean of the 10 most recent scores with a 14-day half-life, damped by a ramp that prevents a single strong call reaching full mastery (a 0.7 first call caps around 0.17; roughly 4 calls to full weight). Mastery ≥ 0.7 marks the module complete. The threshold is overridable per module and per objective. Fewer than 3 scores returns mastery 0 rather than an optimistic guess.

**Ready for the mock.** Purely a dose gate. IELTS Mock declares `[{baseline, 1}, {part1, 2}, {part3, 2}]` — counts of *completed attempts*, not scores. A learner who completed those five sessions badly unlocks the Mock exactly as fast as one who completed them well. Operators above learner tier bypass the gate entirely, by design, so testers are not locked out.

**Ready for the real assessment.** **Built, but switched off.** The engine has a readiness resolver — `buildAssessmentReadinessDirective` compares observed mastery against `assessmentReadinessThreshold`, a cascade knob, and returns `ready` / `not_ready` / `unknown` into the composed prompt. It returns null here for one reason: no IELTS course has set the threshold. So the machinery exists and the verdict never fires, which reads from the outside exactly like a missing feature. Two caveats keep this from being a clean win: the comparison uses an *average* of objective mastery rather than naming which objectives block, and nobody has calibrated what the threshold should be against a real band outcome. Setting a number is config; knowing which number is a study.

**Decay and spacing.** Two mastery systems run side by side with opposite time behaviour:

| Store | Aggregation | Decay |
| --- | --- | --- |
| `CallerTarget.currentScore` (per skill) | EMA, 14-day half-life | **Yes** — old evidence loses weight |
| `CallerAttribute lo_mastery:*` (per objective) | `Math.max` ratchet | **No** — best ever, permanent |
| `CallerModuleProgress.mastery` (per module) | EMA over last 10 scores | **Yes** |

Spacing as a *scheduling* principle — resurfacing material because it is due for review — exists in the scheduler's `spacedDue` and `retrievalOpportunity` weights and in the `BEH-SPACED-RETRIEVAL-PRIORITY` dial. On the flagship course the scheduler is bypassed (Section 4), so what is live is the decay in the EMA, not scheduled spaced retrieval. The interval is a fixed exponential half-life, not an expanding schedule responsive to recall success, so this is recency-weighting rather than spaced repetition in the SuperMemo/Leitner sense. Saying "spaced practice" without that qualifier would be overclaiming.

## 8. Educator control

| Decision | Owner |
| --- | --- |
| What counts as a skill, and its tier descriptors | **Educator** — authored in the course reference |
| The rubric and per-band descriptor text | **Educator**, and protected from engine writes by a guard rule |
| The target band for the course | **Educator** |
| Learning objectives, modules, module order | **Educator** |
| Module mode — tutor / examiner / quiz / mock-exam | **Educator**, per module |
| Prerequisites and their required counts | **Educator** |
| Teaching rules, scaffolding moves, edge cases | **Educator** — authored prose, parsed into typed assertions |
| Question banks, cue cards, topic pools | **Educator** |
| Whether scores are read aloud, shown on screen, or deferred | **Educator** |
| \~105 journey settings surfaced in the course inspector | **Educator** |
| Mastery threshold and skill decay half-life | **Educator**, via the loMasteryThreshold and skillScoringEmaHalfLifeDays cascade knobs. Engine defaults apply when they are left unset, which they are |
| Evidence minimum and ramp shape | **Engine** |
| Scheduler weights (ZPD, spacing, interleave, load) | **Engine**, chosen by preset from the course's teaching mode; the numbers are never shown |
| Which skill is "weakest" and how that maps to a focus | **Engine**, from a course-authored mapping table |
| The pipeline stages and what each writes | **Engine** |
| Whether a personality or modality profile is built | **Engine** — no educator opt-out found |

**Is the split coherent?** Mostly, and in an unusual direction. The educator owns the *ends* — what is taught, what counts as good, what the bar is — and the engine owns the *estimation machinery*. That maps cleanly onto criterion-referenced assessment and constructive alignment, and it is the right side of the line to be strict about. The `spec-readonly-boundary` guard, which prevents the system from rewriting the educator's criterion definitions, is a genuine architectural commitment rather than a policy statement.

Three incoherences to own before they are found.

**The pedagogical numbers are reachable, but they default silently.** A 0.7 mastery threshold, a 14-day half-life and a 3-evidence minimum jointly decide when a learner is judged ready. Two of the three are educator-settable and simply unset on this course — the mastery cut via loMasteryThreshold, the decay half-life via skillScoringEmaHalfLifeDays, both live cascade knobs with working resolvers. The evidence minimum and the ramp shape are genuinely engine constants. So the sharper version of this complaint is not that the educator cannot reach these numbers; it is that the defaults apply silently when they don't, and nothing tells them a decision was made on their behalf.

**Hiding the scheduler is defensible; hiding that it is off is not.** "Teachers never see these numbers" is a reasonable design stance. But on the flagship course the scheduler does not run at all (Section 4), and there is no surface telling the educator that the adaptive sequencing they may believe is active is bypassed on every learner-picked session.

**Profiling has no educator gate.** Personality and modality profiles are built for every learner with no visible consent or opt-out for the course author. That belongs to the educator or the institution, not the engine — see Section 9.

## 9. Insight layer

The traces divide into two groups with very different standing.

**Learning evidence — defensible.** Per-criterion scores with named evidence, per-skill EMA and its trajectory, per-objective and per-module mastery, attempt and completion counts, planned-but-uncovered objectives, and stall type and frequency. All of these are either the educator's own criteria applied to a session, or counts of what happened. Reporting them to an educator or a cohort lead is ordinary formative assessment.

**Psychosocial and profile signals — contested.** Five specs exist; three of them run here unconditionally, and two are gated — see below the table:

| Spec | Construct named | Validation | Human gate | Verdict |
| --- | --- | --- | --- | --- |
| `PERS-001` | Big Five / OCEAN | None in HF. The instrument is validated for questionnaires, not for LLM inference from a teaching transcript | None found | **Overreach** — inferring a stable personality trait from coursework |
| `VARK-001` | VARK learning modality | None, and the instructional claim is contradicted by the literature | None found | **Overreach** — see below |
| `CA-001` | "Cognitive activation and engagement patterns", "caller mental state" | None | None found | **Overreach** — "mental state" is a clinical register for an engagement proxy |
| `COMP-EW-001` | "Emotional tone, loneliness or isolation signals" | None | None found | **Overreach, highest risk** — a safeguarding-adjacent inference with no escalation path |
| `COMP-CG-001` | "Cognitive patterns" | None | None found | **Overreach** — the name is one step from cognitive impairment screening |

**Which of these actually run here.** `PERS-001`, `VARK-001` and `CA-001` are `SYSTEM`-scoped with no `profileCondition`, and the spec loader runs such specs unconditionally — so personality, modality and cognitive-activation inference do run on these transcripts. `COMP-EW-001` and `COMP-CG-001` are `DOMAIN`-scoped to the `companion` domain and load only when the enrolled playbook lists them in its `items`, which an education playbook almost certainly does not. The two highest-risk inferences are therefore probably dormant. Probably, not certainly: confirming it needs a check of the playbook's attached specs, which has not been run. Either way there is no educator or learner opt-out, and access is whoever can read `CallerAttribute`.

**On VARK specifically.** The meshing hypothesis — that matching instruction to a stated modality preference improves learning — has been tested repeatedly and not supported; it is one of the better-known cases where a popular idea failed replication. HF builds a VARK profile per learner and feeds it into an adaptation spec. An education expert will almost certainly raise this, and the only good answer is to agree and say what will change. Learners do have preferences; the claim that teaching to them improves outcomes is the part that fails.

**Two mitigating facts, stated without overselling them.** The companion-domain specs (`COMP-*`) were authored for a different product — a conversational companion for older adults, where wellbeing monitoring has a clearer rationale — and their `DOMAIN` scoping means they are very likely not attached to an education playbook at all. And a structural gate already prevents internal labels leaking into learner-facing surfaces, so learners are not shown a criterion name, a trait label or a raw score. But scoping-by-accident is not a safeguard, and a leak gate protects the learner's *view*, not the inference itself.

**Nothing here has a human gate, a named validated construct, a defined action, a retention limit, or a stated purpose limitation.** For placement-relevant or psychosocial use, each of those is a minimum. The defensible position going into the interview is: the learning evidence is sound and we stand behind it; the profiling layer is legacy from an adjacent product, has no validation, should be off for education courses, and we are not making claims on it.

## 10. Gaps and folklore

### Principles a curriculum mentor would expect, and that are absent

- **A misconception model.** Nothing represents *what* a learner gets wrong — only how well they did. There is no error taxonomy, no diagnostic of the specific misunderstanding, nothing that distinguishes a learner at 0.4 because of tense errors from one at 0.4 because of vocabulary range. Scores without an error model make targeted remediation impossible, and this is probably the single biggest pedagogical gap in the build.
- **A revision loop.** The learner never receives feedback, acts on it, and is re-assessed on the same task. Feedback lands at the end of a session and the next session is a different session. Feedback the learner does not act on is the most common way feedback fails to change anything.
- **Self-explanation and error-detection prompts.** Not implemented anywhere (Section 6).
- **Transfer.** Practice and assessment share a format; nothing tests performance on a structurally different task.
- **Worked-example fading.** The dial exists; the expertise-reversal logic — withdrawing support as competence grows — does not.
- **Prior-knowledge activation.** A baseline module exists, but nothing links prior knowledge to how new material is introduced.
- **Standard setting.** No justification exists for why 0.7 is the mastery line. No Angoff-style procedure, no calibration against outcomes, no documented rationale.
- **Moderation.** No second marker, no sample review, no drift monitoring on the LLM judge over time.

### Terms in the product language with no operational definition here

| Term | What it lacks |
| --- | --- |
| **Adaptive** | Bypassed on the flagship course; 136 adaptation writes have no reader |
| **Mastery** | Three incompatible definitions across three stores — and one is earned by quitting twice |
| **Learning style** (VARK) | An instructional claim the evidence does not support |
| **Cognitive activation**, **mental state** | Clinical-sounding registers for an engagement proxy, with no construct behind them |
| **Productive struggle** | A 0–1 dial with no unit, no measured wait, no verification that the intended behaviour occurred |
| **Confidence** (on a score) | An LLM self-report, not a calibrated interval |
| **Evidence** (on a score) | A model-generated justification, not independently verifiable |
| **ZPD** | A ranking weight, not a measured zone of proximal development |
| **Readiness** | A working resolver, an unset threshold, and no calibration for what the threshold should be |

### Internal contradictions

1. **Two mastery systems, opposite time semantics.** Skill scores decay with a 14-day half-life; objective mastery is a permanent maximum. The same learner is simultaneously "fading" and "has mastered it". Neither is wrong on its own; together they cannot both be the answer to "where is this learner".
2. **The honesty doctrine holds, but only by accident.** The system explicitly forbids fabricated scores — "honest empty bands surface gaps; fake scores corrupt the EMA" — and then attempts to write `MASTERED` on a module after two abandoned attempts, with no evidence at all. That would be the exact failure the doctrine exists to prevent, arriving through a different door. It does not land only because the value written is off-convention and every reader discards it. The doctrine is intact; the guard that keeps it intact is a bug.
3. **Adaptive sequencing is built, tested, and off where it matters.** The ZPD, spacing, interleaving and cognitive-load weights are real code with real presets, bypassed on every learner-picked session of the flagship course.
4. **The educator owns the bar but not the thresholds that decide who clears it.** Mastery cut, evidence minimum and half-life jointly determine readiness; two of the three are engine constants.
5. **Careful about labels shown, careless about inferences made.** A structural gate stops a criterion name reaching a learner's screen, while the same pipeline builds an un-validated personality profile of that learner with no consent surface.

## 11. Falsifiers

What would show the educational story is wrong. Each is a study HF could actually run; most are cheap.

**Learner-level**

| Test | Falsifies the story if |
| --- | --- |
| Compare HF bands against real IELTS results for the same learners | Correlation is weak, or bias is systematic in one direction |
| Double-mark a sample of sessions with trained human examiners | Agreement is no better than chance-adjusted baseline |
| Re-run the same transcript through the scorer repeatedly, and across model versions | Scores move materially — the measure is unstable, and trajectories are noise |
| Compare gain for HF practice against equal-time conventional practice | No difference — the practice-volume mechanism is doing the work, not the adaptivity |
| Compare the adaptive path against a fixed syllabus with the same content | No difference — "beats a fixed syllabus" fails, and given Section 4 this is the likeliest result today |
| Delay a re-test by four weeks after a module is marked mastered | Performance drops to pre-practice levels — the ratchet is measuring a good day |
| Check whether learners who unlock the Mock on attempt counts actually perform on it | No relationship — the dose gate carries no information |
| Test whether VARK-matched adaptation beats mismatched | No difference — as the literature predicts |

**Institutional-level**

| Test | Falsifies the story if |
| --- | --- |
| Ask educators to predict which learners need intervention, with and without HF data | The data does not change decisions |
| Track interventions actually triggered by HF insight, and their outcomes | Nothing is triggered, or nothing changes |
| Compare cohort criterion profiles against end-of-course results | Cohort weakness signals do not predict outcomes |
| Check score distributions by first language, accent, gender and age | Systematic differences appear that are not explained by ability — this is a fairness falsifier, and given transcript-based scoring of speech it is the one most likely to fire |
| Ask educators whether they trust and act on the scores after a term | Trust erodes on contact with cases they know |

**The cheapest decisive test** is the first: fifty learners with both an HF band and a real IELTS result. That single study would move concurrent validity from absent to measured, and it is the question the expert is most likely to ask.

## 12. Prep sheet

### Principles we can claim

- **Criterion-referenced assessment.** No norm-referencing anywhere. Judgement is against the educator's authored descriptors.
- **Constructive alignment.** Skills, objectives, rubric bands and the target band come from one authored source and drive both what is taught and what is scored.
- **Analytic rubric scoring.** Per-criterion, not holistic, against the course's own band descriptors.
- **Formative assessment with recency-weighted estimation.** 14-day half-life, 10-score window, 3-evidence minimum before any mastery is reported.
- **Honest missingness.** Insufficient evidence produces `null`, never a default. Explicit confidence caps where the signal is indirect. An operator rule forbids fabricated scores.
- **Assessment/instruction separation.** Examiner and mock modes structurally suppress teaching.
- **Retrieval practice with rationed corrective feedback.** Quiz mode allows exactly two sentences per item, protecting retrieval from becoming re-teaching.
- **Designed productive struggle.** Typed stalls with authored scaffold pools under a "reframe, not resolve" doctrine.
- **Educator-owned pedagogy, structurally enforced.** A guard rule prevents the system from rewriting the educator's criteria.
- **Auditable evidence.** Every score names its session, its criterion, its confidence and its spec.

### Principles we cannot claim yet

- **Adaptive sequencing** — built, but bypassed on the flagship course; 136 adaptation writes have no reader.
- **Spaced repetition** — we have recency-weighted decay, not an expanding schedule responsive to recall.
- **ZPD-targeted difficulty** — a ranking weight in a component that currently does not run.
- **Mastery learning** — the threshold is uncalibrated, and the code contains an unreachable path that tries to mark a module mastered after two abandonments.
- **Dynamic assessment** — nothing records support given or scores performance under support.
- **Transfer** — not measured; practice and assessment share a format.
- **Score validity against the real bar** — no concurrent-validity or inter-rater study exists.
- **Learning-style adaptation** — the VARK meshing claim is not supported by the evidence.
- **Psychosocial insight** — no validated construct, no human gate, no defined action.

### The five hardest questions to expect

1. **"You score pronunciation from a transcript. How is that defensible?"** — It is an inference from self-corrections, hesitations and repair patterns; the spec caps its confidence and can return null. It is the weakest of the four criteria and we should say so before being asked. The fix is a prosody vendor, currently ungated on procurement.
2. **"What's your evidence these scores mean anything against a real exam?"** — None yet. Construct alignment is good; concurrent validity is unmeasured. The 50-learner comparison study is the answer, and offering it unprompted is stronger than conceding it.
3. **"Define mastery."** — Three definitions today, with different time semantics, and one reachable by quitting. Bring it up first; it lands very differently as a known defect than as a catch.
4. **"Why is VARK in there?"** — Legacy from an adjacent companion product, never scoped out. No defence. The honest answer is that it should be off for education courses.
5. **"Your learners practise and get scored — where do they act on the feedback?"** — They do not, within a task. No revision loop exists. This is the gap with the clearest pedagogical cost and the most obvious fix.

### Glossary — how we use these terms

| Term | What it means in HF |
| --- | --- |
| **Skill** | A measurable competency the course declares, with tier descriptors and a target band |
| **Learning objective (LO)** | One "the learner can…" statement inside a module |
| **Criterion** | An authored scoring dimension. Internal: never shown to a learner |
| **Band / tier** | A named level on a skill, mapped to a 0–1 threshold |
| **Score** | One criterion, one session, 0–1, with confidence and evidence |
| **Skill score** | The EMA of a skill's scores — decays |
| **LO mastery** | Best score ever seen for an objective — does not decay |
| **Module mastery** | EMA over the last 10 scores; ≥ 0.7 completes the module |
| **Mode** | The stance for a module: tutor, mixed, examiner, quiz, mock-exam |
| **Session focus** | A learner-facing technique label derived from the weakest criterion |
| **Adaptation** | A change to the next session's prompt driven by evidence |
| **Scheduler** | The component that ranks objectives by mastery gap, spacing, interleaving and difficulty — currently bypassed when a learner picks a module |

### The pedagogy, honestly, in one paragraph

HF is a criterion-referenced practice and assessment system. An educator writes a course reference declaring the skills, objectives, rubric bands and teaching rules; the system parses that into a structure it scores against. A learner practises by talking to an AI tutor that can take a teaching stance or an examining one, as the educator specified per module. After each session an LLM judges the transcript against the educator's criteria, one criterion at a time, returning null where evidence is thin rather than guessing. Those scores accumulate into a recency-weighted position per skill, and into per-objective and per-module mastery figures that gate progress through the course. The next session's prompt carries the learner's weakest criterion, their history, and the educator's teaching rules. The rubric is protected from the engine; the estimation machinery is not exposed to the educator. What the system does well is generate frequent, criterion-aligned, auditable evidence about speaking or answering performance at a volume a human tutor cannot match. What it does not yet do is model *what* a learner gets wrong, give them a chance to act on feedback and be re-assessed on the same task, sequence adaptively on its flagship course, or demonstrate that its scores agree with the real assessment they are meant to predict.
