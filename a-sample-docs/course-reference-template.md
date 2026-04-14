# [Course Name] — Course Reference

## Document Purpose

This document is the course reference for the HumanFirst [Course Name] AI tutor. It is loaded into the tutor's knowledge base and retrieved during call planning, delivery, and post-call processing. It contains everything the tutor needs to know about this specific course — the outcomes being pursued, the content that serves them, how they are taught, how they are assessed, and how the tutor adapts call by call.

> **HumanFirst does not plan sessions in advance.** The teacher declares *outcomes*, *content*, *constraints*, and a *pedagogical preset*. The system decides, call by call, which outcome to cover next and in what mode (teach / review / assess / practise). "Session count" is a live forecast, never a contract. Write this document accordingly — describe the *destination* and the *rules of engagement*, not a fixed session-by-session plan.

This document does NOT contain:
- General tutoring behaviour (handled by the system prompt)
- [List any content loaded separately, e.g. reading passages, question banks, worksheets]

---

## Course Overview

**Subject:** [e.g. English reading comprehension, GCSE Maths, A-Level Biology]
**Exam context:** [e.g. 11+ selective entrance, GCSE AQA, no exam — skill development only]
**Student age:** [e.g. 9–11 (Year 5–6)]
**Delivery:** [e.g. Voice call, 12–15 minutes per call; WhatsApp for async support]
**Prerequisite courses:** [e.g. None / Must have completed Course X / Assumes GCSE-level knowledge of Y]
**Curriculum dependency:** [e.g. None — extracurricular / Aligned to AQA GCSE specification]

**Core proposition:** [One paragraph describing what this course does and how. What is the tutor's fundamental approach? What makes this course distinctive?]

---

## Pacing Constraints

> These are the *boundaries* the scheduler respects. They are not a plan. Leave fields blank where they do not apply.

**Call duration:** [e.g. 12–15 minutes per call]
**Total budget (optional, soft cap):** [e.g. 10 calls for a commercial package / unlimited]
**Time window (optional):** [e.g. Exam on 2026-06-15; ~8 weeks of calls at 2/week]
**Imported structure (optional):** [e.g. University module — 12 lectures. Each lecture = one outcome cluster. / None]

**How to think about the budget:** If you declare a soft cap, the system will pace outcome coverage so it is possible to finish within the budget — but it will not invent scores or rush assessments to meet an arbitrary number. If the learner needs more calls, the forecast will say so and the teacher decides whether to extend.

---

## Pedagogical Preset

> Pick one. This drives the scheduler's weighting of interleaving, spacing, difficulty, and assessment frequency. Teachers do not tune the weights directly.

- [ ] **Balanced** — sensible defaults for most courses
- [ ] **Interleaved** — aggressively mix topics; research-backed for durable transfer
- [ ] **Comprehension** — reading/listening understanding as the spine; think PIRLS/KS2 model
- [ ] **Exam prep** — retrieval practice and timed assessments weighted high, spacing around exam date
- [ ] **Revision** — assume prior exposure; maximise retrieval practice, minimise new teaching
- [ ] **Confidence-building** — prioritise the learner's ZPD edge, go slow on difficulty jumps

**Rationale:** [One or two sentences on why this preset fits this course.]

---

## What This Course Is

[2–3 paragraphs explaining the course in plain language. What does it develop? How does it work? What is the learning experience like for the student?]

---

## Learning Outcomes

> Outcomes are the spine of the course. Write each one as a concrete, observable statement — what will the learner actually be able to do? Avoid vague verbs like "understand" or "appreciate". Each outcome must be measurable through conversation, a task, or an assessment event.

### Outcome Graph

Organise outcomes into logical clusters. For each outcome, declare its **prerequisites** (other outcomes that must be reasonably mastered first). The system treats this as a DAG — it will not surface an outcome whose prerequisites are not yet met.

#### [Cluster 1, e.g. Core Skill Outcomes]

**OUT-01: [Outcome name]**
- *The learner can:* [concrete, observable statement]
- *Prerequisites:* [none / OUT-XX, OUT-YY]
- *Mastery criterion:* [what evidence counts as mastered — e.g. "answers 3 of 4 inference questions correctly across 2 different passages"]

**OUT-02: [Outcome name]**
- *The learner can:* [...]
- *Prerequisites:* [OUT-01]
- *Mastery criterion:* [...]

[Continue numbering across clusters...]

#### [Cluster 2, e.g. Exam-Readiness Outcomes / Practical Application Outcomes]

[Continue OUT-XX numbering]

### How the Tutor Knows the Course Is Working

[Describe the signals that indicate progress across outcomes as a whole. How does the tutor measure improvement through conversation rather than formal testing? What does stagnation look like, and what should it trigger? Note: day-to-day scoring is handled by the pipeline — this section is about the bigger picture a teacher would want to see.]

---

## Skills Framework

> Skills are orthogonal to outcomes. Outcomes are *what* the learner can do; skills are *how well* they can do it across contexts. Most courses have 3–8 skills. If your course is outcome-only (knowledge acquisition with no transferable skill), you may omit this section.

### Skill Definitions

**SKILL-01: [Skill Name]**
[One-sentence definition.]
- Emerging: [What does it look like when the student cannot yet do this?]
- Developing: [What does partial competence look like?]
- Secure: [What does confident, independent performance look like?]

**SKILL-02: [Skill Name]**
[Definition]
- Emerging: [...]
- Developing: [...]
- Secure: [...]

[Continue for all skills...]

### Skill Interaction Notes

[Describe dependencies between skills. Which skills reinforce each other? This helps the scheduler prioritise correctly within the current outcome.]

- [Skill X] depends on [Skill Y] because [reason]. If [Skill X] is emerging, check [Skill Y] first.
- [Continue for all meaningful dependencies...]

---

## Content Sources

> Each content source must declare the outcomes it serves and an ordering mode. The ordering mode tells the scheduler whether material must be followed in order (a novel, a textbook) or can be drawn from a pool (problem sets, past papers, reading passages).

**[Source 1, e.g. Secret Garden chapters 1–8]:**
- *Outcomes served:* OUT-01, OUT-02, OUT-05
- *Ordering mode:* `sequential` — chapters must be read in order
- *Notes:* [Anything the tutor should know — length, difficulty curve, content warnings]

**[Source 2, e.g. PIRLS-style inference passages]:**
- *Outcomes served:* OUT-02, OUT-03
- *Ordering mode:* `pool` — any passage, any order
- *Notes:* [...]

**[Source 3, e.g. Past paper questions 2019–2024]:**
- *Outcomes served:* OUT-06, OUT-07
- *Ordering mode:* `spaced` — use for retrieval practice, rotate with other sources
- *Notes:* [...]

[Continue for all sources...]

### Content Selection Preferences

> The scheduler decides *which* content to use next based on the preset and the learner's state. This section is for *teacher preferences* the scheduler should respect — not a rigid algorithm.

- [e.g. Do not use the same source for more than two consecutive calls unless the learner explicitly asks to continue]
- [e.g. Prefer fiction over non-fiction when the learner's engagement drops]
- [e.g. Hold past papers until OUT-04 is at least "developing"]

---

## Teaching Approach

### Core Principles

[List the non-negotiable teaching principles for this course. Each should be a short heading followed by 1–2 sentences explaining the principle and why it matters.]

**[Principle 1, e.g. Teach through questioning, not explanation.]** [Explanation]

**[Principle 2]** [Explanation]

[Continue for all principles...]

### Call Flow

> A call is a single interaction, not a "session" in a pre-planned sequence. Describe the standard shape of any call on this course. The scheduler picks the outcome and mode; this section tells the tutor how to *run* the call once it has the decision.

1. **Opening (~[X] minutes):** [What happens — greeting, orientation, recall of last call]
2. **Retrieval check (~[X] minutes):** [Quick pull on a previously covered outcome — keeps spacing alive]
3. **Core exchange (~[X] minutes):** [The outcome + mode the scheduler selected for this call]
4. **Stretch or consolidate (~[X] minutes):** [If time permits, either push to the next outcome in the frontier or consolidate the current one]
5. **Close (~[X] minutes):** [Summary, what the learner did well, tiny preview of next call]

[Describe how the tutor balances time between the current outcome, retrieval of previous outcomes, and any stretch goals. What does "done" look like for a single call?]

### Teaching Techniques by Outcome or Skill

[For each outcome cluster or skill, describe HOW the tutor teaches it. Include example questions or prompts. You do not need to cover every outcome individually — cluster-level guidance is fine.]

**[Outcome cluster 1 or Skill 1]:** [Techniques, example questions, common student responses, how to scaffold]

**[Outcome cluster 2 or Skill 2]:** [Techniques, example questions, common student responses, how to scaffold]

[Continue...]

---

## Course Phases

> Phases mark *qualitative shifts in how the tutor behaves*. They are no longer tied to session numbers. Each phase has entry and exit conditions based on progress events — outcome mastery, retrieval accuracy, engagement, or time elapsed.

### Phase 1: [Name, e.g. Baseline and Rapport]

**Entry condition:** `first_exchange_complete` (i.e. the first call is always Phase 1)

**Goal:** [What is this phase trying to achieve?]

**Tutor behaviour in this phase:**
- [Specific behaviour 1]
- [Specific behaviour 2]
- [Continue...]

**Parent/guardian communication:** [What is communicated, when, in what tone?]

**Exit condition:** [e.g. `outcomes_at_least_emerging ≥ 0.5 × total` AND `rapport_established == true` / `calls_completed ≥ 2`]

### Phase 2: [Name]

**Entry condition:** [Exit condition of Phase 1]

**Goal:** [...]

**Tutor behaviour in this phase:** [...]

**Exit condition:** [e.g. `outcomes_mastered ≥ 0.5 × total`]

### Phase 3: [Name]

**Entry condition:** [Exit condition of Phase 2]

**Goal:** [...]

**Exit condition:** [e.g. `all_outcomes_mastered` OR `budget_exhausted`]

[Add more phases if needed]

---

## First Call: Specific Instructions

> The first call is always unique — the tutor has no prior state on the learner. Describe exactly how the first call differs from a standard call. This replaces "Session 1" guidance.

### Pre-Call Setup

[What has the student received before the call? What should they have done to prepare?]

### Opening (~[X] minutes)

[Provide a script or near-script for the opening. Include branches for common scenarios (e.g. student has/hasn't prepared, nervous vs. eager).]

### Guided Exploration (~[X] minutes)

[How does the core of the first call differ from a standard call? What is the tutor prioritising — breadth of assessment? Comfort? Relationship-building? The first call typically does NOT try to master any outcome; it calibrates.]

### Closing (~[X] minutes)

[Provide a script or near-script. What should the tutor say — and NOT say? Do not promise a fixed number of future calls.]

### Post-Call Actions

[What happens immediately after the first call? Messages to send, learner-model seeding, observations to record.]

---

## Learner Model

[Describe the persistent data the tutor maintains for each learner.]

### Model Structure

**Outcome mastery:** per outcome — `not_started | emerging | developing | secure | mastered`, plus last-assessed timestamp and evidence count. This is the primary progress signal.

**Skill ratings:** [If the course uses a skill framework, how are skills tracked? Per skill? Per skill per content type?]

**Call history:** [What is recorded per call? At minimum: outcome covered, mode, duration, engagement, scheduler reason.]

**Engagement trajectory:** [How is engagement tracked and what triggers intervention?]

**[Any course-specific tracking]:** [e.g. Voice comfort, confidence level, homework completion]

**Pattern notes:** [Free text observations. Give 3–5 examples of the kind of notes the tutor should write.]

**Readiness flags:** [Boolean flags that gate progression — typically phase-transition gates. List them.]
- [flag_name]: [What must be true]
- [Continue...]

**Parent communication log:** [How is parent communication tracked?]

---

## Communication

[Describe how the tutor communicates outside of calls. Adapt channels to your course — WhatsApp, email, LMS, etc.]

### To the Student

**Tone:** [e.g. Warm, brief, casual. No exclamation marks unless the student uses them.]

**After every call:** [What is sent? Template or example.]

**[Any other regular communication]:** [Description and example]

### To the Parent/Guardian

**Tone:** [e.g. Professional, reassuring, specific. Never generic praise.]

**Trigger events (not a schedule):** [When are updates sent? Prefer event-based triggers — e.g. "after Phase 1 exit", "on first mastered outcome", "on engagement drop" — over "every 3 sessions".]

**Content formula:** [What should every parent message include?]

**Never include:** [What must be avoided in parent communication?]

---

## Assessment Boundaries

[Define what this course does NOT do. This prevents scope creep and sets expectations.]

This course does NOT:

- [Boundary 1, e.g. Prepare for specific exam papers]
- [Boundary 2, e.g. Teach writing / grammar / spelling]
- [Boundary 3, e.g. Replace school lessons]
- [Boundary 4, e.g. Promise specific exam outcomes]
- [Boundary 5, e.g. Commit to a fixed number of calls to mastery]

[Include a script for how the tutor should respond if a student or parent asks about something outside the boundaries — including "how many calls will this take?"]

---

## Edge Cases and Recovery

[Describe specific scenarios the tutor may encounter, with clear recovery instructions.]

**[Scenario 1, e.g. Student has not prepared]:** [What to do. How to adapt the call. What to record.]

**[Scenario 2, e.g. Student is uncommunicative]:** [What to do. How long to wait. When to end the call.]

**[Scenario 3, e.g. Student is distressed]:** [What to do. When to stop. Who to contact.]

**[Scenario 4, e.g. Parent intervenes]:** [How to handle. What to say.]

**[Scenario 5, e.g. Technical issues]:** [When to reschedule vs persist.]

**[Scenario 6, e.g. Learner plateau on an outcome]:** [When the scheduler keeps surfacing the same outcome with no progress — when to pivot, when to escalate to the teacher.]

[Add more scenarios relevant to your course...]

---

## Metrics and Quality Signals

[Describe the signals the tutor tracks for quality assurance. These are internal — not shared with the student.]

**Outcome progression rate:** [How fast are outcomes moving from emerging → mastered? What is healthy?]

**Scoring-event fidelity:** [Scores are only written when the scheduler requested assessment or a classifier detects it. Watch for zero-score calls or runaway-scoring calls.]

**Student talk ratio:** [Definition, target range, what too-low/too-high means]

**Scaffolding frequency:** [Definition, what the trend should look like]

**Evidence provision rate:** [Definition, when to start tracking]

**Forecast drift:** [If the live session-count forecast is climbing fast, the course is harder than expected for this learner — investigate.]

---

## Document Version

**Version:** 2.0
**Created:** [Date]
**Course:** [Course name]
**Status:** [e.g. Draft / Pilot-ready / Live]
**Author:** [Name]
**Reviewed by:** [Name, if applicable]

**Changelog:**
- 2.0 — Outcome-graph pacing model: outcomes + prerequisites as the spine, content tagged to outcomes with ordering modes, pedagogical preset picker, phases keyed to progress events (not session numbers), first-call guidance replaces session-1 guidance, pacing constraints section added.
- 1.0 — Initial session-indexed template.
