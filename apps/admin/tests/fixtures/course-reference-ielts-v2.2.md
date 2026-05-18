# Course Reference — IELTS Speaking Practice (Seed Edition)

> **Document type:** COURSE_REFERENCE
> **Built from:** HumanFirst Course Reference Template v5.1 — seed fixture
> **Version:** 2.2-seed
> **Status:** Seeded
> **Modules authored:** Yes — see `## Modules` below. The Module list is authoritative.

This document is the canonical IELTS Speaking course reference used by `prisma/seed-ielts-course.ts` to seed an end-to-end IELTS playbook into dev and test environments. It is intentionally shorter than the human-authored wizard reference at `lib/wizard/__tests__/fixtures/course-reference-ielts-v2.2.md` — the seed only needs enough content for the projection pipeline (`projectCourseReference` + `applyProjection`) to produce a parseable course with Skills, Outcomes, Modules, and Goal templates.

---

## Course Configuration

**Course name:** IELTS Speaking Practice
**Subject / qualification:** IELTS Speaking
**Delivery:** Voice-only, 15-20 minute sessions
**Target band range:** 6.0 – 7.5 (IELTS Academic or General Training)
**Student audience:** Adult learners with B1+ general English, preparing for the IELTS Speaking test

### Teaching approach

Directive correction-retry cycle with optional Socratic mode for self-diagnostic learners. The tutor names the single most score-limiting issue after each answer, provides the correction, and asks for an immediate retry. Theory is embedded in practice — never standalone lectures. Target speech ratio ~80% student / ~20% tutor.

### Teaching emphasis

Practice over theory. Spoken performance with correction, repeated many times, against the four IELTS criteria.

---

## Skills Framework

The four IELTS Speaking criteria, each measured independently per the official assessor rubric. Tier descriptors are calibrated to IELTS Band ranges (Emerging ≈ Band 4–5, Developing ≈ Band 5.5–6.5, Secure ≈ Band 7+).

### SKILL-01: Fluency and Coherence

The ability to speak at length without unnatural hesitation, with logical organisation of ideas and effective use of cohesive devices.

- **Emerging:** Speech is hesitant with frequent self-corrections and long pauses for language search. Connectives are limited to basic markers (and, but, because). Coherence breaks down across the long turn.
- **Developing:** Speech flows but with noticeable pauses at clause boundaries. A wider range of discourse markers (however, on the other hand, in addition) appears, though not always accurately. Coherence holds across short turns but wobbles across the Part 2 monologue.
- **Secure:** Speech flows naturally at length with only occasional repetition or self-correction characteristic of native-speaker speech. A flexible range of discourse markers signals turn-management, topic shifts, and rhetorical relationships. The Part 2 monologue is coherent end-to-end.

### SKILL-02: Lexical Resource

The range, accuracy, and appropriacy of vocabulary, including idiomatic and less common usage.

- **Emerging:** Vocabulary is sufficient for familiar topics but breaks down on abstract themes. Frequent paraphrase and circumlocution to cover lexical gaps. Word choice often sounds written rather than spoken.
- **Developing:** Vocabulary covers most topics with some flexibility. Some less common items and collocations appear but use is occasionally inaccurate. The register is mostly appropriate for spoken English.
- **Secure:** Vocabulary is wide and used flexibly, including less common and idiomatic items. Topic-specific collocations are accurate. Register is consistently appropriate for the speaking context.

### SKILL-03: Grammatical Range and Accuracy

The variety of grammatical structures used and the accuracy with which they are produced.

- **Emerging:** A limited range of structures with frequent errors that sometimes impede meaning. Basic sentence patterns dominate. Tense use is inconsistent across the long turn.
- **Developing:** A mix of simple and complex structures. Errors persist in complex structures but rarely impede communication. Tense variety appears within turns.
- **Secure:** A wide range of structures used flexibly and largely accurately. Complex structures (conditionals, relative clauses, passive voice) appear without error. Tenses are varied across past, present, and future within a single turn.

### SKILL-04: Pronunciation

The intelligibility of speech, including individual sound production, word and sentence stress, and intonation.

- **Emerging:** Pronunciation is intelligible most of the time but specific phonemes cause confusion. Word stress is often misplaced. Intonation is flat or monotonal.
- **Developing:** Speech is intelligible throughout with occasional mispronunciation of less common words. Word stress is mostly correct. Some intonation variation appears, though not always for meaning.
- **Secure:** Highly intelligible. Stress is used effectively, including contrastive stress for emphasis. Intonation is varied and natural, used to signal meaning, attitude, and turn-taking. Pronunciation features that remain are first-language accent rather than errors.

---

## Outcomes

The course works through a focused set of learning outcomes across the three IELTS Speaking parts plus the two scoring modules.

**OUT-01: Extends Part 1 answers to the 2–3 sentence minimum with reasons and examples.**
The learner can answer a Part 1 question with a complete 2–3 sentence response that includes one reason and one personal example, rather than a bare yes/no.

**OUT-02: Selects a framework opening matched to the Part 1 question type.**
The learner can choose one of nine opening templates (preference, frequency, comparison, opinion, factual, hypothetical, descriptive, narrative, evaluative) and deploy it without hesitation.

**OUT-03: Recovers from unknown Part 3 topics without freezing.**
The learner can use hedging frames ("I haven't thought about this in detail, but my first instinct would be...") to keep speaking when faced with an unfamiliar abstract topic.

**OUT-04: Sustains the Part 2 long turn for the full 2 minutes.**
The learner can speak continuously for 2 minutes on a cue card topic without giving up early or asking the tutor to move on.

**OUT-05: Addresses all cue card bullets with logical progression.**
The learner can cover each bullet on a Part 2 cue card with at least 20 seconds of content per bullet, organised in a logical sequence.

**OUT-06: Uses one of four Part 3 extension techniques per answer.**
The learner can reliably deploy reasons, contrast, examples, or hedging to extend Part 3 answers to the 3–4 sentence target length.

**OUT-07: Varies tenses across past, present, and future within a single turn.**
The learner produces narrative answers that move naturally between tenses (e.g. describing a past event, evaluating it in the present, predicting future implications).

**OUT-08: Controls the Band 7 grammar error pattern on complex sentences.**
The learner produces conditional, relative, and passive structures without the recurring article-missing / preposition-confusion errors that typically cap learners at Band 6.5.

---

## Modules

**Modules authored:** Yes
**Module count:** 4
**Module picker:** Learner-driven.

### Module Catalogue (machine-readable summary)

| ID | Label | Learner-selectable | Mode | Duration | Frequency | Outcomes (primary) |
|---|---|---|---|---|---|---|
| `baseline` | Baseline Assessment | Yes | Examiner | 20 min | Once | OUT-01, 02, 04 |
| `part1` | Part 1: Familiar Topics | Yes | Tutor | Student-led | Repeatable | OUT-01, 02 |
| `part2` | Part 2: Cue Card Monologues | Yes | Mixed | Student-led | Repeatable | OUT-04, 05, 07 |
| `part3` | Part 3: Abstract Discussion | Yes | Tutor | Student-led | Repeatable | OUT-03, 06, 08 |

### Module Defaults (apply unless overridden by a Module)

- **Default mode:** Tutor.
- **Default correction style:** Single-issue loop (acknowledge → name one issue → correct → retry).
- **Default theory delivery:** Embedded in practice only — no standalone lectures. Target ratio ~80% student speech, ~20% tutor.
- **Default band visibility (mid-module):** Hidden. Bands surface only at module-end feedback.
- **Default intake:** None.

### Module 1 — Baseline Assessment

**What it is.** A one-off 20-minute diagnostic that walks the student through all three IELTS Speaking parts at exam pace, producing an initial indicative band per criterion.

**Duration.** 20 minutes, fixed.

**Mode.** Examiner mode throughout — the tutor does not correct or coach during the student's answers.

**Scoring.** All four criteria scored. Fluency & Coherence and Pronunciation from the Part 2 monologue; Lexical Resource and Grammatical Range from the full transcript.

**Outcomes targeted (primary):** OUT-01 (Part 1 extension), OUT-02 (framework openings), OUT-04 (Part 2 sustain).

### Module 2 — Part 1: Familiar Topics

**What it is.** Practice of the first part of the IELTS Speaking test — short questions on familiar everyday topics requiring 2–3 sentence answers opened with one of nine framework templates.

**Duration.** Student-led.

**Mode.** Tutor mode.

**Scoring.** Lexical Resource and Grammatical Range from the full transcript at module end. FC and Pron not scored from Part 1 alone (answers too short).

**Outcomes targeted (primary):** OUT-01 (extends to minimum length), OUT-02 (framework openings matched to question type).

### Module 3 — Part 2: Cue Card Monologues

**What it is.** Practice of the 2-minute monologue with 1 minute of preparation, addressing all bullets on a cue card in logical sequence.

**Duration.** Student-led — typically 8–10 minutes per drill.

**Mode.** Mixed — silent preparation, examiner-mode monologue, tutor-mode feedback.

**Scoring.** All four criteria scored at module end.

**Outcomes targeted (primary):** OUT-04 (sustains 2 minutes), OUT-05 (addresses all bullets with progression), OUT-07 (varies tenses within a single turn).

### Module 4 — Part 3: Abstract Discussion

**What it is.** Practice of abstract follow-up questions thematically connected to the Part 2 topic. Tests opinion, comparison, hypothetical, problem-solution, and evaluation question types.

**Duration.** Student-led.

**Mode.** Tutor mode.

**Scoring.** Lexical Resource and Grammatical Range from the full transcript. FC and Pron not scored from Part 3 alone.

**Outcomes targeted (primary):** OUT-03 (recovers from unknown topics), OUT-06 (uses extension techniques), OUT-08 (Band 7 grammar control).

---

## Assessment Boundaries

The course produces indicative band scores per criterion at the end of Baseline and after any Mock Exam-style session. Bands shown on screen are always labelled "indicative" — they are not official IELTS scores. The tutor does not promise a specific band on the real test; instead it grounds feedback in observed performance against the rubric tiers in the Skills Framework above.

---

## Edge Cases

- **Student wants to skip Baseline.** Allowed. Practice modules unlock without it, but no per-skill scores are produced until at least one Mock Exam runs.
- **Student declines Part 2.** Allowed, but the tutor surfaces that FC and Pron cannot be scored without a Part 2 monologue sample.
- **Student speaks below B1.** The tutor recommends a more appropriate course and exits gracefully.
- **Student requests Socratic style.** The tutor switches to asking the student to identify their own errors before naming them.
