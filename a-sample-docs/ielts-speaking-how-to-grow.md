# How to Grow the IELTS Speaking Course Pack

Authoring guide for the next person who needs to add a Part 1 topic, a
Part 2 cue card, a Part 3 theme, or a skill drill to the IELTS Speaking
course pack. Plain markdown, no front-matter — this guide is documentation,
not ingested content.

---

## 1. Where each thing lives

Three docs, three jobs:

- **`ielts-speaking-course-reference.md`** — tutor instructions. The Modules
  table is the source of truth for what modules exist and how the tutor
  should run them (tutor vs examiner mode, repeatable vs cooldown, which
  outcomes the module ladders into).
- **`ielts-speaking-rubric.md`** — the four assessor LOs (Fluency, Lexical,
  Grammar, Pronunciation), each with Band 5 / Band 6 / Band 7 descriptors.
  This is what the scorer applies. Only change if the IELTS criteria
  themselves change.
- **`ielts-speaking-model-answers.md`** — paired Band 5 vs Band 7 exemplars,
  one pair per question. The tutor reads these aloud when the learner asks
  "what does good look like?". This is the doc you'll grow most often.
- **`ielts-speaking-practice-content.md`** + **`ielts-speaking-mock-exam-strategy.md`** —
  learner-facing vocabulary, drill passages, and exam-day strategy. Linked
  from the course-ref but maintained separately. Add to these when a new
  topic needs a fresh vocabulary bank or a new pacing/recovery drill.

The pattern: course-ref tells the tutor **how** to teach. Rubric tells the
scorer **how to assess**. Model-answers shows learners **what good sounds
like**. Don't mix these up.

---

## 2. Adding a new Part 1 topic

Part 1 = familiar small-talk questions, ~10–12 minutes of practice, 6–8
short Q/A pairs per module.

Steps:

1. **Pick the topic.** Examples: travel, food, music, sleep, festivals,
   shopping. Should be familiar enough that a Band 5 learner can attempt
   it without specialist vocabulary.
2. **Add a module row to `ielts-speaking-course-reference.md`.** Use the
   template below. Pick an ID matching `/^[a-z][a-z0-9_]*$/`, ≤32 chars.
   Outcomes column = `OUT-01` (Part 1 default).
3. **Add 2 questions × 2 tiers (4 blocks) to `ielts-speaking-model-answers.md`** under §1.
   Use the model-answers block template below. Reuse Band 7 phrasing
   from `ielts-speaking-practice-content.md` §2.1 where the topic overlaps.
4. **Add 1–2 vocabulary lines to `ielts-speaking-practice-content.md`** §2.1 if
   the topic introduces new collocations.
5. **Smoke-test:** run a tutor-mode session of the module yourself (`/vm-dev`,
   pick the new module from the picker) and confirm the tutor (a) asks 6–8
   short questions, (b) gives whisper feedback, and (c) surfaces the new
   paired exemplar when you say "what would a strong answer sound like?".

**Module row template (course-ref):**

```
| p1_<topic> | Part 1 — <Topic name> | Yes | tutor | 10–12 min | All four criteria | No | No | repeatable | ielts-speaking-model-answers.md | OUT-01 | none |
```

**Model-answers block template (×2 questions):**

```
### Q: <the question>

> **Band 7 — model answer**
> tags: [band-7] question_id: p1_<topic>_q1 module: p1_<topic>
>
> "<answer>"

> **Band 5 — weaker answer**
> tags: [band-5] question_id: p1_<topic>_q1 module: p1_<topic>
>
> "<answer>"

**Why Band 7 is stronger:** <one-line annotation>
```

---

## 3. Adding a new Part 2 cue card

Part 2 = a single 1.5–2 minute long turn on a cue card with 4 bullet points
and 60 seconds of prep.

Steps:

1. **Draft the cue card** with exactly 4 bullet points. Follow the IELTS
   pattern: "You should say: who/what, when/where, how/what, and explain
   why/how." Stick close to public IELTS templates — examiners read cards
   verbatim and learners need familiarity.
2. **Add a module row to `ielts-speaking-course-reference.md`.** ID prefix
   `p2_describe_<noun>`. Outcomes = `OUT-02` (Part 2 default).
3. **Add 1 cue card × 2 tiers (2 blocks) to `ielts-speaking-model-answers.md`** under §2.
   The Band 7 long turn should target ~1.5 minutes (roughly 200–280 words
   at conversational pace) — **not** Part 1 length. The Band 5 should hit
   the same 4 bullets but in shorter, simpler sentences.
4. **Note the pacing target:** Band 7 long turn should land cleanly at
   1:30–1:50, not trail off. Read the model aloud with a stopwatch.
5. **Smoke-test:** run the module, deliver the cue card, give the learner
   60 seconds prep, then listen to a 1.5+ minute long turn. The tutor
   should stay silent during the long turn, then deliver one-sentence
   whisper feedback.

**Module row template:**

```
| p2_describe_<noun> | Part 2 — Describe <a/an noun> | Yes | tutor | 10–12 min | All four criteria | No | No | repeatable | ielts-speaking-model-answers.md | OUT-02 | none |
```

**Model-answers block template:**

```
### Cue card: Describe <X>.

You should say:
- <bullet 1>
- <bullet 2>
- <bullet 3>
- <bullet 4>

> **Band 7 — model answer**
> tags: [band-7] question_id: p2_describe_<noun>_q1 module: p2_describe_<noun>
>
> "<~1.5 min long turn>"

> **Band 5 — weaker answer**
> tags: [band-5] question_id: p2_describe_<noun>_q1 module: p2_describe_<noun>
>
> "<shorter, simpler answer covering same bullets>"

**Why Band 7 is stronger:** <one-line annotation>
```

---

## 4. Adding a new Part 3 theme

Part 3 = abstract discussion, 4–6 questions per module, ~30–45 second
analytical answers per question.

Steps:

1. **Pick the theme.** Examples: work-life balance, urban planning,
   sustainability, family roles, the role of art. Should be abstract
   enough to push the learner beyond personal anecdote.
2. **Add a module row** to `ielts-speaking-course-reference.md`. ID prefix
   `p3_<theme>`. Outcomes = `OUT-03`.
3. **Add 2 questions × 2 tiers (4 blocks) to `ielts-speaking-model-answers.md`** under §3.
   Band 7 answer target: 30–45 seconds (~70–110 words). Should take a
   position, give one developed reason, and acknowledge a nuance or
   counter-view. Band 5 should reach a similar conclusion in simpler
   sentences without nuance.
4. **Add 1–2 vocabulary lines to `ielts-speaking-practice-content.md`** §2.3 if
   the theme introduces new discourse markers or hedging phrases.
5. **Smoke-test:** the tutor should fire 4–6 abstract questions across the
   module, not 8+ (Part 3 is shorter and denser than Part 1). Check that
   the model exemplar takes a position rather than just listing.

**Module row template:**

```
| p3_<theme> | Part 3 — <Theme name> | Yes | tutor | 10–12 min | All four criteria | No | No | repeatable | ielts-speaking-model-answers.md | OUT-03 | none |
```

Use the same model-answers block template as Part 1, with `p3_<theme>_q1`
as the question_id.

---

## 5. Adding a new skill drill

Skill drills isolate ONE of the four IELTS criteria and run targeted
practice on it. The pack ships with one drill per criterion (Fluency,
Lexical, Grammar, Pronunciation).

Steps:

1. **Decide: extend an existing drill or author a new one?** Default to
   extending. Author a new drill ONLY if the new drill targets a
   sub-feature that the existing drill doesn't cover (e.g. adding
   `drill_pronunciation_stress` separately from `drill_pronunciation` if
   sentence-stress practice is meaningfully distinct from connected-speech
   practice). For a new vocabulary domain or a new grammar structure,
   extend the existing drill.
2. **Add a module row to `ielts-speaking-course-reference.md`.** ID prefix
   `drill_<criterion>`. `Scoring fired` = the single criterion (e.g.
   `Fluency & Coherence`), not "All four criteria". Outcomes = `OUT-04`
   for diagnosis-focused drills, `OUT-05` for pronunciation drills.
3. **Add 1 micro-example × 2 tiers (2 blocks) to `ielts-speaking-model-answers.md`** under §4.
   Micro-examples should isolate ONE criterion — the other three should
   be roughly equal across the Band 5 and Band 7 versions, so the learner
   hears the difference on the criterion being drilled.
4. **Smoke-test:** the tutor should NOT score all four criteria at end of
   the drill — only the drilled criterion's band should update. Confirm
   the module ends with feedback focused on the single criterion.

---

## 6. Quality bar — what makes a Band 7 sample land

Read the rubric (`ielts-speaking-rubric.md`) before authoring a new Band 7
exemplar. The descriptors there are the bar.

**Do:**

- **Hedge and qualify.** "I'd say…", "in some ways…", "broadly speaking…",
  "having said that…". These signal Band 7 thinking, not just Band 7
  vocabulary.
- **Reach for less-common precise vocabulary.** Replace "good"/"bad"/"important"
  with topic-specific items: "robust", "fraught", "pivotal", "level-headed",
  "unflappable", "fraught with risk".
- **Use complex structures sparingly and accurately.** One clean conditional
  is worth five attempted ones. A relative clause embedded in a longer
  sentence shows range without overreach.
- **Extend with detail, not padding.** "I cycle most days, weather permitting,
  and it takes about twenty minutes door to door" extends with concrete
  detail. "I cycle most days and I really enjoy it because it is good
  exercise" pads with generic value claims.

**Don't:**

- **Don't write Band 8/9 prose and call it Band 7.** Reviewers should be
  able to point at small lapses — a moderately repeated phrase, a slight
  reach. Perfection is suspicious.
- **Don't make Band 5 nonsense.** Band 5 is on-topic, communicative, and
  intelligible. Errors are present but meaning gets through. If your Band
  5 example needs translating, it's Band 3.

---

## 7. What not to do

- **Don't paste exemplar prose into the course-ref doc.** The extractor
  classifies content in `COURSE_REFERENCE` as `teaching_rule`. Exemplars
  belong in `EXAMPLE`-typed docs (front-matter `hf-document-type: EXAMPLE`,
  `hf-default-category: example`). The model-answers doc is the right
  home.
- **Don't put `category=example` content in a COURSE_REFERENCE-typed doc.**
  Same point, restated for emphasis. The extractor reads front-matter
  before content; mismatches cause silent misclassification.
- **Don't author beyond ~40 paired answers without running an end-to-end
  learner journey first.** Author more content only after you've watched a
  real learner pick modules, hit a wall, and tell you what they wished
  was there. Authoring blindly produces unused exemplars.
- **Don't change the four IELTS criteria in the rubric.** Those are public,
  examiner-facing standards. The rubric mirrors them. If IELTS publishes
  new descriptors, update the rubric — otherwise leave it.
- **Don't lower the bar on `question_id` formatting.** The tutor looks up
  the matching exemplar at runtime by `question_id`. Drop the line or
  typo the format and the exemplar becomes orphaned.

---

## 8. Smoke test before shipping

Run this checklist on every change before merging:

- [ ] **Front-matter valid:** every `hf-*` key is in the allow-list (see
  `apps/admin/lib/content-trust/parse-content-declaration.ts`). Document
  type matches the doc's purpose.
- [ ] **Modules table parses:** open `apps/admin/lib/wizard/detect-authored-modules.ts`,
  confirm every column header in your new row matches a key in
  `COLUMN_ALIASES`. Run the wizard preview locally to confirm modules
  show up.
- [ ] **`Modules authored: Yes` marker present** at top of Modules section
  AND at the bottom of the doc.
- [ ] **Outcome IDs cross-reference.** Every `OUT-NN` referenced in a
  module row appears as a `**OUT-NN: …**` bold line in the Outcomes
  section.
- [ ] **Module IDs are valid:** `/^[a-z][a-z0-9_]*$/`, ≤32 chars, unique
  within the doc.
- [ ] **Model-answers tags consistent:** every block has both a `tags:` line
  and a `question_id:` line, formatted exactly like the existing blocks.
  No question_id appears twice in the same tier.
- [ ] **Tier balance:** every `question_id` has both a `band-5` and a
  `band-7` block. Orphaned tiers won't pair correctly.
- [ ] **Cross-doc references resolve:** filenames in the course-ref's
  "Examples" section match the actual filenames on disk.
- [ ] **End-to-end run:** start a session, pick the new module from the
  picker, run it for a full module length, and confirm:
  - Whisper feedback fires after each turn (tutor mode).
  - "What does good look like?" surfaces the matching paired exemplar.
  - End-of-module band readout references the new module's outcomes.
  - Operator log entry includes the new module id + verbatim evidence.

If any step fails, fix before merging. If you find a smoke test bug that
matters more than one author's PR, capture it as a story in the backlog
rather than working around it locally.
