# IELTS Writing Task 2 — Wizard Prompt

Paste this prompt into the V5 wizard chat. Upload the listed docs when prompted.

---

## Wizard prompt

```
I'm setting up an IELTS Academic Writing Task 2 preparation course.

Institution: IELTS Prep Lab
Type: Language school
Subject: IELTS Academic Writing
Course name: Writing Task 2 — Essay Mastery
Audience: higher-ed

The learners are adults preparing for the IELTS Academic exam, typically targeting Band 6.5–7.5. Most are non-native English speakers aiming for university admission.

Teaching approach: socratic — the student writes, the AI coaches revision through targeted questions. Never write for the student.

Sessions: 12 × 25 minutes
Lesson plan model: spiral — revisit essay types across sessions, building on previous feedback.
Coverage: depth — better to master two essay types than skim all five.

Learning outcomes:
- Write a clear thesis statement that directly addresses the Task 2 prompt
- Structure a 4-paragraph essay (intro, body 1, body 2, conclusion) with logical progression
- Use cohesive devices accurately (discourse markers, pronoun reference, substitution)
- Deploy topic-specific vocabulary with precision and avoid repetition
- Produce a range of complex sentence structures with controlled accuracy
- Identify and self-correct common L1 interference errors
- Write 250+ words within 40 minutes

Assessment targets:
- Band 7.0+ on Task Response
- Band 7.0+ on Coherence & Cohesion
- Band 6.5+ on Lexical Resource
- Band 6.5+ on Grammatical Range & Accuracy

Assessment style: formal — track band scores per criterion across sessions.

I have teaching documents to upload — the official assessment criteria, a tutor guide for how the AI should coach writing, sample responses with examiner comments, and an essay types reference.
```

---

## Documents to upload

Upload these during the wizard content step.

### From this directory (already downloaded)

| # | File | Document Type | What it provides |
|---|------|---------------|------------------|
| 1 | `course-ref-writing-task2.md` | COURSE_REFERENCE | Tutor guide — session structure, scaffolding, scoring rules, constraints |
| 2 | `ielts-writing-key-assessment-criteria.md` | COURSE_REFERENCE | What each criterion measures — the scoring rubric |
| 3 | `ielts-sample-responses-examiner-comments.md` | TEXTBOOK | Calibration data — Band 5.5 vs 7.5 with examiner reasoning |
| 4 | `ielts-task2-essay-types-guide.md` | TEXTBOOK | Essay types, structures, example prompts, common topics |

### Download manually and upload

| # | Document | URL | Document Type |
|---|----------|-----|---------------|
| 5 | **Band Descriptors PDF (9 pages)** | `takeielts.britishcouncil.org/sites/default/files/ielts_writing_band_descriptors.pdf` | COURSE_REFERENCE |

This is the most critical document — band-by-band detail for all 4 criteria (Band 9 down to Band 1). Without it the AI knows what to assess but can't place students on the scale.

### Optional (richer content for later)

| # | Document | URL | Document Type |
|---|----------|-----|---------------|
| 6 | Sample responses PDF (5 pages) | `ielts.org/cdn/computer-delivered-sample-tests-academic-writing/ielts-academic-writing-example-responses-to-parts-1-and-2-with-band-scores-and-examiner-comments.pdf` | TEXTBOOK |
| 7 | Writing Task 2 descriptors only | `ielts.org/-/media/pdfs/writing-band-descriptors-task-2.ashx` | COURSE_REFERENCE |

---

## Expected hierarchy after creation

```
Institution: IELTS Prep Lab
  └─ Domain: "IELTS Academic" (or similar)
       └─ Subject: "IELTS Academic Writing"
            └─ Course: "Writing Task 2 — Essay Mastery" (Playbook)
                 └─ Curriculum (auto-generated from extracted assertions)
                      Module: Opinion / Agree-Disagree Essays
                      Module: Discussion Essays
                      Module: Problem-Solution Essays
                      Module: Advantages-Disadvantages Essays
                      Module: Coherence & Cohesion Techniques
                      Module: Lexical Resource & Vocabulary
                      ... (AI decides based on assertion content)
```

Future courses (Writing Task 1, Reading, etc.) would be additional Playbooks under the same Domain, either reusing the "IELTS Academic Writing" Subject or creating new Subjects as appropriate.
