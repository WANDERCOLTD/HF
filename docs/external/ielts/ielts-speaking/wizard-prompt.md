# IELTS Speaking Practice — Wizard Prompt

Paste the block below into the V5 wizard chat. Upload the 8 docs from
`Upload Docs/` when prompted.

> **Last refreshed:** 2026-06-18. Aligned with: **#1932 S0 — Template v5.1 + topicPool end-to-end** (course-ref now declares `hf-template-version: "5.1"` front-matter, 14 Sources, per-module YAML settings blocks via #1902/P3e parser, source-ref resolution via #1905/P3f + #1913/multi-route + #1961/P3g, source-derived skill banding #1630, fixture↔type bidirectional gate #1937/#1910 S1, orientation latch #1730/#1921, voice cue scheduler #1839 Theme 2b). Replaces the v2.2-era prompt that referenced 4 modules + 8 outcomes.

See [`a-sample-docs/course-reference-template.md`](../../../a-sample-docs/course-reference-template.md) (now v5.1) for the canonical template and [`apps/admin/lib/wizard/course-ref-template-schema.ts`](../../../apps/admin/lib/wizard/course-ref-template-schema.ts) for the machine-readable schema export (epic #1931 — Course-Ref Template Authority).

---

## Wizard prompt (paste this; nothing more)

The teaching rules, Call 1 special behaviour, skill descriptors, brief-never-quiz policy, disclosure schedule, per-module settings, and source-ref linkage are ALREADY DECLARED in `course-ref.md` and get projected automatically. Do not paste them here.

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

Teaching approach: directive primary, with adaptive Socratic shift on the three
documented triggers (student resistance, strong self-diagnostic ability, explicit
request). The student does most of the talking; the tutor names problems,
corrects, and asks for retry.

Calls: soft cap ~12 × 15–25 minutes per call.
Coverage: depth — fewer outcomes mastered thoroughly, rather than broad surface.
Assessment style: criterion-referenced — track band scores per criterion (FC, LR,
GRA, Pron) at Baseline + every Mock Exam.

courseStyle: structured
examShape: exam   (enables cueCardPool / scheduledCues / examiner-mode silence)

progressionMode: learner-picks — the learner picks one of 5 modules at the start
of each call (Baseline, Part 1, Part 2, Part 3, Mock Exam). The 27 OUT-NN
outcomes spanning Foundation (01–12) / Criterion Refinement (13–24) / Exam
Readiness (25–27) are authored in course-ref.md across modules.

DO NOT call update_setup with `progressionMode`, `modulesAuthored`, or
`constraints` — `progressionMode` is chip-click only (wizard must call
show_options with dataKey="progressionMode"); the other two are rejected at
the tool layer. All teaching rules (First Call Special Rules, Disclosure
Schedule, Brief-Never-Quiz, voice rules, session-scope overrides, per-module
settings YAML blocks, Content Sources registry) live in course-ref.md and
project automatically — do not re-state them.

I have 8 teaching documents to upload covering: course config + 5 modules + 27
outcomes (course-ref.md, with `hf-template-version: "5.1"` and
`hf-scoring-mode: evidence-first` declared), tutor briefing facts
(tutor-briefing.md), assessor band descriptors (assessor-rubric.md), learner
phrase repertoire (language-toolkit), three Part-specific question banks, and
the Baseline profile fields source.
```

---

## Documents to upload (8 files)

Upload all files from `docs/external/ielts/ielts-speaking/Upload Docs/` during the wizard content step. The classifier resolves each file's `DocumentType` from the markdown front-matter / blockquote header — do not edit the headers.

| # | File | DocumentType | Classifier audience | What it provides |
|---|------|---|---|---|
| 1 | `course-ref.md` | `COURSE_REFERENCE_CANONICAL` | Mixed (learner + tutor) | Master config (`hf-template-version: "5.1"`, modulesAuthored: true, default mode: learner-picks, `courseStyle: structured`, `examShape: exam`), **5 authored modules** (baseline / part1 / part2 / part3 / mock) + **27 OUT-NN outcomes**, `## Skills Framework` SKILL-01..SKILL-04 with Emerging/Developing/Secure tiers + `Target band: 7.0`, Directive→Socratic teaching approach, call flow (Call 2 onwards), **First Call — Special Rules** (session scope: 1), **Disclosure Schedule** (Calls 2–5), per-module YAML settings blocks (cueCardPool / topicPool / scaffoldPool / scheduledCues / firstTimeOrientationLine / closingLine / minSpeakingSec / questionTarget / profileFieldsToCapture), Content Sources registry (14 entries with location/format/moduleRef/settingRef metadata), edge cases, brief-never-quiz rule |
| 2 | `tutor-briefing.md` | `COURSE_REFERENCE_TUTOR_BRIEFING` | Tutor-internal only | Test format facts the tutor briefs the learner: 3-Part structure, timings (11–14 min total, Part 2 = 1 min prep + 1–2 min monologue), examiner role and constraints, question shapes across all 3 Parts. **Tutor briefs, never quizzes.** |
| 3 | `assessor-rubric.md` | `COURSE_REFERENCE_ASSESSOR_RUBRIC` | Assessor + tutor-hidden | Band descriptors for the 4 criteria (FC, LR, GRA, Pron), Bands 0–9 verbatim. Scoring rules + tutor-delivery compression. **Assessor-only — never quizzed, never MCQ, never produces a learner-facing Goal** (#447). |
| 4 | `ielts-speaking-language-toolkit.md` | `TEXTBOOK` | Learner-facing | Phrase banks the learner deploys for Band 6→7→8: discourse markers, hedging, paraphrase, opinion, signposting, idiomatic chunks, collocations, conditional structures, pronunciation features. |
| 5 | `ielts-speaking-question-bank-part1.md` | `QUESTION_BANK` | Practice prompts (Part 1 module — Source 1) | Part 1 topic frames × questions each — hometown, work, study, family, free time, food, travel, weather, hobbies. **Resolves into `part1.topicPool` (52 topics)** via `resolve-module-source-refs.ts`. |
| 6 | `ielts-speaking-question-bank-part2.md` | `QUESTION_BANK` | Practice prompts (Part 2 module — Source 2/9/10) | 88 Part 2 cue cards in the official 4-bullet form, clustered by frame (Person / Place / Object / Event / Experience / Activity). **Resolves into `part2.cueCardPool` + `baseline.cueCardPool` + `mock.cueCardPool` (88 cards each)** via multi-route Sources 2 / 9 / 10 (#1913). |
| 7 | `ielts-speaking-question-bank-part3.md` | `QUESTION_BANK` | Practice prompts (Part 3 module — Source 3) | Part 3 theme library × abstract questions each, linked to Part 2 topics. **Resolves into `part3.topicPool` (64 themes)** via `resolve-module-source-refs.ts`. |
| 8 | `ielts-speaking-profile-fields.md` | `COURSE_REFERENCE_PROFILE_FIELDS` | Tutor-internal (Baseline only — Source 14) | Conversational profile fields the tutor weaves into the Baseline warm-up. Each entry: verbatim prompt + coercion type (text / number / band). **Resolves into `baseline.profileFieldsToCapture` (4 fields)** via #1961/P3g resolver. Written end-of-session to `CallerAttribute` under `profile:*` namespace. |

> The 3 stall-scaffold + band-descriptors files referenced by Sources 6 / 7 / 8 / 11 / 12 / 13 live at the **parent directory** (`docs/external/ielts/ielts-speaking/`), NOT in `Upload Docs/`. They are projection-time reference material (`resolve-module-source-refs.ts` reads them at backfill / wizard-projection time), not operator-upload files. Sources 4 + 5 (Baseline + Mock topic pools) are conceptual — they reuse Sources 1/2/3 at the resolver level.

---

## Post-upload, expect

After the wizard's `applyProjection` step completes (one transaction; idempotent on re-upload), the database carries the following derived state — none of it requires further action from the educator:

1. **4 `Parameter` rows** auto-created from `## Skills Framework`:
   `skill_fluency_and_coherence`, `skill_lexical_resource`, `skill_grammatical_range_and_accuracy`, `skill_pronunciation` — typed `BEHAVIOR`, sectionId `skill`.

2. **4 PLAYBOOK-scope `BehaviorTarget` rows** — one per skill, `targetValue: 0.70` (Band 7.0 ÷ 10) derived from each `### SKILL-NN`'s `**Target band:** 7.0` line. `skillRef: SKILL-01..SKILL-04`. **Skill tier mapping derived from Source 8 band descriptors** via `lib/banding/derive-skill-tier-mapping-from-source.ts` (#1630) — Foundation / Developing / Practitioner / Distinction tiers map to IELTS Bands 1–9.

3. **1 per-playbook MEASURE spec** (`skill-measure-<playbookId-prefix>`) with 4 triggers — one per skill — wired to the pipeline via a `PlaybookItem` link. Runs end-of-call to score each criterion against the rubric tiers.

4. **`Playbook.config.goals[]`** — **31 goal templates** total:
   - **4 ACHIEVE templates** (one per skill) with `isAssessmentTarget: true`, `ref: SKILL-NN`. Goal name embeds the declared Target band: `"Reach Band 7.0 on Fluency and Coherence"` etc.
   - **27 LEARN templates** (one per OUT-NN outcome — Foundation OUT-01..OUT-12, Criterion Refinement OUT-13..OUT-24, Exam Readiness OUT-25..OUT-27), `ref: OUT-NN`

5. **Curriculum + 5 `CurriculumModule` rows** (`baseline`, `part1`, `part2`, `part3`, `mock` — stable slugs, never regenerated on republish) + **42 `LearningObjective` instances** (27 unique refs) derived from each module's `outcomesPrimary`:
   - `baseline` (3 LOs): OUT-01, OUT-02, OUT-04
   - `part1` (6 LOs): OUT-01, OUT-02, OUT-05, OUT-06, OUT-07, OUT-24
   - `part2` (11 LOs): OUT-04, OUT-05, OUT-07–12, OUT-18, OUT-22, OUT-23
   - `part3` (11 LOs): OUT-03, OUT-06, OUT-08, OUT-13–17, OUT-19–21
   - `mock` (11 LOs): OUT-01–08, OUT-25, OUT-26, OUT-27

6. **Per-module settings populated via source-ref resolution** (run `npx tsx apps/admin/scripts/backfill-module-settings-from-course-ref.ts --course-ref <path> --playbook-id <id>` after wizard projection):
   - `baseline.cueCardPool` (88 cards · Source 10 → Source 2 content)
   - `baseline.scaffoldPool` (14 scaffolds · Source 11 → Source 6 content)
   - `baseline.profileFieldsToCapture` (4 fields · Source 14)
   - `part1.topicPool` (52 topics · Source 1)
   - `part1.scaffoldPool` (15 scaffolds · Source 13 → Source 7 content)
   - `part2.cueCardPool` (88 cards · Source 2)
   - `part2.scaffoldPool` (14 scaffolds · Source 6)
   - `part3.topicPool` (64 themes · Source 3)
   - `part3.scaffoldPool` (15 scaffolds · Source 7)
   - `mock.cueCardPool` (88 cards · Source 9 → Source 2 content)
   - `mock.scaffoldPool` (14 scaffolds · Source 12 → Source 6 content)

7. **`COURSE_REFERENCE_ASSESSOR_RUBRIC` is excluded from goal projection** (#447, 2026-05-18). Bullet points / band descriptors inside the rubric document will NOT generate Goal rows. Phantom goals from earlier uploads can be cleaned up with `scripts/cleanup-rubric-projected-goals.ts`.

When a learner is then enrolled (any path — `/x/callers` POST, V5 wizard `+ New test learner`, `course-setup`, `create-test-learner`):

8. **`instantiatePlaybookGoals`** produces 31 `Goal` rows on the caller (4 ACHIEVE + 27 LEARN), with `ref` and `sourceContentId` propagated for progress derivation (#413).

9. **`instantiatePlaybookTargets`** (#448) pre-creates 4 `CallerTarget` placeholder rows with `currentScore: null`, `callsUsed: 0`, `targetValue` copied verbatim from each PLAYBOOK BehaviorTarget. The educator Progress tab renders these as "Awaiting evidence" from day 1 — no longer waits for call #1 to populate.

Per-call:

10. **Each end-of-call run** of the per-playbook MEASURE spec writes a `CallScore` per skill. `aggregate-runner.ts` folds these via EMA into `CallerTarget.currentScore`. Once `callsUsed > 0 && currentScore != null`, the SKILL-NN ACHIEVE goal's `measurementStatus` flips from `awaiting_evidence` → `measured` and the educator caller-detail UI surfaces a band-labelled `<BandChip>` (#441 / #442).

11. **First-time orientation latch** (#1730 Story D / PR #1921, merged 2026-06-18): on the first call where a module's `settings.firstTimeOrientationLine` is rendered, `endSession` writes `CallerModuleProgress.orientationShown = true` so the line fires once per (caller, module) — not every call.

VAPI runtime (no upload involved):

12. **VAPI `end-of-call-report`** persists 8 fields on the `Call` row when sent: `recordingUrl`, `stereoRecordingUrl`, `vapiDurationSeconds`, `vapiEndedReason`, `vapiCostUsd`, `vapiAnalysisSummary`, `vapiStructuredData`, `vapiSuccessEvaluation` (#449). Presence depends on your VAPI assistant's analysis-plan config.

13. **Voice cue scheduler** (#1839 Theme 2b): per-module `scheduledCues` from course-ref's settings YAML blocks are wired to `lib/voice/register-module-cues.ts` — fires `sayMessage` cues mid-call (e.g. Part 2 "your 60s prep starts now" + "your 2 minutes starts now").

---

## Expected hierarchy after creation

```
IELTS Prep Lab (Institution)
  └─ IELTS (Domain)
       └─ IELTS Speaking (Subject)
            └─ IELTS Speaking Practice (Playbook, status: PUBLISHED)
                 │
                 ├─ Authored modules (modulesAuthored: true, mode: learner-picks)
                 │    0. Baseline Assessment          → samples across (OUT-01, 02, 04)
                 │    1. Part 1: Familiar Topics      → topic discipline + extension
                 │    2. Part 2: Long Turn (Cue Card) → cue-card monologue + bullets
                 │    3. Part 3: Abstract Discussion  → 7 question types + extension
                 │    4. Full Mock Exam               → all OUT-NN + exam-readiness 25/26/27
                 │
                 ├─ Per-module settings (from course-ref YAML blocks + source-ref resolution)
                 │    cueCardPool · topicPool · scaffoldPool · scheduledCues ·
                 │    firstTimeOrientationLine · closingLine · minSpeakingSec ·
                 │    questionTarget · profileFieldsToCapture (baseline only)
                 │
                 ├─ Skills Framework projection (#417 + #1630)
                 │    Parameters (BEHAVIOR, sectionId=skill) × 4
                 │    BehaviorTargets (scope: PLAYBOOK, targetValue: 0.70)
                 │      skillRef: SKILL-01..SKILL-04
                 │    Skill tier mapping derived from Source 8 band descriptors
                 │    MEASURE spec (slug: skill-measure-<playbookId-prefix>)
                 │      4 triggers — one per skill, scores rubric tiers
                 │
                 ├─ playbook.config.goals[]  (31 templates total)
                 │    4 ACHIEVE (ref: SKILL-NN, isAssessmentTarget: true)
                 │    27 LEARN  (ref: OUT-NN — Foundation 01–12, Refinement 13–24,
                 │                            Exam Readiness 25–27)
                 │
                 └─ Curriculum (5 CurriculumModule rows, 42 LO instances, 27 unique refs)
                      ├─ Learner-facing LOs   → drive practice + scoring
                      ├─ TEACHING_INSTRUCTION → tutor briefs silently, never quizzes
                      └─ ASSESSOR_RUBRIC      → scoring loop only, excluded from
                                                MCQs AND from Goal projection (#447)

Per-learner (on enrolment):
  Caller
    ├─ Goal rows × 31    (instantiatePlaybookGoals — copies ref + sourceContentId)
    └─ CallerTarget × 4  (instantiatePlaybookTargets, #448 — placeholders
                          currentScore: null, callsUsed: 0,
                          targetValue from PLAYBOOK BehaviorTarget)

Per-call (each VAPI session):
  Call
    ├─ vapiAnalysisSummary, vapiStructuredData, recordingUrl, etc.  (#449)
    ├─ Transcript → MEASURE spec → CallScore × 4 (one per skill)
    ├─ aggregate-runner EMA → CallerTarget.currentScore
    │   → ACHIEVE Goal measurementStatus flips to "measured"
    │   → <BandChip> tier label renders on Progress tab (#441/#442)
    └─ First call with orientationLine fired: orientationShown = true (#1730)
```

---

## Re-upload safety

`applyProjection` is **idempotent**. Re-uploading the same 8 files produces zero net DB mutations beyond `updatedAt` bumps. Goal templates derived from this source (tagged with `sourceContentId`) are replaced wholesale; hand-authored or wizard-side goals (no `sourceContentId`) are preserved.

If the rubric document was uploaded before #447 and produced phantom Goal rows, run `tsx apps/admin/scripts/cleanup-rubric-projected-goals.ts` post-merge to clear them.

---

## Backfill source-refs (post-upload, before first call)

After the wizard projection completes, the per-module settings YAML blocks land in `Playbook.config.modules[].settings.*` but the `source:*` references (`cueCardPool: source:cue-card-bank-v1` etc.) are NOT auto-resolved by the wizard. Run the backfill script to inline them:

```
cd apps/admin
npx tsx scripts/backfill-module-settings-from-course-ref.ts \
  --course-ref docs/external/ielts/ielts-speaking/Upload\ Docs/course-ref.md \
  --playbook-id <playbookId>
```

Expected output: `WROTE: N setting(s) added across M module(s). composeInputsUpdatedAt bumped.` with 11 source-ref resolutions across 5 modules (52 + 64 topics, 88 × 3 cards, 14/15 × 5 scaffold pools, 4 profile fields).

If re-uploading the same docs, manual edits via the Module Inspector are preserved via `mergeModuleSettings` per-key — wizard re-projection wins for unset keys only.

---

## Where this gets verified

- **Wizard fixture parsing**: `apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-v2.3.md` + `course-reference-ielts-v2.2.md` (regression baseline). Both unit-tested at `lib/wizard/__tests__/detect-authored-modules.test.ts` + `detect-module-settings.test.ts` (#1902).
- **Source-ref resolution**: `lib/wizard/__tests__/resolve-module-source-refs.test.ts` (#1905 + #1913 multi-route + #1961 P3g + #1932 topicPool).
- **Projection pipeline**: `lib/wizard/__tests__/project-course-reference.test.ts` + `apply-projection.test.ts` + `run-projection-for-playbook.test.ts`.
- **Skills banding derivation from Source 8**: `tests/lib/banding/derive-skill-tier-mapping-from-source.test.ts` (#1630).
- **Goal instantiation**: `apps/admin/tests/lib/instantiate-goals.test.ts`.
- **CallerTarget eager-create**: `apps/admin/tests/lib/instantiate-targets.test.ts`.
- **Orientation latch**: `tests/lib/curriculum/mark-orientation-shown.test.ts` (#1730 Story D / PR #1921).
- **Voice cue scheduler**: `tests/lib/voice/register-module-cues.test.ts` (#1839 Theme 2b).
- **VAPI payload extractor**: `apps/admin/tests/lib/vapi-extract-capture.test.ts`.
- **Fixture↔type bidirectional gate**: `tests/lib/journey/fixture-type-coverage.test.ts` (#1937 / #1910 S1).
- **Template ↔ system conformance (S1 — pending)**: epic #1931 child #1933 once the conformance validator ships, every upload will be checked against the v5.x schema export. Until then, manual review.
- **End-to-end smoke**: `npm run seed:ielts` on hf-dev seeds the equivalent state without going through the wizard chat.
