# IELTS Speaking Practice — Wizard Prompt

Paste this prompt into the V5 wizard chat. Upload the 7 docs from `Upload Docs/` when prompted.

> **Last refreshed:** 2026-05-18. Aligned with #417 per-skill scoring pipeline, #441/#442 banding UI tail, #447 rubric-projection guard, #448 eager `CallerTarget` placeholders, and #449 VAPI payload capture.

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

I have 7 teaching documents to upload covering: course config + modules + outcomes
(course-ref.md), tutor briefing facts (tutor-briefing.md), assessor band
descriptors (assessor-rubric.md), learner phrase repertoire (language-toolkit),
and three Part-specific question banks.
```

---

## Documents to upload (7 files)

Upload all files from `docs/external/ielts/ielts-speaking/Upload Docs/` during the wizard content step. The classifier resolves each file's `DocumentType` from the markdown front-matter / blockquote header — make sure the headers in each file haven't been edited.

| # | File | DocumentType (post-#385) | Classifier audience | What it provides |
|---|------|---------------|--------------------|-------------------|
| 1 | `course-ref.md` | `COURSE_REFERENCE_CANONICAL` | Mixed (learner + tutor) | Master config (modulesAuthored: true, default mode: learner-picks), 4 authored modules + 8 OUT-NN outcomes, **`## Skills Framework`** section with SKILL-01..SKILL-04 + Emerging/Developing/Secure tier descriptors, Socratic teaching approach, call flow (Call 2 onwards), **First Call — Special Rules** (session scope: 1), **Disclosure Schedule** (Calls 2–5), scoring rules, scaffolding techniques, L1 interference patterns, edge cases, brief-never-quiz rule |
| 2 | `tutor-briefing.md` | `COURSE_REFERENCE_TUTOR_BRIEFING` | Tutor-internal only | Test format facts the tutor briefs the learner: 3-Part structure, timings (11–14 min total, Part 2 = 1 min prep + 1–2 min monologue), examiner role and constraints (what the examiner can / cannot do), question shapes the learner will meet across all 3 Parts. **Tutor briefs, never quizzes.** |
| 3 | `assessor-rubric.md` | `COURSE_REFERENCE_ASSESSOR_RUBRIC` | Assessor + tutor-hidden | Band descriptors for the 4 criteria (FC, LR, GRA, P), Bands 0–9 verbatim. Scoring rules and tutor-delivery compression format. **Assessor-only — never quizzed, never an MCQ, never produces a learner-facing Goal** (see "Post-upload, expect" #6 below). |
| 4 | `ielts-speaking-language-toolkit.md` | `TEXTBOOK` | Learner-facing | Phrase banks the learner deploys for Band 6→7→8: discourse markers, hedging, paraphrase, opinion, signposting, idiomatic chunks, collocations, conditional structures, pronunciation features. Tied to which criterion each lifts. |
| 5 | `ielts-speaking-question-bank-part1.md` | `QUESTION_BANK` | Practice prompts (Part 1 module) | 50+ Part 1 topic frames × 4–6 questions each — hometown, accommodation, work, study, family, free time, food, travel, weather, hobbies, music, sport, technology, books, weekend routines |
| 6 | `ielts-speaking-question-bank-part2.md` | `QUESTION_BANK` | Practice prompts (Part 2 module) | 88 Part 2 cue cards in the official 4-bullet form, clustered by frame (Person / Place / Object / Event / Experience / Activity) |
| 7 | `ielts-speaking-question-bank-part3.md` | `QUESTION_BANK` | Practice prompts (Part 3 module) | 64 Part 3 discussion sets × 4–6 abstract questions each. Organised by 13 themes. Linked to Part 2 topics. |

> The legacy `COURSE_REFERENCE` type (un-suffixed) is kept for back-compat with older uploads; **new uploads land in one of the three subtypes above**. The classifier reads the `**Document type:** ...` blockquote header in each markdown.

---

## Post-upload, expect

After the wizard's `applyProjection` step completes (one transaction; idempotent on re-upload), the database carries the following derived state — none of it requires further action from the educator:

1. **4 `Parameter` rows** auto-created from `## Skills Framework`:
   `skill_fluency_and_coherence`, `skill_lexical_resource`, `skill_grammatical_range_and_accuracy`, `skill_pronunciation` — typed `BEHAVIOR`, sectionId `skill`.
2. **4 PLAYBOOK-scope `BehaviorTarget` rows** — one per skill, `targetValue` derived from each `### SKILL-NN`'s `**Target band:** N.N` line (band ÷ 10 — Band 7.0 → `0.70`, Band 6.5 → `0.65`). `skillRef: SKILL-01..SKILL-04`. Anchors the resolution chain `Goal.ref → BehaviorTarget.skillRef → parameterId → CallerTarget.currentScore`. **Absent `Target band:` line** falls back to `targetValue: 1.0` (Secure ceiling) for back-compat. The current upload set declares **`Band 7.0`** uniformly across all 4 skills (#462).
3. **1 per-playbook MEASURE spec** (`skill-measure-<playbookId-prefix>`) with 4 triggers — one per skill — wired to the pipeline via a `PlaybookItem` link. Runs end-of-call to score each criterion against the rubric tiers.
4. **`Playbook.config.goals[]`** — **12 goal templates** total:
   - **4 ACHIEVE templates** (one per skill) with `isAssessmentTarget: true`, `ref: SKILL-NN`. Goal name embeds the declared Target band — e.g. `"Reach Band 7.0 on Fluency and Coherence"` (was `"Reach Secure on …"` before the Target band parser landed). Falls back to `"Reach Secure on …"` when no Target band declared.
   - **8 LEARN templates** (one per OUT-NN outcome), `ref: OUT-NN`
5. **Curriculum + 4 `CurriculumModule` rows** (`baseline`, `part1`, `part2`, `part3` — stable slugs, never regenerated on republish) + `LearningObjective` rows derived from each module's `outcomesPrimary` × the doc-level outcome dictionary. Module slugs `baseline`/`part1`/`part2`/`part3` are load-bearing for learner progress + dashboard rollups.
6. **`COURSE_REFERENCE_ASSESSOR_RUBRIC` is excluded from goal projection** (#447, 2026-05-18). Bullet points / band descriptors inside the rubric document will NOT generate Goal rows. The wizard also rejects AI-emitted rubric prose as learning outcomes — phantom goals from earlier uploads can be cleaned up with the `scripts/cleanup-rubric-goals.ts` script.

When a learner is then enrolled (any path — `/x/callers` POST, V5 wizard `+ New test learner`, `course-setup`, `create-test-learner`):

7. **`instantiatePlaybookGoals`** produces 12 `Goal` rows on the caller (4 ACHIEVE + 8 LEARN), with `ref` and `sourceContentId` propagated for progress derivation (#413).
8. **`instantiatePlaybookTargets`** (#448, 2026-05-18) pre-creates 4 `CallerTarget` placeholder rows with `currentScore: null`, `callsUsed: 0`, `targetValue` copied verbatim from each PLAYBOOK BehaviorTarget. The educator Progress tab renders these as "Awaiting evidence" from day 1 — no longer waits for call #1 to populate.

Per-call:

9. **Each end-of-call run** of the per-playbook MEASURE spec writes a `CallScore` per skill. `aggregate-runner.ts` folds these via EMA into `CallerTarget.currentScore`. Once `callsUsed > 0 && currentScore != null`, the SKILL-NN ACHIEVE goal's `measurementStatus` flips from `awaiting_evidence` → `measured` and the educator caller-detail UI surfaces a band-labelled `<BandChip>` (#441 / #442) instead of "Awaiting evidence".

VAPI runtime (no upload involved):

10. **VAPI `end-of-call-report`** (configured in your VAPI assistant's `serverUrl`) now persists 8 fields on the `Call` row when sent: `recordingUrl`, `stereoRecordingUrl`, `vapiDurationSeconds`, `vapiEndedReason`, `vapiCostUsd`, `vapiAnalysisSummary`, `vapiStructuredData`, `vapiSuccessEvaluation` (#449, 2026-05-18). These are read from `message.artifact.*` + `message.analysis.*` with per-field type guards; presence depends on your VAPI assistant's analysis-plan config (`summaryPrompt` / `structuredDataPrompt` / `successEvaluationPrompt`). **No consumer reads these yet** — Phase 0 capture only, ready for AssemblyAI / voice-analysis Phase 1+ (see `apps/admin/docs/PLAN-voice-analysis.md`).

---

## Expected hierarchy after creation

```
IELTS Prep Lab (Institution)
  └─ IELTS (Domain)
       └─ IELTS Speaking (Subject)
            └─ IELTS Speaking Practice (Playbook, status: PUBLISHED)
                 │
                 ├─ Authored modules (modulesAuthored: true, mode: learner-picks)
                 │    1. Part 1: Familiar Topics       → OUT-01, OUT-02
                 │    2. Part 2: Long Turn (Cue Card)  → OUT-03, OUT-04, OUT-05
                 │    3. Part 3: Abstract Discussion   → OUT-06, OUT-07
                 │    4. Full Mock Exam                → OUT-01, OUT-03, OUT-06, OUT-08
                 │
                 ├─ Skills Framework projection (#417)
                 │    Parameters (BEHAVIOR, sectionId=skill)
                 │      skill_fluency_and_coherence
                 │      skill_lexical_resource
                 │      skill_grammatical_range_and_accuracy
                 │      skill_pronunciation
                 │    BehaviorTargets (scope: PLAYBOOK, targetValue: 1.0)
                 │      skillRef: SKILL-01..SKILL-04
                 │    MEASURE spec (slug: skill-measure-<playbookId-prefix>)
                 │      4 triggers — one per skill, scores rubric tiers
                 │
                 ├─ playbook.config.goals[]  (12 templates total)
                 │    4 ACHIEVE (ref: SKILL-NN, isAssessmentTarget: true)
                 │    8 LEARN   (ref: OUT-NN)
                 │
                 └─ Curriculum (auto-generated, LOs auto-classified)
                      ├─ Learner-facing LOs   → drive practice + scoring
                      ├─ TEACHING_INSTRUCTION → tutor briefs silently, never quizzes
                      └─ ASSESSOR_RUBRIC      → scoring loop only, excluded from
                                                MCQs AND from Goal projection (#447)

Per-learner (on enrolment):
  Caller
    ├─ Goal rows × 12   (instantiatePlaybookGoals — copies ref + sourceContentId)
    └─ CallerTarget × 4  (instantiatePlaybookTargets, #448 — placeholders
                          currentScore: null, callsUsed: 0,
                          targetValue from PLAYBOOK BehaviorTarget)

Per-call (each VAPI session):
  Call
    ├─ vapiAnalysisSummary, vapiStructuredData, recordingUrl, etc.  (#449)
    ├─ Transcript → MEASURE spec → CallScore × 4 (one per skill)
    └─ aggregate-runner EMA → CallerTarget.currentScore
       → ACHIEVE Goal measurementStatus flips to "measured"
       → <BandChip> tier label renders on Progress tab (#441/#442)
```

---

## Re-upload safety

`applyProjection` is **idempotent**. Re-uploading the same 7 files produces zero net DB mutations beyond `updatedAt` bumps. Goal templates derived from this source (tagged with `sourceContentId`) are replaced wholesale; hand-authored or wizard-side goals (no `sourceContentId`) are preserved.

If the rubric document was uploaded before #447 and produced phantom Goal rows, run `tsx apps/admin/scripts/cleanup-rubric-goals.ts` post-merge to clear them.

---

## Where this gets verified

- **Wizard fixture parsing**: `apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-v2.2.md` (long-form) + `apps/admin/tests/fixtures/course-reference-ielts-v2.2.md` (compact seed). Both are unit-tested.
- **Projection pipeline**: `apps/admin/lib/wizard/__tests__/project-course-reference.test.ts` + `apply-projection.test.ts`.
- **Goal instantiation**: `apps/admin/tests/lib/instantiate-goals.test.ts`.
- **CallerTarget eager-create**: `apps/admin/tests/lib/instantiate-targets.test.ts` (8 tests).
- **VAPI payload extractor**: `apps/admin/tests/lib/vapi-extract-capture.test.ts` (18 tests).
- **End-to-end smoke**: `npm run seed:ielts` on hf-dev seeds the equivalent state without going through the wizard chat — useful for verifying derived rows independent of the upload UI.
