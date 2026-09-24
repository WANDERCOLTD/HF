# CIO/CTO Standard — Wizard Prompt (3 variants)

Paste **one of the three blocks below** into the V5 wizard chat — one per variant — and upload the matching single course-ref file when prompted.

> **Last refreshed:** 2026-06-18. Aligned with Course Reference Template v5.1 (epic #1931).
>
> **Per-variant note:** the three CIO/CTO courses share the same 5 Units (04 / 09 / 10 / 16 / 21) and the same 26 Learning Objectives. They differ in **layer** (recall vs scenario judgement) and **persona** (curious quizmaster vs careful tutor vs board-chair examiner). Today's variant differentiation is via `BEH-*` persona parameters + `welcomeMessage` — see memory `project_stable_dev_environment_2026_06_18.md`.

---

## Variant 1 — Pop Quiz (recall layer)

```
I'm setting up The CIO/CTO Standard — Pop Quiz.

Institution: FC Academy
Type: Professional qualification prep
Subject: IT Leadership — The CIO/CTO Standard (SIAS / Ofqual V6.0)
Course name: The CIO/CTO Standard — Pop Quiz
Audience: working-IT-professional

The learners are IT leaders preparing for the SIAS-accredited CIO/CTO Standard
qualification. Pop Quiz covers the same five Units as Revision Aid and Exam
Assessment — 04 (Operations), 09 (Architecture), 10 (App Dev), 16 (Data),
21 (Strategic Planning) — but tests at the recall and definition layer, not
the scenario layer.

Teaching approach: quizmaster — quick-fire definition questions with rapid
feedback. No long Socratic dialogues; the tutor names the term, asks for the
definition, confirms or corrects, moves on.

Calls: short focused calls; cap soft.
Coverage: breadth — all 26 LOs reachable but at recall layer.
Assessment style: pass/fail per LO via recall accuracy.

courseStyle: structured

progressionMode: ai-led — the tutor sequences LOs adaptively based on which
the learner has missed.

DO NOT call update_setup with `progressionMode`, `modulesAuthored`, or
`constraints`. Persona differentiation (quizmaster voice, fast tempo, definition
focus) lives in the course-ref's `BEH-*` parameters.

I have 1 teaching document to upload: cio-cto-standard-pop-quiz.course-ref.md
(with `hf-template-version: "5.1"` declared), covering 5 Units + 26 LOs in
OUT-NN-MM format (Unit-LO two-tier).
```

**Upload:** `cio-cto-standard-pop-quiz.course-ref.md` (1 file).

---

## Variant 2 — Revision Aid (Foundation + Practitioner tiers)

```
I'm setting up The CIO/CTO Standard — Revision Aid.

Institution: FC Academy
Type: Professional qualification prep
Subject: IT Leadership — The CIO/CTO Standard (SIAS / Ofqual V6.0), Foundation & Practitioner tiers
Course name: The CIO/CTO Standard — Revision Aid
Audience: working-IT-professional

Same 5 Units, same 26 LOs as Pop Quiz and Exam Assessment, but Revision Aid
runs at the Foundation + Practitioner tier — the tutor checks recall, then
walks the learner through scenario coaching at the Practitioner tier with
worked examples and per-unit progression.

Teaching approach: careful tutor — Socratic on scenarios, directive on
definitions. The tutor uses the LO's Foundation tier as the recall layer and
the Practitioner tier as the scenario judgement layer.

Calls: longer, structured per Unit.
Coverage: depth per Unit; learner can revisit any Unit.
Assessment style: criterion-referenced via Foundation + Practitioner tier
checkpoints.

courseStyle: structured

progressionMode: ai-led — Unit sequencing follows the standard's prerequisite
chain (04 → 09 → 10 → 16 → 21 in the typical journey).

DO NOT call update_setup with `progressionMode`, `modulesAuthored`, or
`constraints`. Persona differentiation (tutor voice, tier-aware scaffolding)
lives in the course-ref's `BEH-*` parameters.

I have 1 teaching document to upload: cio-cto-standard-revision-aid.course-ref.md
(with `hf-template-version: "5.1"` declared), covering 5 Units + 26 LOs in
OUT-NN-MM format.
```

**Upload:** `cio-cto-standard-revision-aid.course-ref.md` (1 file).

---

## Variant 3 — Exam Assessment (Practitioner-tier mock)

```
I'm setting up The CIO/CTO Standard — Exam Assessment.

Institution: FC Academy
Type: Professional qualification prep
Subject: IT Leadership — The CIO/CTO Standard (SIAS / Ofqual V6.0), Practitioner-tier mock assessment
Course name: The CIO/CTO Standard — Exam Assessment
Audience: working-IT-professional

Exam Assessment is the **mock assessment vehicle** — same five Units as
Revision Aid and Pop Quiz, same 26 LOs, but a Practitioner-tier judgement
test under board-chair framing. The tutor plays a board-chair examiner role
and runs scenario-based judgement questions; the learner answers in real
time as if in the actual SIAS Practitioner-tier assessment.

Teaching approach: examiner — formal, no scaffolding during questions, full
debrief at the end of each scenario. The tutor mirrors the actual SIAS exam
format and pacing.

Calls: longer (~30-40 min) — mirrors actual exam timing.
Coverage: depth per scenario; full 26-LO sweep across the assessment.
Assessment style: criterion-referenced via Practitioner-tier scoring rubric.

courseStyle: structured
examShape: exam   (enables examiner-mode silence + scoring)

progressionMode: ai-led — examiner sequences scenarios from the SIAS canonical
question pool.

DO NOT call update_setup with `progressionMode`, `modulesAuthored`, or
`constraints`. Persona differentiation (board-chair voice, examiner-mode
silence, no mid-scenario hints) lives in the course-ref's `BEH-*` parameters.

I have 1 teaching document to upload: cio-cto-standard-exam-assessment.course-ref.md
(with `hf-template-version: "5.1"` declared), covering 5 Units + 26 LOs in
OUT-NN-MM format under Practitioner-tier scenario judgement.
```

**Upload:** `cio-cto-standard-exam-assessment.course-ref.md` (1 file).

---

## Post-upload, expect (all 3 variants)

After the wizard's `applyProjection` step:

1. **Curriculum + 5 `CurriculumModule` rows** (Unit 04 / 09 / 10 / 16 / 21 — stable slugs).
2. **26 `LearningObjective` rows** projected per `outcomesPrimary` × OUT-NN-MM dictionary (Unit-LO two-tier format).
3. **No SKILL-NN auto-projection** today — the CIO/CTO docs use `## Skills Framework` for 10 cross-cutting skills but don't yet use the `### SKILL-NN` numbered notation. ACHIEVE goals are NOT auto-created from skills. **This is the variant-differentiation gap noted in memory** — the 3 variants today differentiate via `BEH-*` persona parameters + `welcomeMessage` only.
4. **`Playbook.config.goals[]`** — **26 LEARN templates** (one per OUT-NN-MM outcome), `ref: OUT-NN-MM`. No ACHIEVE templates (no SKILL-NN auto-projection — see above).
5. **No source-ref backfill required** — these courses don't use exam-prep settings (no cueCardPool / topicPool / scaffoldPool).

When a learner enrols:

6. **`instantiatePlaybookGoals`** produces 26 `Goal` rows per variant (all LEARN, no ACHIEVE).
7. **No `CallerTarget` placeholders** for these variants (no SKILL-NN → no BehaviorTarget projection).

Per-call:

8. Pop Quiz / Revision Aid / Exam Assessment differ in tutor persona (`BEH-*` parameters) and welcomeMessage — runtime behaviour is shaped by these, not by separate skill scoring.

---

## Known gap (variant differentiation tracked elsewhere)

Per memory file `project_stable_dev_environment_2026_06_18.md`: "CIO/CTO variant differentiation today is BEH-* persona + welcomeMessage only — true Pop Quiz / Exam mechanics need follow-on stories." Specifically:
- Pop Quiz needs a recall-only scoring loop (different from Revision Aid's tier-aware scoring)
- Exam Assessment needs Practitioner-tier scenario rubric + board-chair examiner silence rules
- Revision Aid needs Foundation→Practitioner tier-progression UI hints

These are follow-on stories, not today's wizard-prompt scope.

---

## Re-upload safety

`applyProjection` is idempotent. Re-uploading any variant produces zero net mutations beyond `updatedAt` bumps.

---

## Where this gets verified

- `apps/admin/lib/wizard/__tests__/project-course-reference.test.ts` + `apply-projection.test.ts`
- `apps/admin/tests/lib/instantiate-goals.test.ts` — Goal row instantiation for LEARN-only courses
- End-to-end: manual wizard chat per variant
