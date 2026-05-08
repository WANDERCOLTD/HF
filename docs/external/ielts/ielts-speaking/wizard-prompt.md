# IELTS Speaking Practice — Wizard Prompt

Paste this prompt into the V5 wizard chat. Upload the listed docs when prompted.

---

## Wizard prompt

```
I'm setting up an IELTS Speaking preparation course.

Institution: IELTS Prep Lab
Type: Language school
Subject: IELTS Speaking
Course name: IELTS Speaking Practice
Audience: higher-ed

The learners are adults preparing for the IELTS Academic or General Training exam, typically targeting Band 6.5–7.5. Most are non-native English speakers aiming for university admission or professional registration. The Speaking test is identical for both Academic and General Training.

Teaching approach: socratic — the student speaks, the AI examines and coaches through targeted questions. Never answer for the student.

Calls: ~12 × 20 minutes (continuous — no fixed plan, the system adapts to the learner)
Coverage: depth — better to master two Speaking Parts than skim all three.

Learning outcomes:
- Speak fluently for 2+ minutes on an unfamiliar topic with minimal hesitation
- Extend Part 1 answers beyond one sentence with reasons, examples, and personal experience
- Structure a Part 2 monologue using all cue card bullet points with logical progression
- Engage in abstract Part 3 discussion using hedging, speculation, and balanced argument
- Use a range of discourse markers naturally to connect ideas ("having said that", "what I mean is")
- Deploy topic-specific vocabulary with precision and paraphrase to avoid repetition
- Produce a range of complex sentence structures accurately in spontaneous speech
- Self-correct pronunciation errors that impede intelligibility

Assessment targets:
- Band 7.0+ on Fluency & Coherence
- Band 6.5+ on Lexical Resource
- Band 6.5+ on Grammatical Range & Accuracy
- Band 6.5+ on Pronunciation

Assessment style: formal — track band scores per criterion across calls.

I have teaching documents to upload — the official assessment criteria, the band descriptors, and a course reference with the teaching approach and skills framework.
```

---

## Documents to upload

Upload all files from this folder during the wizard content step.

| # | File | Document Type | What it provides |
|---|------|---------------|------------------|
| 1 | `course-ref.md` | COURSE_REFERENCE | Skills framework (4 IELTS criteria with tiers), Socratic teaching approach, call flow, scoring rules, scaffolding techniques, L1 interference patterns, Part structure, edge cases |
| 2 | `speaking-key-assessment-criteria.pdf` | COURSE_REFERENCE | What each of the 4 criteria measures — the official scoring rubric definitions |
| 3 | `speaking-band-descriptors-cdn.pdf` | COURSE_REFERENCE | Band-by-band detail for all 4 criteria (Band 9 down to Band 1) |
| 4 | `cambridge-speaking-band-descriptors.pdf` | COURSE_REFERENCE | Cambridge public version of band descriptors (alternative format) |
| 5 | `ielts-speaking-key-assessment-criteria.md` | COURSE_REFERENCE | Markdown version of the 4 criteria with full Band 1–9 descriptors verbatim. Machine-readable scoring rubric. |
| 6 | `ielts-speaking-test-format.md` | COURSE_REFERENCE | 3-Part structure, timings, examiner protocol, what the interlocutor can/cannot do, recording and re-mark process |
| 7 | `ielts-speaking-question-types-guide.md` | TEXTBOOK | Taxonomy of question types — Part 1 topic categories, Part 2 cue-card frames, Part 3 abstract patterns with example stems |
| 8 | `ielts-speaking-question-bank-part1.md` | QUESTION_BANK | 50+ Part 1 topic frames × 4–6 questions each. Tagged by source. |
| 9 | `ielts-speaking-question-bank-part2.md` | QUESTION_BANK | 88 Part 2 cue cards in the official 4-bullet form, clustered by frame (Person / Place / Object / Event / Experience / Activity) |
| 10 | `ielts-speaking-question-bank-part3.md` | QUESTION_BANK | 64 Part 3 discussion sets × 4–6 abstract questions each. Organised by 13 themes. Linked to Part 2 topics. |
| 11 | `ielts-speaking-sample-responses-examiner-comments.md` | TEXTBOOK | Calibration data — Bands 5, 6, 7, 8 sample responses across all 3 Parts with criterion-by-criterion examiner reasoning |
| 12 | `ielts-speaking-language-toolkit.md` | TEXTBOOK | Phrase banks for Band 6→7→8: discourse markers, hedging, paraphrase, opinion, signposting, idiomatic chunks, collocations, conditional structures, pronunciation features. Tied to which criterion each lifts. |
| 13 | `ielts-speaking-cefr-mapping.md` | REFERENCE | IELTS Band ↔ CEFR level table with criterion-by-criterion crosswalk to CEFR Companion Volume sub-scales. UKVI / SELT recognition note. |

---

## Expected hierarchy after creation

```
IELTS Prep Lab (Institution)
  └─ IELTS (Domain)
       └─ IELTS Speaking (Subject)
            └─ IELTS Speaking Practice (Playbook)
                 └─ Curriculum (auto-generated)
                      Module: Part 1 — Familiar Topics
                      Module: Part 2 — Cue Card Monologues
                      Module: Part 3 — Abstract Discussion
                      ... (AI decides from content)
```
