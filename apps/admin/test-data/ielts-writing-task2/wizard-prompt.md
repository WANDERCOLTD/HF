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

Calls: ~12 × 25 minutes (continuous — no fixed plan, the system adapts to the learner)
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

Assessment style: formal — track band scores per criterion across calls.

I have teaching documents to upload — the official assessment criteria, a tutor guide for how the AI should coach writing, sample responses with examiner comments, and an essay types reference.
```

---

## Documents to upload

Upload these during the wizard content step.

### From this directory (4 files)

| # | File | Document Type | What it provides |
|---|------|---------------|------------------|
| 1 | `course-ref-writing-task2.md` | COURSE_REFERENCE | Skills framework (4 IELTS criteria with tiers), Socratic teaching approach, call flow, scoring rules, scaffolding techniques, L1 interference patterns, edge cases |
| 2 | `ielts-writing-key-assessment-criteria.md` | COURSE_REFERENCE | What each of the 4 criteria measures — the official scoring rubric definitions |
| 3 | `ielts-sample-responses-examiner-comments.md` | TEXTBOOK | Calibration data — Band 5.5 vs 7.5 with examiner reasoning |
| 4 | `ielts-task2-essay-types-guide.md` | TEXTBOOK | Essay types, structures, example prompts, common topics |

### Download manually and upload (1 file)

| # | Document | URL | Document Type |
|---|----------|-----|---------------|
| 5 | **Band Descriptors PDF (9 pages)** | `takeielts.britishcouncil.org/sites/default/files/ielts_writing_band_descriptors.pdf` | COURSE_REFERENCE |

This is the most critical document — band-by-band detail for all 4 criteria (Band 9 down to Band 1). Without it the AI knows what to assess but can't place students on the scale.

---

## What to watch for in the demo

These are the moments that show what HumanFirst does:

1. **Wizard chat** — paste the prompt, watch the wizard extract institution, domain, course name, teaching approach, and learning outcomes from natural language
2. **Content upload** — drop all 5 files, watch the AI classify each one (COURSE_REFERENCE vs TEXTBOOK) and group them into a single subject
3. **Extraction** — the system pulls teaching assertions from the course ref (scoring rules, scaffolding techniques, L1 patterns) and content assertions from the textbooks (essay structures, sample responses)
4. **Skills framework** — the 4 IELTS criteria appear as skills with Emerging/Developing/Secure tiers, ready for the AI tutor to score against
5. **Adaptive prompting** — on a live call, the composed prompt includes the Socratic teaching rules, the scoring rules, and the scaffolding techniques from the course ref — the tutor behaves differently because of what the educator uploaded

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
                      ... (AI decides based on content)
```

Future courses (Writing Task 1, Reading, etc.) would be additional Playbooks under the same Domain.
