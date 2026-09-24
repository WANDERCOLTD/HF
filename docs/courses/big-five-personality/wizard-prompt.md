# Big Five Personality — Wizard Prompt

Paste the block below into the V5 wizard chat. Upload the 5 docs from this directory when prompted.

> **Last refreshed:** 2026-06-18. Aligned with Course Reference Template v5.1 (epic #1931).

---

## Wizard prompt (paste this; nothing more)

```
I'm setting up a Big Five Personality course.

Institution: PAW Training Ltd
Type: Corporate / adult learning
Subject: Personality Psychology — Five-Factor Model
Course name: Big Five Personality
Audience: general-adult

The learners are adults curious about how personality science actually works.
No prior psychology background assumed. The course walks them through the
Big Five (OCEAN) trait model — Openness, Conscientiousness, Extraversion,
Agreeableness, Negative Emotionality — and explicitly contrasts the model
with folk-vocabulary misconceptions (introvert = shy, neurotic = neurotic,
agreeable = nice) plus popular alternatives (MBTI / 16Personalities).

Teaching approach: Socratic — trait introduction → facet pull-apart → learner-
supplied example → misconception catch-and-correct. The tutor never lectures;
draws out the learner's own examples for each trait.

Calls: ~5 short calls (one per trait foundation + foundations module).
Coverage: depth — each trait gets a focused call with facet pull-apart.
Assessment style: criterion-referenced via 3 skill bands (Emerging /
Developing / Secure).

courseStyle: structured

progressionMode: learner-picks — after the foundations module, the learner
picks which trait to focus on next.

DO NOT call update_setup with `progressionMode`, `modulesAuthored`, or
`constraints` — `progressionMode` is chip-click only; the others are rejected
at the tool layer. All teaching rules, Socratic patterns, misconception list,
and facet decomposition live in big-five-personality.course-ref.md and project
automatically.

I have 5 teaching documents to upload covering: course config + 6 modules +
16 outcomes (big-five-personality.course-ref.md, with `hf-template-version: "5.1"`
declared), the BFI-2 instrument summary, an OpenStax Psychology Ch 11 textbook
excerpt, glossary, and the question bank.
```

---

## Documents to upload (5 files)

Upload all files from `docs/courses/big-five-personality/` (except README + DS_Store):

| # | File | DocumentType | Audience | What it provides |
|---|------|---|---|---|
| 1 | `big-five-personality.course-ref.md` | `COURSE_REFERENCE_CANONICAL` | tutor-only | Master config (`hf-template-version: "5.1"`, modulesAuthored: true, default mode: learner-picks), **6 modules** + **16 OUT-NN outcomes**, `## Skills Framework` (3 skills with Emerging/Developing/Secure tiers), Socratic teaching approach, misconception list, facet decomposition |
| 2 | `big-five-bfi2-summary.textbook.md` | `TEXTBOOK` | learner-facing | BFI-2 (Big Five Inventory 2) — Soto & John 2017 — instrument summary with facets and example items per trait |
| 3 | `openstax-psych-2e-ch11.textbook.md` | `TEXTBOOK` | learner-facing | OpenStax Psychology 2e Chapter 11 (Personality) excerpt — historical lineage, lexical hypothesis, Big Five vs alternatives |
| 4 | `big-five-glossary.reference.md` | `REFERENCE` | mixed | Glossary of Big Five terms + folk-vocabulary mappings (e.g. "introvert" → low Extraversion's Sociability facet, NOT pathology) |
| 5 | `big-five-question-bank.qbank.md` | `QUESTION_BANK` | practice prompts | Per-trait facet pull-apart questions + example prompts for misconception catch-and-correct cycles |

---

## Post-upload, expect

After the wizard's `applyProjection` step:

1. **3 `Parameter` rows** auto-created from `## Skills Framework` (one per SKILL-NN), typed `BEHAVIOR`, sectionId `skill`.
2. **3 PLAYBOOK-scope `BehaviorTarget` rows** — one per skill, `targetValue` derived from each skill's declared target tier.
3. **`Playbook.config.goals[]`** — **19 goal templates**:
   - **3 ACHIEVE templates** (one per skill), `isAssessmentTarget: true`, `ref: SKILL-NN`
   - **16 LEARN templates** (one per OUT-NN outcome), `ref: OUT-NN`
4. **Curriculum + 6 `CurriculumModule` rows** + `LearningObjective` rows projected per `outcomesPrimary` × OUT-NN dictionary.
5. **No source-ref backfill required** — this course doesn't use `cueCardPool` / `topicPool` / `scaffoldPool` (those are exam-prep specific).

When a learner enrols:

6. **`instantiatePlaybookGoals`** produces 19 `Goal` rows on the caller (3 ACHIEVE + 16 LEARN).
7. **`instantiatePlaybookTargets`** pre-creates 3 `CallerTarget` placeholders.

Per-call:

8. MEASURE spec writes `CallScore` per skill, `aggregate-runner` EMA → `CallerTarget.currentScore` → `<BandChip>` renders on Progress tab once `callsUsed > 0`.

---

## Re-upload safety

`applyProjection` is idempotent. Re-uploading produces zero net mutations beyond `updatedAt` bumps. Goal templates with `sourceContentId` are replaced wholesale; hand-authored goals (no `sourceContentId`) are preserved.

---

## Where this gets verified

- `apps/admin/lib/wizard/__tests__/project-course-reference.test.ts` + `apply-projection.test.ts` — projection pipeline
- `apps/admin/tests/lib/instantiate-goals.test.ts` — Goal row instantiation
- `apps/admin/tests/lib/instantiate-targets.test.ts` — CallerTarget placeholder creation
- End-to-end: `npm run db:seed -- big-five-personality` (if a per-course seed exists) OR the manual wizard chat
