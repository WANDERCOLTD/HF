# IELTS Speaking Practice — Wizard Prompt

Authored from the HumanFirst Course Reference Template v3.0
(`a-sample-docs/course-reference-template.md`). See `docs/CONTENT-PIPELINE.md`
§3.2 for the front-matter declaration spec.

Paste this prompt into the V5 wizard chat. Upload the 8 docs from `Upload Docs/` when prompted.

---

## Wizard prompt

```
I'm setting up an IELTS Speaking preparation course.

Institution: IELTS Prep Lab
Type: Language school
Subject: IELTS Speaking
Course name: IELTS Speaking Practice
Audience: higher-ed

The learners are adults preparing for the IELTS Academic or General Training
exam, typically targeting Band 6.5–7.5. Most are non-native English speakers
aiming for university admission or professional registration. The Speaking test
is identical for both Academic and General Training.

Teaching approach: socratic — the student speaks, the AI examines and coaches
through targeted questions. Never answer for the student.

Calls: soft cap ~12 × 20 minutes.

progressionMode: learner-picks — the learner picks one of four modules at the
start of each call from Call 2 onwards (Part 1: Familiar Topics, Part 2: Long
Turn, Part 3: Abstract Discussion, Full Mock Exam). The four modules and the
eight OUT-NN learner outcomes are authored in course-ref.md — the Module
Catalogue parser will pick them up automatically when course-ref.md is uploaded.
Do **not** call update_setup with `modulesAuthored` or `constraints` — those
are not setupData fields. Authored-module status is set by the course-ref.md
parser; voice rules and tutor principles flow in via course-ref.md sections
(Teaching Approach, First Call Special Rules, Disclosure Schedule).

Coverage: depth — better to master two Speaking Parts than skim all three.

Assessment style: formal — track band scores per criterion across calls
(Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy,
Pronunciation), but **never name them on Call 1**.

Voice rule for Call 1 (onboarding): the tutor must NOT name the four criteria,
explain the band scale, or score explicitly. Call 1 is a Part-1-only topic
warm-up (work / study / hometown / hobbies). The four criteria are introduced
one per call across Calls 2–5 per the Disclosure Schedule in `course-ref.md`.
Please extract the "First Call (Onboarding) — Special Rules" section and the
"Disclosure Schedule" as `sessionOverrides` entries with `section: "1"` and
`section: "2+"` respectively, so the per-call filtering in
`course-instructions.ts:matchesSessionRange()` honours the call-number scope at
runtime. The "What This Course Is" and "Skills Framework" sections in
`course-ref.md` are tagged `**Session scope:** 2+` — extract those as
`session_override` with `section: "2+"`, not as always-on `session_flow` /
`skill_framework`.

Brief-never-quiz rule: facts about the test itself (number of parts, timing,
examiner role, scoring mechanics) live in `tutor-briefing.md` as
TEACHING_INSTRUCTION material. The tutor uses these silently to run the format
and explains them in passing when relevant — the tutor **never** quizzes the
learner on them. Every question the tutor asks the learner is a real
conversational or examination question on the topic at hand, drawn from the
Part 1 / 2 / 3 question banks.

Paired exemplars: the model-answers doc (`ielts-speaking-model-answers.md`)
contains Band 5 vs Band 7 sample answers for the same question across Part 1,
Part 2, Part 3, and drill micro-examples. The tutor must surface a paired
exemplar ONLY when the learner asks "what does good look like?" or similar —
never unprompted. The tutor reads the Band 7 first, then the Band 5, then
names one concrete linguistic feature that lifts the higher tier.

I have 8 teaching documents to upload covering: course config + modules + outcomes
(course-ref.md), tutor briefing facts (tutor-briefing.md), assessor band
descriptors (assessor-rubric.md), learner phrase repertoire (language-toolkit),
three Part-specific question banks, and a paired Band 5 / Band 7 model-answers
exemplar set.
```

---

## Documents to upload (8 files)

Upload all files from `docs/external/ielts/ielts-speaking/Upload Docs/` during the wizard content step.

| # | File | Document Type | Classifier expects | What it provides |
|---|------|---------------|--------------------|-------------------|
| 1 | `course-ref.md` | COURSE_REFERENCE | Mixed | Master config (modulesAuthored: true, default mode: learner-picks), 4 authored modules + 8 OUT-NN outcomes, Socratic teaching approach, call flow (Call 2 onwards), **First Call — Special Rules** (session scope: 1), **Disclosure Schedule** (Calls 2–5), scoring rules, scaffolding techniques, L1 interference patterns, edge cases, brief-never-quiz rule |
| 2 | `tutor-briefing.md` | COURSE_REFERENCE | TEACHING_INSTRUCTION | Test format facts the tutor briefs the learner: 3-Part structure, timings (11–14 min total, Part 2 = 1 min prep + 1–2 min monologue), examiner role and constraints (what the examiner can / cannot do), question shapes the learner will meet across all 3 Parts. **Tutor briefs, never quizzes.** |
| 3 | `assessor-rubric.md` | COURSE_REFERENCE | ASSESSOR_RUBRIC | Band descriptors for the 4 criteria (FC, LR, GRA, P), Bands 0–9 verbatim. Scoring rules and tutor-delivery compression format. **Assessor-only — never quizzed, never an MCQ.** |
| 4 | `ielts-speaking-language-toolkit.md` | TEXTBOOK | Learner-facing | Phrase banks the learner deploys for Band 6→7→8: discourse markers, hedging, paraphrase, opinion, signposting, idiomatic chunks, collocations, conditional structures, pronunciation features. Tied to which criterion each lifts. |
| 5 | `ielts-speaking-question-bank-part1.md` | QUESTION_BANK | Practice prompts (Part 1 module) | 50+ Part 1 topic frames × 4–6 questions each — hometown, accommodation, work, study, family, free time, food, travel, weather, hobbies, music, sport, technology, books, weekend routines |
| 6 | `ielts-speaking-question-bank-part2.md` | QUESTION_BANK | Practice prompts (Part 2 module) | 88 Part 2 cue cards in the official 4-bullet form, clustered by frame (Person / Place / Object / Event / Experience / Activity) |
| 7 | `ielts-speaking-question-bank-part3.md` | QUESTION_BANK | Practice prompts (Part 3 module) | 64 Part 3 discussion sets × 4–6 abstract questions each. Organised by 13 themes. Linked to Part 2 topics. |
| 8 | `ielts-speaking-model-answers.md` | EXAMPLE | learner-facing | 38 paired Band 5 vs Band 7 sample answers across 19 questions (Part 1 × 6, Part 2 × 3, Part 3 × 6, drills × 4). Each pair carries a one-line "why Band 7 is stronger" annotation. Surfaced on learner request only. |

---

## Expected hierarchy after creation

```
IELTS Prep Lab (Institution)
  └─ IELTS (Domain)
       └─ IELTS Speaking (Subject)
            └─ IELTS Speaking Practice (Playbook)
                 ├─ Authored modules (modulesAuthored: true, mode: learner-picks)
                 │    1. Part 1: Familiar Topics       → OUT-01, OUT-02
                 │    2. Part 2: Long Turn (Cue Card)  → OUT-03, OUT-04, OUT-05
                 │    3. Part 3: Abstract Discussion   → OUT-06, OUT-07
                 │    4. Full Mock Exam                → OUT-01, OUT-03, OUT-06, OUT-08
                 └─ Curriculum (auto-generated, LOs auto-classified)
                      ├─ Learner-facing LOs   → drive practice + scoring
                      ├─ TEACHING_INSTRUCTION → tutor briefs silently, never quizzes
                      └─ ASSESSOR_RUBRIC      → scoring loop only, excluded from MCQs
```
