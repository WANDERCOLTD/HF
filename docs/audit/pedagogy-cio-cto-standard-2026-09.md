# CIO/CTO Pedagogy Audit

Sep 25, 2026 · @Paul

An audit of what pedagogy is actually implemented in the CIO/CTO Standard course, for an interview with an education expert. Written against the course reference and the code, not the pitch. Unimplemented things are marked **not specified** rather than described aspirationally.

## Scorecard

**Done** = a named mechanism that runs. **Partial** = present but uncalibrated, unverified, or bypassed in the live configuration. Data = the mechanism exists and is waiting on a value nobody has set. Study = nothing to build; it needs evidence gathering, usually with an external party. **Missing** = no mechanism.

| Area | Capability | Status | Note |
| --- | --- | --- | --- |
| Design | Criterion-referenced assessment | **Done** | 10 cross-cutting skills, 4 maturity tiers, descriptors authored per tier |
| Design | Constructive alignment | **Done** | Verbatim SIAS V6.0 objectives, HFF performance statements, skills and scenarios all from one source |
| Design | Case-based anchoring | **Done** | One authored case per Unit; "vary the prompt against the same case rather than re-narrating it" |
| Design | Progressive disclosure | **Done** | Per-session disclosure schedule stating what is introduced and what is withheld |
| Design | Single-unit-per-session | **Done** | Hard rule with a stated retention rationale; mid-session switching refused |
| Design | Three deliberately distinct vehicles | **Done** | Coaching-led / assessment-led / discussion-led, each with a "what this is NOT" boundary section |
| Teaching | Generation before instruction | **Done** | Open scenario first, teach after — the generation effect is named explicitly in the course reference |
| Teaching | One-rung teaching (ZPD in practice) | **Done** | "Teach the next tier up — never the full ladder, only the one rung above" |
| Teaching | Productive struggle | **Done** | 3–5 seconds of silence after a question; do not fill it; probe once before teaching |
| Teaching | Scaffolding on stall | **Done** | "What's the closest analogous situation you've handled?", then Foundation-tier landing, then a simpler sibling |
| Teaching | Revision loop | **Done** | Teach the missing tier, then re-ask a sibling scenario in the same session to check it stuck |
| Teaching | Differentiation | **Done** | Five learner archetypes, each with per-variant calibration of tier, opening Unit and persona |
| Teaching | Desirable difficulty | **Done** | Exam Assessment anchors on the familiar case then adds a new twist — near-transfer under altered constraints |
| Teaching | Modelling the skill being taught | **Done** | The tutor's own citation behaviour demonstrates SKILL-05 |
| Teaching | Error-recovery library | **Done** | Ten authored edge cases including learner disagreement with the regulated framing |
| Feedback | Assessment/instruction separation | **Done** | "No teaching mid-session" in Exam Assessment; teaching pause capped at \~30 seconds |
| Feedback | Retrieval practice, rationed feedback | **Done** | Pop Quiz: one sentence acknowledgement, one sentence why, move on |
| Feedback | MCQ position randomisation | **Done** | Deterministic Fisher–Yates, per-learner seed, wired into prompt assembly |
| Feedback | Forward-pointer instead of recap | **Done** | Two objectives grown, one to return to; every variant routes to its neighbour |
| Feedback | Withholding numeric scores | **Done** | Deliberate: "they'd encourage the wrong kind of optimisation" |
| Feedback | Self-explanation / error-detection prompts | **Missing** | The learner is never asked to find their own error |
| Assessment | Analytic rubric scoring | **Partial** | Skill-level tiers are real; the per-objective *dimension* axis is not |
| Assessment | **Per-LO per-dimension scoring** | **Missing** | The headline Exam Assessment feature. Three dimensions per objective, each tiered — no such axis exists in the data model |
| Assessment | Honest missingness | **Done** | Engine-wide: null on thin evidence, no fabricated defaults |
| Assessment | One-shot exam conditions | **Done** | No sibling re-ask in Exam Assessment; one prompt on a missing dimension, then score and move |
| Assessment | Concurrent validity vs the SIAS examiner | **Study** | Study, not a build — needs candidates carrying both an HF tier and a real examiner outcome |
| Assessment | Inter-rater reliability | **Study** | Study — one experienced assessor, thirty transcripts |
| Assessment | Standard setting for the four tiers | **Study** | Study — a modified-Angoff panel with SIAS; no engineering involved |
| Assessment | Misconception model | **Missing** | Scores say how well, never what was misunderstood |
| Assessment | Transfer to a genuinely novel context | **Partial** | The twist is near transfer within the same case frame |
| Adaptation | Open on weakest objective | **Done** | Mastery scan at session open, with a recency tie-break |
| Adaptation | Escalate on strong answers | **Done** | Distinction answer to a Foundation probe escalates within two turns |
| Adaptation | Adaptive sequencing engine | **Partial** | The scheduler carrying ZPD, spacing and interleaving weights is bypassed whenever a learner picks a Unit — which is the default here |
| Adaptation | Adaptation writes reaching the next prompt | **Partial** | 136 adaptation writes currently have no reader |
| Adaptation | Interleaving | **Partial** | Deliberately suppressed within a session; across sessions it is learner choice, not scheduled |
| Adaptation | Spaced practice | **Partial** | Recency-weighted decay, not an expanding retrieval schedule |
| Progression | Mastery threshold gating | **Partial** | 0.7 default, uncalibrated |
| Progression | Two-landing advance rule | **Done** | Move on when the objective lands above its prior tier twice consecutively |
| Progression | Readiness advice | **Data** | Data. buildAssessmentReadinessDirective already returns ready / not\_ready / unknown — it returns null only because no course has set the threshold |
| Progression | Two-abandonment waiver | **Broken** | Writes an off-convention status no reader honours — a dead write, not an inflated one |
| Control | Educator owns skills, rubric, objectives, cases, edge cases | **Done** | All authored; a guard rule blocks engine writes to criterion text |
| Control | Educator owns mode, duration, scoring cadence per module | **Done** | Declared in the module catalogue |
| Control | Educator owns thresholds and decay | **Partial (data)** | All three are live cascade knobs. skillScoringEmaHalfLifeDays **is** set on this course (21 days); loMasteryThreshold and assessmentReadinessThreshold are set on no course in the repo |
| Control | Educator opt-out of learner profiling | **Missing** | No consent surface |
| Insight | Per-criterion evidence trail | **Done** | Every score names session, criterion, confidence, spec |
| Insight | Cohort criterion reporting | **Partial** | Data exists; validation of any inference does not |
| Insight | Personality / modality inference | **Missing gate** | Runs with no construct validation, no human gate, no opt-out — higher risk here than on IELTS, because these learners are employed professionals. The two wellbeing specs are domain-gated and probably not attached |

**Eleven Done in teaching design, three Missing in assessment infrastructure.** That is the shape of this course: the pedagogy is unusually well specified in the authored document, and the engine underneath it cannot yet represent the most distinctive thing the document asks for.

## Method and scope

Read directly: the three CIO/CTO course references (Revision Aid, Pop Quiz, Exam Assessment) and their shared README; the 135 behaviour specs that drive the pipeline; the runners in `lib/pipeline/`; the mastery and unlock resolvers in `lib/curriculum/`; the scheduler and its presets; the MCQ delivery path; and the Prisma schema, to establish what the engine can and cannot represent.

Three evidence grades, as in the scorecard: **Done**, **Partial**, **Missing**. Where the authored document specifies a behaviour the engine cannot store, that is called out rather than credited.

**What this course is.** The CIO/CTO Standard is an Ofqual-regulated, SIAS-accredited professional qualification for IT leaders. The pilot covers five Units and 26 learning objectives, whose wording is regulated text quoted verbatim. Three separate courses share that curriculum, one tutor persona and one ten-skill framework, split into distinct teaching vehicles: a 25-minute coaching session, a 10-minute quiz, and a 40-minute board-chair assessment. Learners are working professionals — newly-promoted CIOs, fractional CIOs, IT directors moving up.

**Three ways this differs from the IELTS audit, and they matter.**

First, **the pedagogy is far more explicitly specified**. The IELTS reference describes a practice format. These describe an instructional model: what move to make when an answer is shallow, how many rungs to teach, how long to tolerate silence, how to behave when the learner disputes the regulated wording. Several named principles — the generation effect, teaching one rung above, case anchoring — appear in the authored text as deliberate choices, not as engine defaults.

Second, **it has a revision loop**, which IELTS lacks. Teach the missing tier, then re-ask a sibling scenario in the same session. Feedback is acted on and re-tested while it is still live.

Third, **the gap between document and engine is wider**. IELTS asks for things the engine mostly does. This course asks for per-objective per-dimension scoring, and the engine has no dimension axis at all. The strongest pedagogy in the product sits on the thinnest supporting infrastructure.

## 1. Principle inventory

| Capability | Principle implemented | Concrete mechanism |
| --- | --- | --- |
| Curriculum-bound practice toward a bar | **Criterion-referenced assessment** | Ten cross-cutting skills, each with four authored maturity descriptors (Foundation / Developing / Practitioner / Distinction). Target tier is Practitioner; Distinction is "welcomed and noted but not pushed for" in Revision Aid |
| Same | **Constructive alignment** | Regulated objectives quoted verbatim, HFF performance statements translate them into "what Practitioner looks like", scenarios probe them, the rubric scores them. One authored chain end to end |
| Same | **Mastery learning** — partial | Advance when an objective "lands two consecutive times above its prior tier". Engine-side, module completion is a 0.7 EMA threshold. The two rules are not the same rule |
| Coach vs examine stances | **Assessment/instruction separation** | Three separate courses rather than three modes of one. Exam Assessment forbids teaching mid-session and caps any pause at \~30 seconds: "The frame is the value Exam Assessment adds — without it, this is just Revision Aid with bigger questions" |
| Same | **Deliberate practice** | Repeated scenario probes at the learner's current tier, immediate expert feedback, explicit next-rung target, returning across sessions until the tier holds. This is closer to a full deliberate-practice loop than anything else in the product |
| Same | **Dynamic assessment** — partial, and the closest HF gets | Revision Aid's teach-then-re-ask cycle measures response to instruction within a session. What is missing is the record: the amount of support given is not stored, so assisted and unassisted performance cannot be separated afterwards |
| Scoring against the rubric | **Analytic rubric scoring** | Skills scored against authored tier descriptors; 1–3 skills surface naturally per objective probe rather than in a separate assessment block |
| Same | **Honest missingness** | Engine-wide rule: null on insufficient evidence, no fabricated defaults |
| Same | **Per-dimension analytic scoring** — **none earned** | Exam Assessment specifies three rubric dimensions per objective, each tiered, surfaced individually in the close. The engine has one mastery value per objective. The document's headline deliverable has no data structure |
| Updating positions after sessions | **Formative assessment** | Silent mastery updates per objective and per skill; EMA with a 21-day half-life on the skill side (set by this course) |
| Same | **Assessment without performance goals** | Numeric scores are deliberately withheld from learners: "they'd encourage the wrong kind of optimisation". Feedback is qualitative and specific. This is a mastery-orientation choice, made explicitly |
| Composing the next session | **Weakest-first targeting** | Session opens on the lowest-mastery objective in the chosen Unit, with recency of engagement as tie-break |
| Same | **ZPD** — authored, not computed | "Teach the next tier up — never the full ladder, only the one rung above" is a clean operationalisation of teaching just beyond current capability. It lives in the prompt, not in a resolver |
| Same | **Spacing / interleaving** — partial and deliberately constrained | Interleaving within a session is *forbidden*: one Unit per session, switching refused, on retention grounds. The scheduler's spacing and interleave weights do not run, because the learner picks the Unit |
| Same | **Case-based reasoning** | One authored case per Unit as a persistent shared frame; the prompt varies, the case does not |
| Same | **Desirable difficulty / near transfer** | Exam Assessment adds a new twist to the familiar case — altered constraints, same frame. "The twist is the assessment surface. The case is the shared frame" |
| Same | **Generation effect** | Open scenario before any teaching, named as such in the course reference |
| Same | **Adaptive differentiation** | Five archetypes, each with an authored calibration: which Unit to open on, which tier to probe, which persona to run, what to skip |
| Educator authors; engine hidden | **Teacher-owned curriculum**; **regulated-source fidelity** | Objectives are regulated text the tutor may not paraphrase; a separate performance-statement layer carries HFF's interpretation. The distinction between the two is maintained explicitly throughout |
| Scores trace to session and criterion | **Assessment transparency** | Every score carries session, criterion, confidence, evidence and the spec that produced it |
| Behaviour dials | **Named instructional variables** — uncalibrated | 163 registered parameters including productive struggle, scaffolding, worked examples, challenge level. No dose-response anchoring for any value |
| Institutional traces | **Learning analytics** — descriptive only | Per-objective mastery, per-skill trajectory, quiz accuracy, attempt counts |
| Psychosocial signals | **none earned** — and riskier here | Personality, modality, engagement and wellbeing inference run against transcripts of working professionals discussing their own organisations. See Section 9 |

**Two principles the document earns that IELTS did not.** The revision loop — teach, then re-ask a sibling scenario before the session ends — means feedback is acted upon while it is live. And the explicit refusal to show numbers, justified on the grounds that visible scores distort what learners optimise for, is a mastery-orientation stance taken deliberately rather than by omission.

**One principle the document claims and the engine cannot keep.** Per-objective per-dimension scoring is described as "the most concrete feedback a Practitioner-tier learner will get". It exists as prompt instruction only. The model can be asked to produce the breakdown in conversation; nothing stores it, nothing accumulates it, nothing reports it next session.

## 2. Intended theory of change

- **Learner.** An IT leader rehearses judgement calls they rarely get to practise — the board conversation, the vendor pushback, the decision under time pressure — against a rubric that names what the next level of maturity sounds like. Each session moves one objective one rung. Mechanism: repeated scenario rehearsal with expert feedback and an explicit next-rung target. Horizon: months, across the three vehicles in a Pop Quiz → Revision Aid → Exam Assessment cadence.
- **Educator or assessor.** Per-objective maturity positions and structured exam feedback replace the judgement call "is this candidate ready to sit". Horizon: from the first Exam Assessment session.
- **Institution.** A sponsoring employer or training provider sees where a cohort of IT leaders sits against a regulated standard before the examination, and which objectives need teaching. Horizon: one cohort cycle.

The mechanism that carries all three is **rehearsal of professional judgement against an explicit maturity ladder, with feedback naming the specific next rung**. That is a stronger mechanism than practice volume alone, because the ladder tells the learner what better looks like rather than only that they fell short. It is also untested here.

## 3. What is measured vs what is improved

| Measure | Claimed improvement | Link specified? |
| --- | --- | --- |
| Maturity tier per skill, per scenario | Professional judgement has moved up a rung | **Weak** — the descriptors are specific and behavioural ("names what the chosen option costs", "refuses to fund without sponsor"), which is genuine construct work. But no tier has been validated against observed workplace behaviour |
| Per-objective mastery | The learner has internalised this objective at Practitioner tier | **Weak** — best-score-ever, no decay, and the advance rule in the document (two consecutive landings) is not the rule the engine applies (a 0.7 EMA) |
| Per-skill EMA across sessions | Durable capability rather than a good session | **Yes** — mechanism specified: 21-day half-life (course-set), 10-score window, 3-evidence minimum |
| Pop Quiz accuracy out of 8–12 | Recall of the regulated vocabulary is secure | **Yes, and appropriately modest** — the course reference explicitly frames a low first score as "diagnostic, not a fail" and claims only vocabulary confirmation, routing depth work to Revision Aid |
| Per-LO per-dimension tiers from Exam Assessment | Exam readiness on each dimension | **No** — nothing stores the dimension breakdown. The claim is made in conversation and then lost |
| "Two objectives grew, one to come back to" | Session-level progress the learner can act on | **Partial** — the forward pointer is well designed; whether the named growth reflects a real tier change depends on the mastery layer above, which has the two-rules problem |
| Readiness statement ("Practitioner on 4 of 7 — two more sessions first") | Candidate is ready to sit the SIAS examination | **No** — an authored script reading live mastery. Honest in tone, but no engine verdict and no validation against actual examination outcomes |
| Skill tier vs the SIAS examiner's judgement | HF tiers predict the regulated outcome | **No** — no comparison exists. For a course attached to an Ofqual-regulated qualification this is the sharpest gap |
| Decision velocity under time pressure | Faster, better decisions at work | **No** — measured as a rubric tier in a simulated board conversation; no workplace evidence |
| Personality / modality / wellbeing profiles | Better-adapted teaching | **No** — unvalidated, and see Section 9 |

Two things to hold together here. The rubric descriptors are unusually good — behavioural, specific, and written by someone who knows what a Practitioner actually sounds like. And every link from those descriptors to a real-world outcome is currently unevidenced. Strong instrument design, no validation study.

## 4. Adaptation logic

Adaptation here runs at two levels, and they are worth separating because they have very different standing.

**Within-session adaptation — authored, and the stronger of the two.**

| Evidence | Changes |
| --- | --- |
| The tier an answer lands at | Which rung is taught next — one above, never the full ladder |
| A shallow answer | One probe for depth ("walk me through why") before any teaching |
| "I don't know" | A scaffold: "what's the closest analogous situation you've handled?", then Foundation-tier landing, then a simpler sibling scenario |
| A Distinction answer to a Foundation probe | Escalation to Practitioner-tier scenarios within two turns |
| Two consecutive landings above prior tier | Move to the next-weakest objective |
| Learner disputes the regulated framing | Accept it, ask for the alternative, map it back to an objective — and score it as evidence on trade-off explicitness |
| Learner archetype | Opening Unit, probe tier, persona framing, and what to skip |
| Learner in a live crisis | Pivot to operational coaching using the Unit's case as the working metaphor; score decision velocity and risk articulation |

This is a genuine adaptive teaching model. It is also entirely prompt-resident: the model is instructed to do these things, and whether it does them is unverified.

**Cross-session adaptation — engine-side, and thinner.**

Session open reads per-objective mastery to pick the weakest objective, with recency as tie-break. Skill EMAs update. Memories and goals extract. The next prompt carries the learner's history.

**What cannot change.** The regulated objective wording — structurally, not just by convention. The course reference is explicit: "The tutor must NOT rewrite the LO — it's regulated", and a guard rule blocks engine writes to criterion text. The skills, tier descriptors, cases and target tier are all authored. Nothing in the loop can lower the bar or reword the standard. For a regulated qualification that boundary is the right one and it holds.

**Three limits.**

First, **the scheduler does not run on this course**. Default mode is learner-picks, which locks the module and bypasses the component carrying the ZPD, spacing, interleaving and cognitive-load weights. That is arguably correct here — the single-Unit rule and learner choice are deliberate design decisions that a global scheduler would fight — but it means "adaptive sequencing" should not be claimed. Sequencing is: learner picks a Unit, system opens on the weakest objective within it.

Second, **136 adaptation writes have no reader**. A Coverage gate walks every value an adaptation spec writes and checks whether any compose-side code reads it; the count is frozen at 136. Those computations persist and never reach the next prompt.

Third, **the within-session model is unverified**. Nothing checks that the tutor taught only one rung, or waited the specified silence, or probed once rather than three times. A supervision stage exists in the pipeline; it is not currently used to audit fidelity to the authored teaching model. That is the single highest-value thing that could be built here, because the instructional design is good enough to be worth enforcing.

## 5. Assessment model

**Criterion-referenced, with no norm-referencing anywhere.** No percentiles, no cohort ranking, no curve — confirmed across the codebase. The Exam Assessment disclosure schedule explicitly withholds "comparison with other learners" from the exit feedback. Judgement is against authored maturity descriptors only.

**The educator owns the rubric, and the source is regulated.** Two layers are kept deliberately distinct: the SIAS V6.0 objective wording, which is regulated text held on the objective row and quoted verbatim, and the HFF performance statements underneath, which are an authored interpretation of what Practitioner looks like. The course reference is repeatedly explicit that the second must not be mistaken for the first. A guard rule prevents the engine from rewriting either.

**Validity against the professional bar**

| Requirement | Status |
| --- | --- |
| Construct alignment | **Good.** Objectives are the regulated ones. The ten cross-cutting skills are drawn from the Standard's own competencies and their descriptors are behavioural and specific |
| Concurrent validity vs the SIAS examiner | **Absent.** No HF tier has been compared with an examiner's judgement on the same candidate |
| Inter-rater reliability | **Absent.** No double-marking against a human assessor |
| Standard setting | **Absent.** No procedure justifies where Practitioner begins, or that the boundary matches the qualification's pass standard |
| Test-retest reliability | **Partially designed.** The EMA smooths, but its stability is uncharacterised |
| Score reporting integrity | **Compromised for the Exam Assessment.** The per-dimension breakdown is generated in conversation and not persisted |

**Construct underrepresentation.** The Standard covers leadership judgement enacted over time, in an organisation, with real consequences. A 40-minute voice scenario measures the *articulation* of judgement — what a candidate says they would do, under no real stake. This is a legitimate and widely-used proxy, and it is what a viva or a structured professional interview also measures. But "can describe the right move persuasively" and "does the right move under pressure at 02:00" are not the same construct, and the more senior the learner, the more practised they are at the first. Worth naming before an expert does.

A second, sharper form: **the twist is the assessment**. Exam Assessment's probes vary the constraints on a case the learner has already met in Revision Aid. That is near transfer. A candidate who has rehearsed the Severn Health Trust case five times is being assessed on a familiar frame, which flatters readiness relative to a genuinely novel scenario.

**AI-interaction artefacts.** An LLM judging seniority-coded professional discourse has predictable failure modes: confident delivery, fluent business vocabulary and rhetorical polish are exactly what a language model is most sensitive to, and they are also what distinguishes a practised presenter from a good decision-maker. The rubric's Distinction descriptors compound this — several are claims about the learner's past behaviour ("has reframed a commercial conversation in ways the CFO adopted", "has refused a capex saving because of the structural ops cost"). The tutor can only observe the *claim*. Scoring Distinction on an unverifiable self-report is a real validity problem, and it sits at the top tier where the stakes are highest.

Existing mitigations are structural, not empirical: nulls on thin evidence, per-skill breakdown, a ban on fabricated defaults, and the explicit instruction to defer to the regulator ("the SIAS examiner is the final adjudicator"). That last line is good practice and should be pointed to. None of it establishes accuracy.

## 6. Feedback and struggle

The three variants take three different positions on when help arrives, and the course references defend each choice explicitly. That is rare and worth showing.

| Variant | Feedback | Justifying principle |
| --- | --- | --- |
| **Revision Aid** | Delayed within the turn: probe once for depth, then teach one rung, then re-ask a sibling scenario | Generation effect, then targeted instruction at the edge of capability, then a retrieval check |
| **Pop Quiz** | Immediate and rationed: one sentence right/wrong, one sentence why, move on. "No follow-up questions. No extended teaching" | Retrieval practice with corrective feedback; brevity protects retrieval from becoming re-teaching |
| **Exam Assessment** | Withheld entirely until the close. One prompt on a missing dimension, then scored. Score requests refused mid-session: "You'll get the breakdown at the close" | Assessment/instruction separation — help during assessment invalidates the measurement |

**Productive struggle is explicit and specified in time.** "Pace: patient. 3–5 seconds of silence after asking a question. Do not fill silence with the answer." On a blank: one scaffold that reaches for the learner's own experience — "what's the closest analogous situation you've handled?" — before any content is supplied. On a shallow answer: one probe, then teach. The struggle has a defined length and a defined exit, which is more than most systems specify.

Exam Assessment's version is harsher and deliberately so: below Practitioner on a dimension gets one prompt, "one chance to land it", then it is scored and the session moves on. "Do NOT teach the framework — that's Revision Aid. The structured close will surface this as a Revision Aid pointer." The struggle is not resolved in-session; it is routed.

**The revision loop is real, and it is the strongest feedback mechanism in the product.** Teach the missing rung, then re-ask a *sibling* scenario — not the same one — to check the new tier holds, within the same session. Feedback is acted on and re-tested while it is still live. Nothing else in HF does this.

**What remains prompt-only.** None of the above is verified. No check counts the probes, measures the silence, confirms only one rung was taught, or confirms the sibling re-ask happened. The teaching model is high quality and entirely unenforced — the gap between "the document says" and "the session did" is unmeasured. Given how specific these instructions are, they would be unusually easy to audit, and a supervision-stage fidelity check is the obvious next build.

**Still missing: self-explanation.** The learner is never asked to find their own error — "you said X; what's missing from that?" The closest move is the disagreement path, where a learner who challenges the framing is asked to articulate their alternative. That is good practice but it is learner-initiated, not a designed prompt.

**And the same broken waiver as IELTS.** Two abandoned attempts at a module are meant to advance the learner past it. `markModuleIncomplete` writes the literal string `MASTERED` into `CallerModuleProgress.status`, whose canonical vocabulary is `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED`. `MASTERED` is a *presentational* value the API layer produces **from** `COMPLETED`; written into the column directly it matches nothing. Both readers map unrecognised values to `NOT_STARTED`, and the prerequisite gate counts only `COMPLETED`. The module therefore reads as *not started*, satisfies no prerequisite, and keeps being offered. On a regulated qualification this is the safer failure — the mastery record is not inflated — but the intended behaviour is absent, and an author reading the code would reasonably believe it works.

## 7. Sequencing and mastery

**Sequencing is learner-led by design, not by omission.** All five Units are selectable in any order; none is session-terminal; all are repeatable. The system's contribution is *within* the chosen Unit: open on the lowest-mastery objective, break ties by recency of engagement. The course reference defends the constraint that comes with this — one Unit per session, switching refused mid-call, on retention grounds. That is a deliberate anti-interleaving stance, and it conflicts with the interleaving weight the engine's scheduler would apply if it ran. The authored decision is the one in force.

The three variants have a recommended cadence — Pop Quiz surfaces recall gaps, Revision Aid does the depth work, Exam Assessment checks readiness — and each names the neighbour to route to. Nothing enforces the cadence; it is advice delivered in the close.

**"Ready" means four different things here.**

| Gate | Definition | Standing |
| --- | --- | --- |
| Ready for the next objective | Two consecutive landings above the prior tier | **Authored only.** No engine rule implements this — it is an instruction to the model |
| Module complete | EMA ≥ 0.7 over the last 10 scores, minimum 3 pieces of evidence, 21-day half-life, ramped so one strong call cannot carry it | **Engine.** Uncalibrated threshold; half-life is course-set |
| Ready for Exam Assessment | An authored script reads live mastery: "You're at Practitioner on 4 of the 7 objectives… I'd recommend two more Revision Aid sessions on LO5 and LO7" | **Data, not a gap. The engine has a live resolver — buildAssessmentReadinessDirective returns ready / not\_ready / unknown against assessmentReadinessThreshold, a cascade knob. It returns null here only because no course has set the number** — specific, non-committal, actionable. No engine verdict behind it |
| Ready for the SIAS examination | **Not specified** | The tutor is instructed to defer: "the SIAS examiner is the final adjudicator — my read suggests…" |

The deferral to the regulator is correct and should be highlighted. The readiness machinery, though, is better than it looks from the outside: the resolver exists, it is wired into compose, and the threshold is a cascade knob an educator can set per course. What is missing is the value — nobody has set it — and a calibration for what the value should be. That is a data gap and a study, not an engineering gap. The weaker half of the claim stands: the number the resolver would compare against has not been calibrated to the qualification's pass standard.

**Two advance rules that are not the same rule.** "Two consecutive landings above prior tier" is a within-session pedagogical judgement made by the model. "EMA ≥ 0.7" is a cross-session statistical judgement made by the engine. They can disagree, nothing reconciles them, and which one a learner experiences depends on whether they are hearing the tutor or looking at progress.

**Decay.** Skill scores decay on a half-life this course sets to 21 days (the engine default is 14). Per-objective mastery is a permanent maximum with no decay — a tier reached once is held forever. For professional judgement that is a strong assumption: these are capabilities that atrophy without use, and the course's own premise ("the learner returns until each objective sits at the tier they're targeting") implies ongoing practice rather than a one-time achievement. Spacing exists as recency weighting on one store and not at all on the other; scheduled spaced retrieval does not run.

## 8. Educator control

| Decision | Owner |
| --- | --- |
| The ten skills and their four tier descriptors | **Educator** |
| Which objectives exist and their regulated wording | **Regulator (SIAS)**, quoted verbatim; the engine may not rewrite it |
| Performance statements — what Practitioner looks like | **Educator** |
| Case studies, scenario twists, question bank | **Educator** |
| Teaching stance, probe policy, silence tolerance, one-rung rule | **Educator**, authored as prose |
| Learner-archetype differentiation | **Educator** |
| Edge-case and recovery scripts | **Educator** |
| Disclosure schedule — what is said and withheld per session | **Educator** |
| Module mode, duration, scoring cadence, repeatability | **Educator** |
| Whether numeric scores are shown to learners | **Educator** — and answered no, with a reason |
| Which variant to route to next | **Educator**, authored into each close |
| Mastery threshold, EMA half-life, evidence minimum | **Mixed** — half-life is a cascade knob and is set here (21 days); the threshold is a knob left unset; the evidence minimum is an engine constant |
| Whether the two-landing advance rule is enforced | **Neither** — authored but unimplemented |
| Whether a learner profile is built | **Engine** — no opt-out |

**Is the split coherent?** More so than on any other HF course. The educator owns the entire instructional model, not just the content: the persona, the probe policy, the pacing, the recovery behaviour, the disclosure rules, the routing. The engine owns measurement plumbing. That is the right division and this course reference exercises it more completely than anything else in the product — a reader could hand these documents to a human tutor and get a recognisable version of the same session. That is a real test of whether pedagogy is genuinely configuration-resident, and it passes.

**Three incoherences.**

**The educator's advance rule is not the engine's.** "Two consecutive landings above prior tier" is the pedagogical judgement the author specified. The engine advances on a 0.7 EMA. The author cannot express their rule in a form the system enforces, and is probably unaware the system is applying a different one.

**The educator can express half of a decay policy.** For professional judgement in a regulated field, "mastered eight months ago and never revisited" is a meaningful state. On the skill side the author can say so, and has: `skillScoringEmaHalfLifeDays` is a cascade knob and this course sets it to 21 days — a deliberate slower fade than the 14-day default, and the longest of any course in the repo. On the per-objective side there is no decay at all and no knob to create one, so a tier reached once is held forever. The policy the author can express covers the store the learner never sees; the store that drives progression has none.

**Profiling has no educator gate.** Personality, modality and engagement inference run unconditionally on these learners — with no consent surface for the educator or the sponsoring employer. On a course where the learner is an employed professional discussing their own organisation, this is a materially different risk from a language learner practising small talk — see Section 9.

## 9. Insight layer

**Learning evidence — defensible.** Per-objective maturity positions, per-skill tier trajectories, quiz accuracy by objective, attempt counts, which objectives grew this session, which cases have been worked. All of it is either the educator's authored criteria applied to a session, or a count of what happened. Reporting it to a tutor, an assessor or a sponsoring employer is ordinary formative practice.

**Psychosocial and profile signals — contested, and higher-stakes here than on IELTS.** The same five specs exist; three run unconditionally and two are domain-gated — see below the table:

| Spec | Construct | Validation | Human gate | Verdict |
| --- | --- | --- | --- | --- |
| Big Five / OCEAN | Personality traits | None. Validated for questionnaires, not for inference from a professional conversation | None | **Overreach** |
| VARK | Learning modality | None; the instructional claim is contradicted by the literature | None | **Overreach** |
| Cognitive activation | "Caller mental state" | None | None | **Overreach** — clinical register for an engagement proxy |
| Emotional wellbeing | "Emotional tone, loneliness or isolation signals" | None | None | **Overreach, highest risk** |
| Cognitive patterns | "Cognitive patterns in conversation" | None | None | **Overreach** |

**Which of these actually run here.** `PERS-001`, `VARK-001` and `CA-001` are `SYSTEM`-scoped with no `profileCondition`, and the spec loader runs such specs unconditionally — so personality, modality and cognitive-activation inference do run on these transcripts. `COMP-EW-001` and `COMP-CG-001` are `DOMAIN`-scoped to the `companion` domain and load only when the enrolled playbook lists them in its `items`, which an education playbook almost certainly does not. The two highest-risk inferences are therefore probably dormant. Probably, not certainly: confirming it needs a check of the playbook's attached specs, which has not been run. Either way there is no educator or learner opt-out, and access is whoever can read `CallerAttribute`.

**Why this is sharper on this course than on IELTS.** Three reasons, and they compound.

The learners are **employed professionals**, often sponsored by their employer, frequently discussing their own live organisation — the board they report to, the vendor they are about to reject, the predecessor whose strategy they inherited. Transcripts contain commercially sensitive material about identifiable third parties who never consented to anything.

The inferences are **placement-relevant by nature**. A personality profile or a "decision velocity" tier on a CIO is not an abstract learning signal; it is the kind of judgement that feeds promotion, succession and suitability decisions. If an employer is paying for the course, the temptation to ask for that read is structural, not hypothetical.

And the course design **actively elicits disclosure**. The crisis-pivot path — "my org's just had a P1 incident, I need help now" — is a deliberate, humane and pedagogically sound feature. It also means the system is designed to receive a senior leader talking candidly about a live incident under stress, while an un-gated wellbeing-inference spec is running on the transcript.

**Two mitigating facts, and neither is a safeguard.** The companion-domain specs were written for a different product — a conversational companion for older adults — and were never scoped out when the professional courses were built. And a structural gate stops internal labels appearing on learner-facing surfaces. Scoping-by-accident is not a control, and a display gate protects the learner's *view*, not the inference, the storage, or who can query it later.

**What is missing for any legitimate use:** a named validated construct, a stated purpose, a human decision-maker in the loop, a retention limit, learner notice, and a contractual boundary on employer access. None exists.

The position to take into the interview: the learning evidence is sound and we stand behind it. The profiling layer is legacy from an adjacent product, has no validation, should be off for professional courses, and we make no claims on it. Said first, that is a credible answer. Said under questioning, it is not.

## 10. Gaps and folklore

### Principles a curriculum mentor would expect, and that are absent

- **A misconception model.** Nothing represents *what* a learner gets wrong. Two learners at Developing on risk articulation — one who names risks but never quantifies them, one who quantifies but never maps to business process — are the same number. The tier descriptors are specific enough that this is fixable, which makes the absence more frustrating, not less.
- **Per-dimension representation.** The headline Exam Assessment deliverable has no data structure (Sections 1 and 5).
- **Self-explanation prompts.** Never asks the learner to find their own error.
- **Far transfer.** The twist varies constraints on a familiar case. Nothing assesses judgement on a genuinely unfamiliar situation.
- **Worked-example fading.** The dial exists; expertise-reversal logic does not.
- **Standard setting.** No procedure justifies where Practitioner begins, or that it corresponds to the qualification's pass standard. On a regulated course this is a governance gap, not just a pedagogical one.
- **Moderation.** No second marker, no sample review, no drift monitoring on the judge over time.
- **Fidelity checking.** The authored teaching model is detailed and entirely unverified.

### Terms with no operational definition here

| Term | What it lacks |
| --- | --- |
| **Per-LO per-dimension scoring** | A dimension axis. Generated in conversation, stored nowhere |
| **Adaptive** | The scheduler is bypassed; 136 adaptation writes have no reader |
| **Mastery** | Three definitions — two-consecutive-landings, EMA ≥ 0.7, and best-ever-no-decay — plus an abandonment path that is coded but inert |
| **Maturity tier** | Real and well described at Foundation–Practitioner. At Distinction, several descriptors are claims about past behaviour the tutor cannot verify |
| **Readiness** | An authored script over an uncalibrated number; no engine verdict |
| **Decision velocity** | A rubric tier in a simulated board conversation; no workplace referent |
| **Silent mastery update** | Accurate — but what is updated is the engine's EMA, not the two-landing rule the document describes |
| **Productive struggle** | Specified in seconds in the document, unmeasured in the system |
| **Cognitive patterns**, **mental state** | Clinical register, no construct |

### Internal contradictions

1. **The document's advance rule and the engine's are different rules.** Two consecutive landings above prior tier versus a 0.7 EMA. Nothing reconciles them; the author is probably unaware.
2. **The flagship feature has no storage.** Exam Assessment's per-dimension breakdown is called "the most concrete feedback a Practitioner-tier learner will get", and it evaporates when the call ends. The learner is told to bring two pointers to Revision Aid, and Revision Aid has no way to read them.
3. **Interleaving is forbidden by the author and weighted by the engine.** One Unit per session is a hard authored rule with a retention rationale; the scheduler carries an interleave bonus. They never collide only because the scheduler does not run.
4. **Mastery never decays, on a course premised on returning.** "The learner returns until each objective sits at the tier they're targeting" describes ongoing practice. The per-objective store records a permanent high-water mark.
5. **A waiver that silently does nothing, on a regulated qualification.** Two early exits are meant to advance the learner; the status written is off-convention, so every reader treats the module as not started and the prerequisite gate ignores it. The record is not corrupted — but a documented progression rule is inert, and nothing surfaces that.
6. **Distinction rewards the unverifiable.** Descriptors at the top tier ask what the learner *has done* in their organisation. The tutor observes only the telling. The most fluent self-reporter scores highest at exactly the tier where the claim matters most.
7. **Careful about labels shown, careless about inferences made.** A gate stops a skill name reaching the learner's screen, while an un-validated personality profile of a named senior executive is built from the same transcript.

## 11. Falsifiers

**Learner-level**

| Test | Falsifies the story if |
| --- | --- |
| Compare HF maturity tiers against SIAS examiner outcomes for the same candidates | Weak correlation, or systematic optimism — the readiness conversation is then misleading on a regulated qualification |
| Have an experienced assessor independently tier a sample of session transcripts | Agreement no better than chance-adjusted baseline |
| Re-run the same transcript through the scorer repeatedly, and across model versions | Tiers move materially — trajectories are noise |
| Score a cohort on rhetorical fluency independently, and regress tier on it | Fluency predicts tier better than substance does — the judge is rewarding delivery |
| Test Distinction descriptors against verifiable evidence (a 360, a peer account) | Self-reported claims do not survive checking — the top tier measures storytelling |
| Compare Revision Aid gain against equal-time reading of the Standard | No difference — the rehearsal mechanism is not doing the work |
| Re-test four weeks after an objective is marked at Practitioner | Performance reverts — the no-decay ratchet is recording a good day |
| Check whether Pop Quiz accuracy predicts Exam Assessment tier | No relationship — the routing layer routes on nothing |
| Audit transcripts for fidelity to the authored model — one rung taught, one probe, silence held | The tutor does not follow the teaching model — then the pedagogy is a document, not a product |

**Institutional-level**

| Test | Falsifies the story if |
| --- | --- |
| Ask assessors to call readiness with and without HF data | The data does not change the decision |
| Track candidates advised "ready" against actual examination outcomes | No better than base rate |
| Check tier distributions by first language, accent, gender, age and sector | Systematic differences unexplained by capability — the likeliest of these to fire, given an LLM judging professional discourse |
| Ask whether employers request the personality profile once they learn it exists | They do — confirming the placement-drift risk in Section 9 is structural rather than theoretical |
| Ask tutors after a term whether they trust the tiers on learners they know well | Trust erodes on contact with cases they can check |

**The two cheapest decisive tests.** First, a fidelity audit: take fifty transcripts and check whether the tutor actually taught one rung, probed once, held the silence, and re-asked a sibling. It needs no external party, and it tests the thing the product is actually claiming. Second, an assessor agreement study: one experienced SIAS assessor, thirty transcripts, blind tiering. Together they cover both halves — does the teaching happen, and is the measurement real.

## 12. Prep sheet

### Principles we can claim

- **Criterion-referenced assessment against authored maturity descriptors.** Ten skills, four tiers, behavioural and specific. No norm-referencing anywhere.
- **Constructive alignment on a regulated source.** Verbatim objectives, an explicit performance-statement layer, scenarios and rubric all from one authored chain — with the regulated text protected from rewriting.
- **Three distinct teaching vehicles, each with a defended stance.** Coaching, quizzing and examining separated into different courses, each with an explicit "what this is NOT" boundary and a route to its neighbour.
- **Generation before instruction.** Open scenario first, teach after.
- **Teaching one rung above current tier.** ZPD, operationalised in a sentence a tutor can follow.
- **A revision loop.** Teach the missing rung, re-ask a sibling scenario, check it stuck — in the same session.
- **Specified productive struggle.** Three to five seconds of silence, one probe, one experience-anchored scaffold before content is supplied.
- **Deliberate practice structure.** Repeated targeted rehearsal, expert feedback, explicit next target, return until it holds.
- **Case-anchored near transfer.** One case per Unit; the exam varies the constraints rather than the case.
- **Differentiation by learner archetype.** Five archetypes, each with authored tier, opening and persona calibration.
- **Retrieval practice with rationed feedback.** Two sentences, then move on, with randomised option positions.
- **Mastery orientation over performance orientation.** Numeric scores deliberately withheld, with the reason stated.
- **Deference to the regulator.** The tutor is instructed that the SIAS examiner is the final adjudicator.

### Principles we cannot claim yet

- **Per-objective per-dimension assessment** — specified, promised to learners, not storable.
- **Adaptive sequencing** — the engine's is bypassed; what runs is learner choice plus weakest-objective-first.
- **Spaced or interleaved practice** — recency-weighted decay only, and interleaving is deliberately suppressed.
- **Mastery learning** — three definitions, one uncalibrated threshold, and an abandonment path that never takes effect.
- **Validity against the qualification** — no examiner comparison, no assessor agreement, no standard setting.
- **Fidelity to our own teaching model** — unverified.
- **Transfer** — near transfer only.
- **Learning-style adaptation** — unsupported by the evidence.
- **Psychosocial insight** — no construct, no gate, no purpose limitation.

### The five hardest questions to expect

1. **"Show me the per-dimension feedback from a real session."** We cannot — it is generated in conversation and never stored. Say it before the demo, not during.
2. **"How do your tiers relate to the SIAS pass standard?"** No standard-setting procedure exists. On a regulated qualification this is the question with governance weight, and the honest answer is that our tiers are an authored ladder, not a mapped one.
3. **"Your Distinction descriptors ask what the learner has done. How do you verify that?"** We do not. The top tier currently rewards the telling.
4. **"Does the tutor actually do what your document says?"** Unknown. Unverified. The fidelity audit is the fix and it is cheap — offering it converts the weakest answer into the most credible one.
5. **"These are employed professionals. What are you inferring about them, and who can see it?"** Personality, modality and wellbeing profiles are built with no consent surface and no purpose limitation. There is no defence — only a commitment to switch it off.

### Glossary — how we use these terms

| Term | What it means here |
| --- | --- |
| **Unit** | One of the five Standard Units; one per session, hard rule |
| **Learning objective** | Regulated SIAS V6.0 text, quoted verbatim, never paraphrased |
| **Performance statement** | HFF's authored "the learner can…" translation — guidance, not the regulated objective |
| **Skill** | One of ten cross-cutting competencies, scored on four maturity tiers |
| **Tier** | Foundation → Developing → Practitioner → Distinction. Practitioner is the target |
| **Dimension** | Three per objective in the Exam Assessment design. Not represented in the system |
| **Landing** | The tier an answer reaches on a given probe |
| **Sibling scenario** | A second scenario on the same objective, used to check a newly-taught tier holds |
| **Twist** | A new constraint on a familiar case — the Exam Assessment's assessment surface |
| **Silent mastery update** | Scores written without telling the learner a number — deliberate |
| **Archetype** | One of five learner profiles driving opening, tier and persona calibration |

### The pedagogy, honestly, in one paragraph

The CIO/CTO Standard courses are a criterion-referenced rehearsal and assessment system for professional judgement, built on a regulated qualification. An educator has authored an unusually complete instructional model: ten skills with four behavioural maturity tiers each, five case studies, five learner archetypes, an explicit probe-and-teach policy, a defined tolerance for silence, and a library of recovery moves. Three courses split that model into coaching, quizzing and examining, each with a stated boundary and a route to its neighbour. A learner picks a Unit; the tutor opens on their weakest objective, asks an open scenario before teaching anything, listens for which tier the answer reaches, teaches exactly one rung above, then re-asks a different scenario to check it held. Scores accumulate silently, because showing numbers was judged to distort what learners optimise for. What the system does well is rehearse judgement calls that working IT leaders rarely get to practise, against a ladder that names what better sounds like, with feedback acted on inside the same session. What it does not yet do is store the per-dimension assessment its own exam design promises, model what a learner actually gets wrong, verify that the tutor follows the teaching model, calibrate its tiers against the regulated pass standard, or show that any of its judgements agree with an examiner's.
