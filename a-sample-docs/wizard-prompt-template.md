# Wizard Prompt Template

Paste this template into the V5 wizard chat (`/x/get-started-v5`). Fill in
the bracketed `[example]` fields with your course's specifics. Upload the
documents listed in the "Files to upload" section.

> **Last refreshed:** 2026-05-21 (post-#581 evidence-first auto-detect)

---

## Why this template exists

The wizard chat reads the markdown you upload and projects it into the DB.
Most teaching rules — Call 1 special behaviour, skill descriptors, rubric
bands, brief-never-quiz policies — live INSIDE `course-ref.md` and get
projected automatically. **Don't repeat them in the prompt block** —
duplication tempts you to drift the two copies apart.

The chat prompt does five things and only five things:
1. Names the institution / course
2. Names the audience and target band
3. Picks the teaching approach (one of nine enums)
4. Declares progression mode (chip-click only — see below)
5. Lists the files you're about to upload

Everything else is in the documents.

---

## MANDATORY fields (the wizard will not finish setup without these)

| Field | Allowed values | Where the wizard learns it |
|---|---|---|
| `Institution name` | free text | this prompt |
| `Course name` | free text | this prompt OR `course-ref.md` |
| `Subject discipline` | free text | this prompt OR `course-ref.md` |
| `audience` | `primary` \| `secondary` \| `sixth-form` \| `higher-ed` \| `adult-professional` \| `adult-casual` \| `mixed` | this prompt OR `course-ref.md` |
| `interactionPattern` (teaching approach) | `socratic` \| `directive` \| `advisory` \| `coaching` \| `companion` \| `facilitation` \| `reflective` \| `open` \| `conversational-guide` | this prompt OR `course-ref.md` |
| `progressionMode` | `learner-picks` \| `ai-led` | **Chip-click only**, never via prompt text — wizard surfaces a 2-option picker |
| `welcomeFlow` (4 keys) | bool × 4 (Goals / About You / Knowledge Check / AI Intro) | Wizard prompts via checklist; user clicks |

## RECOMMENDED fields (set them or accept defaults)

| Field | Default if omitted | Notes |
|---|---|---|
| `sessionCount` | open-ended (no cap) | For continuous courses, leave open |
| `durationMins` | system default | Only specify if you have a strict cadence |
| `teachingMode` | `comprehension` | `recall` \| `comprehension` \| `practice` \| `syllabus` |
| `planEmphasis` | `balanced` | `breadth` \| `balanced` \| `depth` |
| `npsEnabled` | wizard prompts | Single end-of-course satisfaction survey |

## OPT-IN: scoring mode

| Field | Allowed values | When to set |
|---|---|---|
| `hf-scoring-mode` (front-matter in `course-ref.md`) | `evidence-first` (only) | Skill-EMA courses with per-band rubrics (IELTS, NHS AfC, CEFR, etc.) |

**If your course has a separate `assessor-rubric.md` upload, set `hf-scoring-mode: evidence-first` in `course-ref.md`'s front-matter.** Without this declaration, the new playbook falls back to the legacy mode-gate and your skill scores may include rubric-prose hallucinations.

---

## Paste-block (copy this; replace `[example]` fields)

```text
I'm setting up a [example] course.

Institution: [example] [Name]
Type: [example] [school / lab / company / university]
Subject: [example] [discipline]
Course name: [example] [name]
Audience: [example] [primary | secondary | sixth-form | higher-ed | adult-professional | adult-casual | mixed]

The learners are [example] [one-paragraph profile — age, prior knowledge,
motivation, target outcome].

Teaching approach: [example] [socratic | directive | advisory | coaching | companion | facilitation | reflective | open | conversational-guide] — [example] [one-sentence rationale].

Calls: [example] [open-ended | soft cap ~N × M minutes]
Coverage: [example] [breadth | balanced | depth]
Assessment style: [example] [formal | informal]

progressionMode: I'll pick this from the chip picker when you offer it.
(DO NOT call update_setup with progressionMode — chip-click writes setupData
client-side. DO NOT call update_setup with modulesAuthored or constraints —
both rejected at the tool layer.)

Teaching rules, Call 1 special behaviour, skill descriptors, rubric bands,
and any session-specific overrides are all declared in the documents I'm
about to upload — extract them via assertion + projection, don't ask me
to re-type them.

I have [example] [N] teaching documents to upload — see the table I'll paste
after this message, or the file list in the Sources panel.
```

---

## Files to upload — minimum vs. recommended

### Minimum (any course)
- `course-ref.md` — tutor-only config + skills framework + outcomes (use `course-reference-template.md`)

### Recommended for skill-EMA / rubric-anchored courses (IELTS, NHS, CEFR, etc.)
- `course-ref.md` — as above, with `hf-scoring-mode: evidence-first` front-matter
- `assessor-rubric.md` — per-band descriptors (use `assessor-rubric-template.md`)

### Optional supplementary
- `tutor-briefing.md` — test format facts the tutor briefs but never quizzes
- `<subject>-language-toolkit.md` — learner-facing phrase repertoire (`TEXTBOOK`)
- One or more `*-question-bank-*.md` files — practice prompts (`QUESTION_BANK`)
- Worksheets / past papers / exemplars — graded source material

---

## What the wizard does NOT need re-typed

Every item in this list is already inside `course-ref.md` and gets projected
automatically. DO NOT paste these into the wizard chat:

- Call 1 special rules / first-session warm-up policy
- Brief-never-quiz / coaching-not-lecturing rules
- Skills framework names + tier descriptors (`### SKILL-NN`)
- Per-skill target band (`**Target band:** N.N`)
- Module catalogue + per-module outcomes (`## Modules` table + `**OUT-NN:**`)
- Session-scope overrides (`**Session scope:** 1` / `2+`)
- Pedagogy preset / lessonPlanMode / cadence preferences
- Disclosure schedule for criteria across calls

---

## Post-upload checklist (educator verifies these landed)

After the wizard completes, navigate to `/x/callers/<new-caller-id>` and
verify in the new caller's first call:

- [ ] `Playbook.config.scoringMode === "evidence-first"` (if `hf-scoring-mode` was declared) — verifies via DB or wizard's Sources panel
- [ ] Skill `Parameter` rows created with `parameterId LIKE 'skill_*'`
- [ ] Rubric pass populated `Parameter.config.bandThresholds` (4× skills × N bands) — if rubric was uploaded
- [ ] `Goal` rows: N ACHIEVE (`isAssessmentTarget: true`) + M LEARN per outcome
- [ ] Curriculum modules created with stable slugs
- [ ] After first call: SkillBandStripCard on caller's Overview tab shows BandChips for each measured skill

If any are missing, check the wizard's Sources panel for parse warnings —
typo'd front-matter keys, ignored declared values, etc. surface there.
