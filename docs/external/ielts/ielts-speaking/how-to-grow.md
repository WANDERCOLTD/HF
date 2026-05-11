# How to Grow the IELTS Speaking Course Pack

Authoring guide for the next person who needs to extend the IELTS Speaking
course pack — add a Part 1 topic frame, a Part 2 cue card, a Part 3 theme,
adjust a band descriptor, or add a paired Band 5 / Band 7 model exemplar.
Plain markdown, no front-matter — this guide is documentation, not ingested
content.

The pack is intentionally **8 documents** with a clean separation of duties:
the four official IELTS Speaking modules (`part1`, `part2`, `part3`, `mock`)
plus 8 OUT-NN learner outcomes are authored in `course-ref.md`; everything
else hangs off that spine. Don't sprawl the module list.

---

## 1. Where each thing lives

Eight docs in `Upload Docs/`, three jobs each:

- **`course-ref.md`** — the tutor instruction spine. Holds the 4-module
  catalogue (`part1` / `part2` / `part3` / `mock`), the 8 OUT-NN learner
  outcomes, the Socratic teaching approach, the **First Call (Onboarding)
  Special Rules**, the **Disclosure Schedule** for Calls 2–5, and the
  brief-never-quiz rule. Modules + outcomes are parsed directly from this
  doc by `detect-authored-modules.ts`. Don't duplicate this content
  anywhere else.
- **`tutor-briefing.md`** — the facts about the test the tutor briefs the
  learner on but never quizzes them on: 3-Part structure, timings, what
  the examiner can and cannot do, the six recurring question shapes per
  Part. Tutor-only material.
- **`assessor-rubric.md`** — the four band descriptors (FC, LR, GRA, P)
  for Bands 0–9, verbatim. Assessor-only. Only change if the IELTS
  criteria themselves change.
- **`ielts-speaking-language-toolkit.md`** — learner-facing phrase
  repertoire: discourse markers, hedges, paraphrase patterns, opinion
  language, signposting in monologue, idiomatic chunks, topic-specific
  collocations, conditionals, pronunciation features. Each section says
  which criterion it lifts and at which band step. This is what the
  learner consults; the tutor models from it.
- **`ielts-speaking-question-bank-part1.md`** — 50 Part 1 topic frames,
  each with 4–6 questions. Format: identity, frequency, preference, past
  experience, future / hypothetical, reason. Add a new topic frame here
  when you want a new Part 1 conversation surface.
- **`ielts-speaking-question-bank-part2.md`** — 88 Part 2 cue cards in
  the official 4-bullet form, clustered by frame (Person / Place / Object
  / Event / Experience / Activity). Add a new cue card here.
- **`ielts-speaking-question-bank-part3.md`** — 64 Part 3 discussion
  question sets, each with 4–6 questions, organised by 13 themes. Follows
  the seven Part 3 patterns: opinion, advantages/disadvantages,
  comparison, hypothetical, prediction, causes-and-effects,
  problem-solution.
- **`ielts-speaking-model-answers.md`** — paired Band 5 vs Band 7
  exemplars for selected questions. Surfaced **only on learner request**
  ("what does good look like?"). Each block carries a `module` tag (one
  of `part1` / `part2` / `part3` / `mock`), a `topic` sub-category, a
  `question_id`, and a one-line "Why Band 7 is stronger" annotation. This
  is the doc you'll grow most often.

The pattern: course-ref tells the tutor **how** to teach and which modules
exist. Tutor-briefing tells the tutor **what to brief**. Assessor-rubric
tells the scorer **how to assess**. Language-toolkit tells the learner
**what to reach for**. Question banks tell the tutor **what to ask**.
Model-answers shows learners **what good sounds like** when they ask.
Don't mix these up.

---

## 2. Adding a new Part 1 topic frame

Part 1 = familiar small-talk questions, 4–6 questions per frame.

Steps:

1. **Pick the topic.** Examples: festivals, shopping, sleep, dreams,
   transport, neighbours. Should be familiar enough that a Band 5 learner
   can attempt it without specialist vocabulary.
2. **Add a new `## Frame N — <topic>` section** to
   `ielts-speaking-question-bank-part1.md`. Follow the existing format:
   a signposting line ("Let's talk about ...") followed by 4–6 questions
   that cluster around identity, frequency, preference, past experience,
   future / hypothetical, and reason.
3. **Do NOT add a new module row** to `course-ref.md`. The Part 1 module
   is one module (`part1`); topic frames are sub-content within it, not
   separate modules. Adding a frame extends what the `part1` module can
   draw from; it does not change the module catalogue.
4. **Optionally add 1–2 paired exemplars** to
   `ielts-speaking-model-answers.md` under §1 if the topic introduces
   distinctive vocabulary or sentence patterns. Tag with `module: part1`
   and `topic: <topic_slug>`.
5. **Optionally add 1–2 collocations** to the matching section in
   `ielts-speaking-language-toolkit.md` §8 (topic-specific collocations)
   if the topic introduces new collocations.
6. **Smoke-test:** start a session, pick `part1` from the module picker,
   and confirm the tutor draws questions from the new frame at least
   once across a 4–5 minute Part 1 run.

---

## 3. Adding a new Part 2 cue card

Part 2 = a single 1.5–2 minute long turn on a cue card with 4 bullet
points and 60 seconds of prep.

Steps:

1. **Draft the cue card** with exactly 4 bullets. The form is fixed:
   ```
   Describe [a person / a place / an object / an event / an experience]
   You should say:
   - [bullet 1 — concrete fact]
   - [bullet 2 — concrete fact]
   - [bullet 3 — concrete fact]
   - and explain [one reflective bullet — feeling, lesson, importance]
   ```
   Stick close to the official template — examiners read cards verbatim
   and learners need familiarity.
2. **Add the cue card** to the matching frame in
   `ielts-speaking-question-bank-part2.md` (Person / Place / Object /
   Event / Experience / Activity). Use the existing block format.
3. **Do NOT add a new module row** to `course-ref.md`. Part 2 is one
   module (`part2`); cue cards are content within it.
4. **Optionally add 1 paired exemplar** to
   `ielts-speaking-model-answers.md` under §2 if the cue card surfaces a
   distinctive structural challenge (e.g. comparison-across-time,
   abstract reflection on a concrete object). Tag with `module: part2`
   and `topic: <frame_slug>` (e.g. `person`, `event`, `place`).
   - Band 7 long turn should target ~1.5 minutes (roughly 200–280 words
     at conversational pace) — **not** Part 1 length.
   - Band 5 should hit the same 4 bullets but in shorter, simpler
     sentences.
5. **Smoke-test:** run `part2`, deliver the new cue card, give the
   learner 60 seconds prep, then listen to a 1.5+ minute long turn. The
   tutor should stay silent during the long turn, then deliver one-line
   criterion-referenced feedback after.

---

## 4. Adding a new Part 3 theme

Part 3 = abstract discussion, 4–6 questions per set, ~30–45 second
analytical answers per question.

Steps:

1. **Pick the theme.** Examples: urban planning, work-life balance,
   sustainability, family roles, the role of art, mental health. Should
   be abstract enough to push the learner beyond personal anecdote.
2. **Add a new `## Theme: <theme>` section** to
   `ielts-speaking-question-bank-part3.md`. Each theme contains one or
   more question sets; each set has 4–6 questions following the seven
   Part 3 patterns (opinion, advantages/disadvantages, comparison,
   hypothetical, prediction, causes-and-effects, problem-solution).
3. **Do NOT add a new module row** to `course-ref.md`. Part 3 is one
   module (`part3`); themes are content within it.
4. **Optionally add 1–2 paired exemplars** to
   `ielts-speaking-model-answers.md` under §3. Band 7 answer target:
   30–45 seconds (~70–110 words). Should take a position, give one
   developed reason, and acknowledge a nuance or counter-view. Band 5
   should reach a similar conclusion in simpler sentences without
   nuance. Tag with `module: part3` and `topic: <theme_slug>` (e.g.
   `society_change`, `technology`, `education`).
5. **Optionally extend the toolkit:** if the theme surfaces new
   collocations or hedging patterns, add them to the matching section of
   `ielts-speaking-language-toolkit.md` (§2 hedging, §8 collocations).
6. **Smoke-test:** the tutor should fire 4–6 abstract questions across
   a Part 3 run, not 8+. Check that the model exemplar takes a position
   rather than just listing.

---

## 5. Adding a new paired exemplar

Paired exemplars live ONLY in `ielts-speaking-model-answers.md`. They are
surfaced **on learner request** — never unprompted — when the learner
asks "what does good look like?", "what would a Band 7 sound like?", or
similar.

Format (use the existing blocks as a template):

```
### Q: <the question>

> **Band 7 — model answer**
> tags: [band-7] question_id: <unique_id> module: <part1|part2|part3|mock> topic: <sub_slug>
>
> "<the answer at Band 7>"

> **Band 5 — weaker answer**
> tags: [band-5] question_id: <unique_id> module: <part1|part2|part3|mock> topic: <sub_slug>
>
> "<the answer at Band 5 — on-topic, communicative, but simpler>"

**Why Band 7 is stronger:** <one-line annotation naming the concrete
linguistic feature(s) — collocation, hedge, conditional, paraphrase,
discourse marker, etc.>
```

Rules:

- **`module` MUST be one of `part1` / `part2` / `part3` / `mock`** — these
  are the only four module IDs in `course-ref.md`. The Module Catalogue
  parser will silently drop any exemplar tagged with a non-canonical
  module value.
- **`topic` is free-form but conventional**: for `part1` use the topic
  frame slug (`home`, `hobbies`, `work_study`); for `part2` use the
  cue-card type (`person`, `place`, `object`, `event`, `experience`,
  `activity`); for `part3` use the theme slug (`society_change`,
  `technology`, `education`, etc.); for drill micro-examples use the
  criterion (`fluency`, `lexical`, `grammar`, `pronunciation`).
- **`question_id` is the unique runtime key** the tutor uses to look up
  the matching exemplar. Both tiers (Band 7 + Band 5) MUST share the
  same `question_id`. Drop the line or typo the format and the exemplar
  becomes orphaned.
- **Don't author beyond ~40 paired answers without running an end-to-end
  learner journey first.** Authoring blindly produces unused exemplars.

---

## 6. Adjusting the rubric

The four band descriptors in `assessor-rubric.md` are public,
examiner-facing standards. Treat them as fixed unless IELTS itself
publishes new descriptors.

If you need to adjust:

1. Confirm the change against the source PDFs in
   `docs/external/ielts/ielts-speaking/` (the band-descriptor PDFs).
2. Edit the specific Band cell in the relevant `RUB-FC` / `RUB-LR` /
   `RUB-GRA` / `RUB-P` table. Preserve the table structure — the
   extractor reads each row as a band-keyed descriptor.
3. Update the version footer and add a changelog entry. The rubric is a
   citable source — keep its history clean.

Do NOT add new criteria. IELTS Speaking has four, equally weighted.
Adding a fifth would silently break the scoring loop.

---

## 7. Quality bar — what makes a Band 7 sample land

Read `assessor-rubric.md` and the discriminator notes in
`ielts-speaking-language-toolkit.md` before authoring a new Band 7
exemplar.

**Do:**

- **Hedge and qualify.** "I'd say…", "in some ways…", "broadly
  speaking…", "having said that…". These signal Band 7 thinking, not
  just Band 7 vocabulary.
- **Reach for less-common precise vocabulary.** Replace
  "good"/"bad"/"important" with topic-specific items: "robust",
  "fraught", "pivotal", "level-headed", "unflappable", "fraught with
  risk", "double-edged sword".
- **Use complex structures sparingly and accurately.** One clean
  conditional is worth five attempted ones. A relative clause embedded
  in a longer sentence shows range without overreach.
- **Extend with detail, not padding.** "I cycle most days, weather
  permitting, and it takes about twenty minutes door to door" extends
  with concrete detail. "I cycle most days and I really enjoy it because
  it is good exercise" pads with generic value claims.

**Don't:**

- **Don't write Band 8/9 prose and call it Band 7.** Reviewers should be
  able to point at small lapses — a moderately repeated phrase, a slight
  reach. Perfection is suspicious.
- **Don't make Band 5 nonsense.** Band 5 is on-topic, communicative, and
  intelligible. Errors are present but meaning gets through. If your
  Band 5 example needs translating, it's Band 3.

---

## 8. What not to do

- **Don't paste exemplar prose into `course-ref.md` or any other
  COURSE_REFERENCE-typed doc.** The extractor classifies content in
  COURSE_REFERENCE docs as `teaching_rule` / `session_flow` /
  `assessment_guidance`. Exemplars belong in `ielts-speaking-model-answers.md`
  (front-matter `hf-document-type: EXAMPLE`, `hf-default-category:
  example`). Mismatches cause silent misclassification.
- **Don't put `category=example` content in a COURSE_REFERENCE-typed
  doc.** Same point, restated for emphasis. The extractor reads
  front-matter before content; a mismatch is irreversible at extraction
  time.
- **Don't bypass the Disclosure Schedule.** Call 1 must stay topic-led;
  the four criteria (FC, LR, GRA, P) must NOT be named on Call 1.
  Authored content that surfaces "Fluency & Coherence" by name on Call 1
  breaks the onboarding rule. The Disclosure Schedule is enforced by
  `session_override` extractions from `course-ref.md` — any new
  content that conflicts will silently lose to the override at runtime.
- **Don't proliferate module rows in `course-ref.md`.** The 4-module
  list (`part1`, `part2`, `part3`, `mock`) is the official IELTS shape.
  New topic frames, cue cards, and themes are content within those four
  modules, not new modules.
- **Don't lower the bar on `question_id` formatting.** The tutor looks
  up the matching exemplar at runtime by `question_id`. Drop the line or
  typo the format and the exemplar becomes orphaned.
- **Don't add a fifth IELTS criterion.** The rubric has four; the score
  loop expects four; adding a fifth silently breaks scoring.

---

## 9. Smoke test before shipping

Run this checklist on every change before merging:

- [ ] **Front-matter valid:** every `hf-*` key is in the allow-list (see
  `apps/admin/lib/content-trust/parse-content-declaration.ts`). Document
  type matches the doc's purpose. Categories must match
  `ASSERTION_CATEGORIES` in the parser.
- [ ] **Modules table parses:** open
  `apps/admin/lib/wizard/detect-authored-modules.ts`, confirm every
  column header in `course-ref.md`'s Modules table matches a key in
  `COLUMN_ALIASES`. Run the wizard preview locally to confirm the four
  modules show up.
- [ ] **`Modules authored: Yes` marker present** at the top of the
  Modules section AND at the bottom of `course-ref.md`.
- [ ] **Outcome IDs cross-reference.** Every `OUT-NN` referenced in a
  module row appears as a `**OUT-NN: …**` bold line in the Outcomes
  section. There are 8 outcomes (OUT-01 to OUT-08).
- [ ] **Module IDs are valid:** exactly four — `part1`, `part2`,
  `part3`, `mock`. No new module IDs without a deliberate decision to
  expand the catalogue.
- [ ] **Model-answers tags consistent:** every block has both a `tags:`
  line and a `question_id:` line and a `module:` line and a `topic:`
  line, formatted exactly like the existing blocks. No `question_id`
  appears twice in the same tier. Every `module:` value is one of
  `part1` / `part2` / `part3` / `mock`.
- [ ] **Tier balance:** every `question_id` has both a `band-5` and a
  `band-7` block. Orphaned tiers won't pair correctly at runtime.
- [ ] **Cross-doc references resolve:** filenames in `course-ref.md`
  and `wizard-prompt.md` match the actual filenames on disk.
- [ ] **Wizard prompt up to date:** if you added a new doc to
  `Upload Docs/`, `wizard-prompt.md` lists it in the Documents to upload
  table and the doc count in the intro line is right.
- [ ] **End-to-end run:** start a session, pick a module from the
  picker, run it for a full module length, and confirm:
  - Whisper feedback fires after each turn on Call 2+.
  - "What does good look like?" surfaces the matching paired exemplar
    when the learner asks — and never otherwise.
  - End-of-call band readout references the new module's outcomes.
  - Operator log entry includes the module id + verbatim evidence.
  - Call 1 stays topic-led — the four criteria are not named.

If any step fails, fix before merging. If you find a smoke-test bug
that matters more than one author's PR, capture it as a story in the
backlog rather than working around it locally.
