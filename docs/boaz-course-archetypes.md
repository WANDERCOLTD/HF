# Every course needs its own shape — and ours only has one.

**The short version:** We built HumanFirst around a single hidden assumption about what a "course" looks like. That assumption fits a finance textbook. It doesn't fit English comprehension, it doesn't fit maths, it doesn't fit history, and it doesn't fit exam prep. If we want teachers of any subject to say "this works for my students," we have to let each course type declare its own shape — and we have to do it before we scale.

---

## The situation today

Every HF course, regardless of subject, is set up the same way: the teacher declares a number of sessions, picks a broad "teaching mode," uploads their materials, and hopes the system interprets them correctly. Under the hood, the materials are broken down into facts, definitions, rules and thresholds — the vocabulary of a finance compliance course — and the AI teaches from that pile.

This produces three kinds of silent failure:

1. **Comprehension courses work by accident.** When an English teacher uploads three reading passages, the system treats each passage as an independent topic. It should treat them as *vehicles* for practising inference, main idea, vocabulary and tone — skills that live across all three passages. The AI ends up quizzing learners on isolated facts from a story instead of the comprehension skills the teacher actually wants to build.

2. **Maths courses lose their prerequisites.** A teacher uploading algebra and quadratics assumes the system knows quadratics builds on algebra. It doesn't. Every module is treated as equally reachable. A learner can hit a quadratics question before mastering linear equations, bounce off it, and the system has no way to pull them back.

3. **Exam prep, history, and skills-based subjects have no home at all.** A teacher prepping CFA candidates, or teaching the First World War, or running a vocabulary drill, has to shoehorn their material into the same sessions-and-modules wizard. The resulting courses are technically valid and pedagogically wrong.

## The complications

- **The AI scheduler we're building right now assumes the problem is solved.** Our new "selectNextExchange" function picks the next thing to teach at every moment of every call. It's designed to rotate skills, respect prerequisites, and interleave content. But it can only do any of that if the course model *tells it* what the units are — skills vs topics vs events vs concepts — and how they relate. Without that, the scheduler rotates blindly.

- **Teachers' mental models differ by subject.** A maths teacher thinks in topics with prerequisites. An English teacher thinks in skills practised over texts. A history teacher thinks in events and periods. Forcing them all to fill in the same wizard fields produces the same bad courses dressed in different words.

- **One course can have multiple content sources, and the relationship matters.** In comprehension, each text is a vehicle; in maths, each textbook chapter is reference material; in exam prep, each excerpt is a question-bank. The system currently treats all of these the same.

- **We cannot break existing courses.** Val Moreau's course, the demo accounts, the market-test pilots — all must continue to work silently after any change.

## The options we considered

| Option | What it meant | Why we rejected it |
|---|---|---|
| **Add fields to the schema per subject** | A "module type" column, a "content role" flag, optional prerequisite tables | Every new subject is a database migration. Brittle, doesn't generalise. |
| **Branch on the "teaching mode" field we already have** | Keep the current flow, add `if (subject === 'english')` conditionals | This is what we do today. It's what got us into the finance-shaped bias in the first place. |
| **Build a separate wizard per subject** | Three wizards: one for maths, one for comprehension, one for everything else | Triples maintenance. Every cross-cutting change happens three times. Locks us out of future subjects. |
| **Jump straight to an "outcome graph" / DAG model** | Replace modules entirely with a dependency graph of learning outcomes | Too big a leap. High risk, long timeline, and we'd ship nothing before market test. |
| **Course Archetypes (chosen)** | A small set of named course shapes, declared as data, that the teacher picks at course creation. Each archetype describes module shape, content role, prerequisites, scheduler preset, extraction style, and UI labels. | Reuses infrastructure we already have. Each new course type is a data row, not code. Teacher UX simplifies to one choice. The AI scheduler finally has the semantic shape it needs. |

## What we're going to do

**Six course archetypes, picked at course creation as a single question.** The teacher sees:

> *What kind of course is this?*
> - Topic-based with prerequisites (Maths, Computer Science, Finance)
> - **Skill-based over reading texts** (English comprehension, Literary analysis)
> - Event / period-based (History, Biography)
> - Concept syllabus (CFA, MCAT, ACCA)
> - Practice / drill (Language vocab, coding exercises)
> - Open exploration (General tutor)

That single choice replaces three current wizard fields (session count, teaching mode, learning structure) and silently drives everything downstream:

- **What extraction pulls out of uploaded documents** (inference items and passage spans for comprehension; topics and worked examples for maths; events and consequences for history).
- **How modules are structured** (parallel skills for comprehension; dependency graph for maths; chronological sequence for history).
- **Which AI scheduler preset the system uses** (interleaved rotation for comprehension; exam-prep for concept syllabus; spaced repetition for drill-practice).
- **Whether the system rotates across multiple content sources** (yes for comprehension texts; no for maths chapters).
- **Whether the system says "topic" or "skill" or "event" in the teacher's UI.**

**Teachers edit one thing, the system configures ten.**

## What changes for the teacher

1. **Course setup becomes one question + a subject label.** No more guessing at session counts or teaching modes. The archetype picker is the first and only intent question.
2. **The Curriculum tab becomes the rich view.** It shows the modules of the course in their natural shape — a prerequisite graph for maths, a skill grid for comprehension, a timeline for history — with a class-progress overlay so the teacher sees at a glance how far the cohort has got. Two legacy tabs ("Goals" and "Genome") merge into it.
3. **The Content tab gains meaning for comprehension courses.** Each uploaded passage shows which skills it's practising and how often the system has rotated to it.
4. **The Caller page gains a per-course view.** A learner enrolled in three courses now sees three course cards at the top of their page; clicking one opens a scoped view of that specific course — their personal progress graph, their next exchange, their recent calls in *this* course only.

## What changes for the learner

Invisible plumbing, but the effects are real: the AI teaches English comprehension by reading a passage aloud then asking inference and main-idea questions about it, rather than quizzing random facts; it holds learners back from quadratics until algebra is solid; it rotates across multiple reading texts instead of drilling one to death. The conversational surface is unchanged — only the quality of what the AI chooses to talk about.

## Risks and how we contain them

- **Existing courses must keep working.** Every course without an archetype is auto-mapped to "topic-based" on first read. No teacher intervention needed.
- **Archetype is the teacher's one decision, and we can't let them pick the wrong one.** The picker shows clear examples and one-sentence explanations. Changing archetype later is allowed but shows a "this will re-shape your curriculum" confirmation.
- **Six archetypes may not cover every case.** Acceptable for market test. New archetypes are data rows, not code changes — we can add a seventh the week after a teacher asks for it.
- **The scheduler work (currently in flight) depends on this landing first.** Phase A and B of this plan — the data primitive and the picker — unblock the scheduler's real decisions. They ship first, in roughly two days.

## Timing

Eleven to twelve development days, split into six phases that each ship independently. The first two phases (the data primitive and the picker) land within the first two days and unblock everything downstream. The remaining four phases can be re-prioritised against market test feedback as it comes in.

The alternative is shipping the scheduler into the current finance-shaped course model, discovering at market test that comprehension courses behave oddly, and retrofitting under pressure. This plan does it deliberately, before teachers see it.
