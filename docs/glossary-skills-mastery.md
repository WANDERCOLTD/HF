# Glossary — Courses, Skills, LOs, TPs, Mastery

> **Source of truth** for the vocabulary used across course design, skill
> measurement, and learner progress. Maintained as the system evolves.
> Surfaced in the help bank at `/x/help/glossary` and indexed by Cmd+K.
>
> **Last updated:** 2026-06-13

When in doubt about a term, look here first. Every entry maps an
educator-facing label to its DB shape so designers + engineers don't drift.

---

## 1. Course-level (what the educator owns)

| DB entity | UI label | Plain English | Example |
|---|---|---|---|
| `Domain` | **Institution** | The school / org / company that owns the course | "PAW Campus" |
| `Playbook` | **Course** | One sellable / runnable course inside an institution | "CTO Standard — Revision Aid" |
| `Subject` | **Subject** (topic area) | Discipline label; a course teaches one or more subjects | "IT Leadership" |
| `CohortGroup` | **Class** / **Cohort** | The classroom of learners taking the course | "Sept 2026 intake" |

---

## 2. Sources (what the educator uploads)

| DB entity | UI label | Plain English | Example |
|---|---|---|---|
| `ContentSource` | **Source** / **Document** | An uploaded file (PDF, MD, URL) | `cio-cto-standard-revision-aid.course-ref.md` |
| `PlaybookSource` | (join row, no UI label) | "This Course uses this Source" | — |
| `documentType: COURSE_REFERENCE_CANONICAL` | **Course Reference** | The MAIN config doc — declares Skills, LOs, modules, teaching rules | The `*.course-ref.md` spine |
| `documentType: COURSE_REFERENCE_ASSESSOR_RUBRIC` | **Rubric Doc** | The separate per-band rubric (IELTS-style 9-band descriptors) | `assessor-rubric.md` |
| `documentType: COURSE_REFERENCE_TUTOR_BRIEFING` | **Tutor Briefing** | Facts the tutor needs but never quizzes on | `tutor-briefing.md` |
| `documentType: QUESTION_BANK` | **Question Bank** | Practice prompts the tutor draws from | `ielts-part1-questions.md` |
| `documentType: TEXTBOOK` | **Textbook** | Reference material extracted as content | `openstax-psych-ch11.md` |

---

## 3. The Skills Framework (the rubric the projection builds)

Lives inside the Course Reference's `## Skills Framework` section.
Parsed by `parseSkillsFramework()` in `apps/admin/lib/wizard/project-course-reference.ts`.

| DB entity / shape | UI label | Plain English | Example |
|---|---|---|---|
| `ParsedSkill` (parser output) | **Skill** | One measurable competency the course teaches | "Stakeholder anticipation" |
| `ParsedSkill.ref` | **Skill ref** | Stable ID (`SKILL-01`...) | `SKILL-01` |
| `ParsedSkill.tierScheme` | **Tier scheme** | Ordered names of the levels this course uses | `[foundation, developing, practitioner, distinction]` |
| `ParsedSkill.tiers[name]` | **Tier descriptor** | What "Developing" looks like for this skill | "Translates one risk per call" |
| `ParsedSkill.targetBand` | **Target band** | The tier / band the educator wants learners to reach | `0.70` = Band 7 / Practitioner |
| `ParsedSkill.bandThresholds[n]` | **Band descriptor** | Per-band text (IELTS 9-band style, optional) | "Band 7: Speaks at length without effort" |

**Projection writes these to DB:**

| DB entity | UI label | Plain English |
|---|---|---|
| `Parameter` (`parameterId: skill_*`) | **Skill Parameter** | The measurable dimension the AI tutor scores against |
| `BehaviorTarget` (PLAYBOOK scope, `skillRef`) | **Skill Target** | "On this course, target value for SKILL-01 is 0.70" |
| `Parameter.config.bandThresholds` | **Band rubric** | Per-band descriptor text written by the rubric-pass |
| `AnalysisSpec` (`skill-measure-<id>`) | **Skill Scoring Spec** | The prompt the AI uses to score this skill per call |

---

## 4. The Curriculum (the WHAT — content structure)

| DB entity | UI label | Plain English | Example |
|---|---|---|---|
| `Curriculum` | **Curriculum** | The full content map of the course | "The Standard V6.0" |
| `CurriculumModule` | **Module** (a.k.a. Unit / Part) | One teachable chunk | "Unit 04: IT Operations" |
| `LearningObjective` (LO) | **Learning Objective** (a.k.a. Outcome) | One specific thing the learner should be able to do | "STD-04-01: Articulate cost-effectiveness vs performance" |
| `LearningObjective.ref` | **LO ref** | Stable ID | `STD-04-01` |
| `LearningObjective.description` | **LO statement** | The "the learner can…" sentence | "The learner can describe…" |

**OUT-NN outcomes** (from `## Outcomes` section of course-ref) are
written as `LearningObjective` rows too — same table, tagged by source.

---

## 5. TPs — Teaching Principles (the HOW — tutor instructions)

The wizard `setupData.teachingPrinciples` AND the course-ref's `## Teaching
Approach` section. Stored as `ContentAssertion` rows categorised by intent.

| DB entity (category) | UI label | Plain English | Example |
|---|---|---|---|
| `ContentAssertion(teaching_rule)` | **Teaching Rule** | Instruction to the tutor about HOW to teach | "Never answer for the learner — wait for them to attempt first" |
| `ContentAssertion(scaffolding_technique)` | **Scaffolding** | Move the tutor uses when the learner struggles | "Offer the next-tier prompt as a question, not an answer" |
| `ContentAssertion(edge_case)` | **Edge Case** | What to do when X happens | "If the learner gives up, validate then offer scaffolding" |
| `ContentAssertion(skill_framework)` | (raw skill text) | Source text behind a Skill — provenance only | — |
| `ContentAssertion(assessment_approach)` | **Assessment Rule** | How the tutor judges progress | "Score per-LO per-dimension at session close" |
| `ContentAssertion(communication_rule)` | **Communication Rule** | Tone, register, voice rules | "Comfortable with silence — don't fill it" |
| `ContentAssertion(session_flow)` | **Session Flow** | The order of phases in a session | "Open → diagnose → teach → re-ask → close" |

> **Spoken shorthand "TPs"** maps to `teaching_rule + scaffolding_technique + edge_case`
> combined — all the HOW-TO-TEACH text. Rendered together in `CourseHowTab.tsx` as
> the "How" tab categories.

---

## 6. Per-learner state (what we measure — TWO parallel systems)

| DB entity | UI label | What it measures | Aggregation | Example |
|---|---|---|---|---|
| `CallerTarget.currentScore` (`skill_*` param) | **Learner Skill Score** | Continuous EMA across all calls for ONE skill | EMA, 14d half-life (config) | `0.62` → Band 6 / Practitioner |
| `CallerAttribute lo_mastery:slug:loRef` | **Learner LO Mastery** | Per-LO best-ever-seen score | Monotonic `Math.max` ratchet | `0.70` |
| `CallerModuleProgress.mastery` | **Learner Module Mastery** | Per-module rolled-up mastery | `computeModuleMastery()` EMA | `0.45` → IN_PROGRESS |
| `CallerModuleProgress.loScoresJson[ref].mastery` | (internal) Per-LO running avg | Arithmetic mean across calls | Lags the ratchet on purpose | `0.11` |
| `Call.scratchMastery` | **Mock Exam Mastery** | Per-call only, NOT cumulative (Exam Assessment) | Reset each call | varies |
| `CallerPersonalityProfile.parameterValues` | **Learner Personality Profile** | Big5 / VARK trait scores | EMA, 30d half-life | `B5-O=0.58` |
| `Goal.progress` | **Goal Progress** | 0.0–1.0 progress toward a goal | Strategy-dispatched (lo_rollup / skill_ema / etc.) | `0.70` |
| `Goal.progressMetrics.progress` | (internal) Evidence trail | `{evidence, tier, band, callId, at}` | — | — |

---

## 7. Per-call evidence (the raw signal)

| DB entity | UI label | What it captures |
|---|---|---|
| `CallScore` | **Call Score** (per-parameter measurement) | One score per Parameter per call, with `confidence` + `evidence` |
| `BehaviorMeasurement` | **Behavior Measurement** | Actual agent behavior vs. target |
| `PersonalityObservation` | **Personality Observation** | Snapshot of trait scores from one call |
| `RewardScore` | **Reward Score** | Overall call quality (`behaviorScore` × `goalProgressScore`) |
| `ConversationArtifact` | **Quote-worthy line** | Lines from the transcript flagged for sharing |
| `CallAction` | **Action Item** | Homework / next-call task |

---

## The chain — one diagram

```
Institution (Domain)
   └── Course (Playbook)
         ├── Subject(s)              ← topic area
         ├── Source(s)                ← uploaded docs
         │     │  COURSE_REFERENCE → projection extracts:
         │     │
         │     ├──► Skills Framework
         │     │      ├── Skill (SKILL-01..N) ← ParsedSkill / Parameter
         │     │      │     ├── Tier × N (descriptors)
         │     │      │     ├── Band rubric (per-band text)
         │     │      │     └── Skill Target (per-course)
         │     │      └── (AI Scoring Spec — MEASURE)
         │     │
         │     ├──► Curriculum
         │     │      └── Module(s)
         │     │            └── Learning Objective(s) (LO)
         │     │
         │     └──► Teaching Principles (TPs)
         │            ├── Teaching Rules
         │            ├── Scaffolding moves
         │            ├── Edge cases
         │            ├── Session flow
         │            └── Communication rules
         │
         └── Learners (Callers)
                ├── Skill Score per Skill (EMA, banded)
                ├── LO Mastery per LO (ratchet)
                ├── Module Mastery per Module (rolled up)
                ├── Goal Progress per Goal
                └── Personality Profile (trait EMA)
                       │
                       └── one CALL at a time
                             ├── Call Scores (per Parameter)
                             ├── Behavior Measurements
                             ├── Personality Observation
                             ├── Reward Score
                             ├── Action Items
                             └── Quote-worthy lines
```

---

## Three confusions worth naming explicitly

1. **"Skill" vs "Learning Objective"** — Skill is broad and cross-cutting
   (e.g. "Risk articulation" spans every Unit). LO is a specific can-do
   statement inside ONE module (e.g. "STD-04-01: Articulate cost-effectiveness
   vs performance"). One Skill spans many LOs across modules.

2. **"Mastery" vs "Skill Score"** — Mastery is the LO ratchet (best-ever-seen
   score, monotonic). Skill Score is the EMA across all calls (decays, can fall).
   They DIVERGE by design — Mastery says "you proved you can"; Skill Score says
   "you can right now". Both are correct; both surface separately.

3. **"Tier" vs "Band"** — Tier is the NAME (Developing). Band is the NUMBER (5.5).
   For 4-tier CTO they map 1:1. For IELTS the 9 bands compress to 3 tiers via
   `scoreToTier()`. The educator usually thinks in tiers; the learner-facing
   chip shows the band number.

---

## Maintenance rules

- Update this file whenever a new entity is introduced that belongs to any
  of the 7 layers above, OR whenever a label changes on the educator UI.
- The `/x/help/glossary` route reads this file at request time — no rebuild
  required after updates.
- Cmd+K search indexes this file via the help bank.
- Tested by `tests/lib/glossary-freshness.test.ts` (planned) which fails if
  any entity referenced in `entities.md` is missing from this glossary.

## See also

- [docs/ENTITIES.md](./ENTITIES.md) — full schema entity boundary rules
- [memory/entities.md](../.claude/projects/-Users-paulwander-projects-HF/memory/entities.md) — schema hierarchy + canonical files
- [docs/CONTENT-PIPELINE.md](./CONTENT-PIPELINE.md) — projection from course-ref to DB
- [a-sample-docs/course-reference-template.md](../a-sample-docs/course-reference-template.md) — the template educators fill in
