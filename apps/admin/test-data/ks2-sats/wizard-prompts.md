# KS2 SATs — Wizard Prompts

Paste each prompt into the V5 wizard chat. Upload the listed docs when prompted.
Create each course separately (three wizard sessions). All three share the same
PlaybookGroup ("KS2 SATs Prep") so they appear grouped together in the UI.

---

## Course 1: KS2 Maths

### Wizard prompt

```
I'm setting up a KS2 SATs Maths revision course for Year 6 pupils (age 10-11).

Subject: Mathematics
Course name: KS2 Maths SATs Prep
Department: KS2 SATs Prep
Audience: primary

The course prepares Year 6 pupils for the Key Stage 2 Mathematics SATs — three papers: one arithmetic (30 mins, 36 questions) and two reasoning (40 mins each). The content domains are number and place value, calculations, fractions/decimals/percentages, ratio, algebra, measurement, geometry, and statistics — coded as 6N, 6C, 6F, 6R, 6A, 6M, 6G, 6S.

Teaching approach: directive — structured, step-by-step instruction. SATs maths is procedural: pupils need to learn methods and practise applying them under time pressure. Socratic discovery is too slow for exam prep.

Teaching emphasis: practice — this is revision, not first teaching. Pupils have already learned the content in class. The AI tutor should drill, reinforce, and build speed and accuracy.

Sessions: 8 × 30 minutes
Lesson plan model: mastery — one content domain per session, build to fluency before moving on.
Coverage: depth — better to be secure on fewer domains than shaky on all of them.

Assessment targets:
- Score 100+ on scaled score (national expected standard)
- Complete Paper 1 arithmetic in under 25 minutes with 90%+ accuracy
- Show full working on multi-step reasoning questions

Constraints:
- Never teach methods outside the KS2 curriculum (no simultaneous equations, no trigonometry)
- Never skip showing working — "the mark scheme gives marks for method, not just the answer"
- Never use the word "test" or "exam" casually — say "practice paper" or "SATs questions"
- Never set homework — this is tutoring, not classroom teaching

Assessment style: formal — SATs is a formal exam, so track content domain mastery explicitly.

I have teaching documents to upload — the SATs test framework (the official skill taxonomy), past papers with mark schemes, and a course reference guide for how the AI should tutor.
```

### Documents to upload

Drop all files for one course at once — the analyzer will group them.

| File | Expected classification |
|------|----------------------|
| `course-ref-maths.md` | COURSE_REFERENCE |
| `curriculum/ks2-maths-test-framework-2016.pdf` | CURRICULUM |
| `curriculum/ks2-maths-programmes-of-study.pdf` | CURRICULUM |
| `curriculum/ks2-maths-guidance.pdf` | COURSE_REFERENCE |
| `maths/2024/paper1-arithmetic.pdf` | ASSESSMENT |
| `maths/2024/paper2-reasoning.pdf` | ASSESSMENT |
| `maths/2024/paper3-reasoning.pdf` | ASSESSMENT |
| `maths/2024/mark-schemes.pdf` | ASSESSMENT |
| `maths/2025/paper1-arithmetic.pdf` | ASSESSMENT |
| `maths/2025/paper2-reasoning.pdf` | ASSESSMENT |
| `maths/2025/paper3-reasoning.pdf` | ASSESSMENT |
| `maths/2025/mark-schemes.pdf` | ASSESSMENT |

---

## Course 2: KS2 Reading

### Wizard prompt

```
I'm setting up a KS2 SATs English Reading revision course for Year 6 pupils (age 10-11).

Subject: English Language
Course name: KS2 Reading SATs Prep
Department: KS2 SATs Prep
Audience: primary

The course prepares Year 6 pupils for the Key Stage 2 English Reading SATs — one paper (60 minutes) with a reading booklet containing three texts of increasing difficulty and an answer booklet with comprehension questions. The cognitive domain references are 2a (word meaning), 2b (retrieval), 2c (summary), 2d (inference), 2e (prediction), 2f (structure), 2g (language choices), 2h (comparisons).

Teaching approach: socratic — reading comprehension is about thinking, not memorising. The AI should ask "What tells you that?" and "How do you know?" to build inference skills. Pupils need to learn to find evidence in the text, not guess.

Teaching emphasis: comprehension — this is about understanding what they read, not decoding or fluency.

Sessions: 8 × 30 minutes
Lesson plan model: spiral — revisit the same reading skills (inference, language, retrieval) across different text types. One text per session, all question types on that text.
Coverage: balanced — cover all content domains but weight toward 2d (inference) and 2g (language) which carry the most marks.

Assessment targets:
- Score 100+ on scaled score (national expected standard)
- Use PEE structure (Point, Evidence, Explain) on all 2-3 mark questions
- Answer 1-mark retrieval questions in under 30 seconds (quick scanning)

Constraints:
- Never accept an inference answer without text evidence — always ask "Which words tell you that?"
- Never teach creative writing — this is comprehension only
- Never accept "it makes the reader want to read on" as a language effect answer — push for specific effects
- Never rush past a text the pupil finds difficult — scaffold it, do not simplify it

Assessment style: formal — track mastery per content domain reference (2a through 2h).

I have teaching documents to upload — the reading test framework (the official skill taxonomy), past paper reading booklets with answer booklets and mark schemes, and a course reference guide for how the AI should tutor reading comprehension.
```

### Documents to upload

| File | Expected classification | Notes |
|------|----------------------|-------|
| `course-ref-reading.md` | COURSE_REFERENCE | |
| `curriculum/ks2-reading-test-framework-2016.pdf` | CURRICULUM | |
| `reading/2024/reading-booklet.pdf` | READING_PASSAGE | Auto-pairs with answer booklet |
| `reading/2024/answer-booklet.pdf` | COMPREHENSION | Linked to reading booklet |
| `reading/2024/mark-schemes.pdf` | ASSESSMENT | |
| `reading/2025/reading-booklet.pdf` | READING_PASSAGE | Auto-pairs with answer booklet |
| `reading/2025/answer-booklet.pdf` | COMPREHENSION | Linked to reading booklet |
| `reading/2025/mark-schemes.pdf` | ASSESSMENT | |

---

## Course 3: KS2 SPaG

### Wizard prompt

```
I'm setting up a KS2 SATs Grammar, Punctuation and Spelling revision course for Year 6 pupils (age 10-11).

Subject: English Language
Course name: KS2 SPaG SATs Prep
Department: KS2 SATs Prep
Audience: primary

The course prepares Year 6 pupils for the Key Stage 2 English Grammar, Punctuation and Spelling SATs — two papers: Paper 1 is short-answer grammar and punctuation questions (45 minutes, ~50 marks), Paper 2 is a spelling test (15 minutes, 20 marks, read aloud by teacher). Grammar content domains are coded G3 (grammar), G5 (punctuation), G7 (vocabulary).

Teaching approach: directive — grammar is about learning rules and applying them accurately. The AI should teach one concept clearly, show examples, then drill until it sticks. This is rule-based, not exploratory.

Teaching emphasis: recall — pupils need to identify word classes, apply punctuation rules, and spell statutory list words from memory. Speed and accuracy matter.

Sessions: 8 × 30 minutes
Lesson plan model: mastery — one grammar or punctuation concept per session. Word classes first, then sentence structure, then punctuation marks, then spelling patterns.
Coverage: breadth — the SPaG paper covers a wide range of grammar concepts. Better to touch all topics than go deep on a few.

Assessment targets:
- Score 100+ on scaled score (national expected standard)
- Identify all eight word classes accurately
- Apply apostrophe rules (contraction and possession) without error
- Spell all Year 5/6 statutory word list words

Constraints:
- Never teach grammar concepts above KS2 (no conditional perfect, no gerunds by name)
- Never accept "describing word" for adverb — insist on correct terminology
- Never test surprise spelling words — always tell pupils in advance which words to practise
- Never skip punctuation rules — "commas follow specific rules, they are not just pauses"

Assessment style: formal — track mastery per grammar concept and spelling pattern.

I have teaching documents to upload — past SPaG papers with mark schemes and a course reference guide for how the AI should tutor grammar and spelling.
```

### Documents to upload

| File | Expected classification |
|------|----------------------|
| `course-ref-spag.md` | COURSE_REFERENCE |
| `spag/2024/paper1-questions.pdf` | ASSESSMENT |
| `spag/2024/paper2-spelling.pdf` | ASSESSMENT |
| `spag/2024/mark-schemes.pdf` | ASSESSMENT |
| `spag/2025/paper1-questions.pdf` | ASSESSMENT |
| `spag/2025/paper2-spelling.pdf` | ASSESSMENT |
| `spag/2025/mark-schemes.pdf` | ASSESSMENT |

---

## Shared document (optional — upload with Maths course)

| File | Expected classification | Notes |
|------|----------------------|-------|
| `curriculum/primary-national-curriculum.pdf` | CURRICULUM | Full KS1+KS2 national curriculum. Large file — only upload if you want the complete framework. Can skip. |

---

## Wizard field summary (what the AI should extract)

| Field | Maths | Reading | SPaG |
|-------|-------|---------|------|
| subjectDiscipline | Mathematics | English Language | English Language |
| courseName | KS2 Maths SATs Prep | KS2 Reading SATs Prep | KS2 SPaG SATs Prep |
| **groupName** | **KS2 SATs Prep** | **KS2 SATs Prep** | **KS2 SATs Prep** |
| audience | primary | primary | primary |
| interactionPattern | directive | socratic | directive |
| teachingMode | practice | comprehension | recall |
| sessionCount | 8 | 8 | 8 |
| durationMins | 30 | 30 | 30 |
| lessonPlanModel | mastery | spiral | mastery |
| planEmphasis | depth | balanced | breadth |
| assessments | formal | formal | formal |

All three courses share `groupName: "KS2 SATs Prep"` — they'll appear together under one
PlaybookGroup. Teachers assign the group to a CohortGroup (class), and students in that
class get enrolled in all three courses.
