# Spot the Spin / Seducing Strangers — Wizard Prompt

Paste the block below into the V5 wizard chat. Upload the 5 docs from this directory when prompted.

> **Last refreshed:** 2026-06-18. Aligned with Course Reference Template v5.1 (epic #1931).
>
> **Display name note:** the live playbook on hf_staging is named "Spot the Spin"; the in-repo dir is `seducing-strangers/` and the source course-ref carries the original "Seducing Strangers" name from Josh Weltman's book. Display vs file-name divergence is intentional — the file name traces sourcing; the display name is the live offering.

---

## Wizard prompt (paste this; nothing more)

```
I'm setting up a Persuasion + Sales course called Spot the Spin (sourced from
Josh Weltman's "Seducing Strangers" and Robert Cialdini's "Influence: The
Psychology of Persuasion").

Institution: Abacus Academy
Type: Adult continuing-education
Subject: Persuasion — Cialdini's Seven Principles + Practitioner Framing
Course name: Spot the Spin
Audience: general-adult

The learners are adults who want to spot persuasion attempts in advertising,
politics, and everyday interactions — and use the same principles ethically
in their own work. The course teaches Cialdini's seven principles
(Reciprocity, Commitment, Social Proof, Liking, Authority, Scarcity, Unity)
framed through Weltman's "persuader's voice" lens.

Teaching approach: Socratic — the tutor names a principle, walks the learner
through a real-world example, then has the learner spot it in fresh stimuli.
Explicit ethical training on the persuasion vs manipulation distinction in
every unit.

Calls: ~5 short calls (one per cluster of principles + ethics foundation).
Coverage: depth — each principle gets a focused unit with practitioner framing.
Assessment style: criterion-referenced via 3 skill bands.

courseStyle: structured

progressionMode: learner-picks — after the ethics foundation, the learner
picks which principle cluster to focus on next.

DO NOT call update_setup with `progressionMode`, `modulesAuthored`, or
`constraints`. All teaching rules and the persuasion-vs-manipulation framing
live in seducing-strangers.course-ref.md and project automatically.

I have 5 teaching documents to upload covering: course config + 5 modules +
16 outcomes (seducing-strangers.course-ref.md, with `hf-template-version: "5.1"`
declared), the Cialdini Influence summary, a Seducing Strangers summary, the
glossary, and the question bank.
```

---

## Documents to upload (5 files)

Upload all files from `docs/courses/seducing-strangers/` (except README + DS_Store):

| # | File | DocumentType | Audience | What it provides |
|---|------|---|---|---|
| 1 | `seducing-strangers.course-ref.md` | `COURSE_REFERENCE_CANONICAL` | tutor-only | Master config (`hf-template-version: "5.1"`, modulesAuthored: true, default mode: learner-picks), **5 modules** + **16 OUT-NN outcomes**, `## Skills Framework` (3 skills with Emerging/Developing/Secure tiers), Socratic teaching approach, ethics framing, persuasion vs manipulation distinction |
| 2 | `cialdini-influence-summary.textbook.md` | `TEXTBOOK` | learner-facing | Cialdini's Influence — 7 Principles summary with research lineage and worked examples per principle |
| 3 | `seducing-strangers-summary.textbook.md` | `TEXTBOOK` | learner-facing | Weltman's "Seducing Strangers" voice + practitioner framing — applied to advertising / sales / negotiation |
| 4 | `persuasion-glossary.reference.md` | `REFERENCE` | mixed | Glossary of persuasion terms, common rhetorical devices, manipulation red-flags |
| 5 | `seducing-strangers-question-bank.qbank.md` | `QUESTION_BANK` | practice prompts | Real-world persuasion stimuli + Spot-the-Spin prompts per principle cluster |

---

## Post-upload, expect

After the wizard's `applyProjection` step:

1. **3 `Parameter` rows** from `## Skills Framework`, typed `BEHAVIOR`, sectionId `skill`.
2. **3 PLAYBOOK-scope `BehaviorTarget` rows** — one per skill.
3. **`Playbook.config.goals[]`** — **19 goal templates**:
   - **3 ACHIEVE templates** (one per skill), `isAssessmentTarget: true`, `ref: SKILL-NN`
   - **16 LEARN templates** (one per OUT-NN outcome), `ref: OUT-NN`
4. **Curriculum + 5 `CurriculumModule` rows** + LO rows per `outcomesPrimary` mapping.
5. **No source-ref backfill required** — this course doesn't use exam-prep settings.

When a learner enrols:

6. **`instantiatePlaybookGoals`** produces 19 `Goal` rows (3 ACHIEVE + 16 LEARN).
7. **`instantiatePlaybookTargets`** pre-creates 3 `CallerTarget` placeholders.

Per-call:

8. MEASURE spec writes `CallScore` per skill; aggregate-runner EMA → `<BandChip>` renders on Progress tab.

---

## Re-upload safety

`applyProjection` is idempotent. Re-uploading produces zero net mutations beyond `updatedAt` bumps.

---

## Where this gets verified

- `apps/admin/lib/wizard/__tests__/project-course-reference.test.ts` + `apply-projection.test.ts`
- `apps/admin/tests/lib/instantiate-goals.test.ts`
- `apps/admin/tests/lib/instantiate-targets.test.ts`
- End-to-end: manual wizard chat with the 5 docs above
