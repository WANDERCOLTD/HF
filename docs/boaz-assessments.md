# Assessments — How We Should Think About Them

> Discussion paper for Boaz. 2026-04-15.

---

## Governing thought

**Assessments should be two separate things: automatic retrieval questions the system fires during every lesson, and an optional pre-test / post-test pair the teacher turns on for uplift reporting.**

## Key line

1. **Retrieval during lessons must be automatic and always on**, because asking learners to recall information is the single most effective learning move we have — not a measurement of learning.
2. **Pre-test and post-test must default on for every enrolled learner**, because the gap between the two scores is the cleanest evidence we can give funders and schools that our product works.
3. **The teacher's only control should be one card with two switches**, because asking teachers to schedule or tune assessments is a cost with no educational upside.

---

## Situation

We are rebuilding the learning schedule. Fixed "sessions" are going away, replaced by a flexible model where the system decides what to teach next based on what the learner has mastered.

## Complication

Our current assessment design is stapled to sessions — pre-test on session one, mid-test at the halfway mark, post-test after the last session. When sessions go away, the staples fall off. At the same time, the market test needs pre/post uplift numbers as evidence for funders and schools, and we cannot afford to lose them. We have to decide what replaces the session-stapled design **before** the new schedule work lands.

## Question

How should we think about assessments in a world without sessions, while still producing uplift evidence and still respecting what educational research says about how people learn?

## Answer

See the governing thought above. The rest of this paper supports each of the three key-line points in turn.

---

## 1. Retrieval during lessons must be automatic and always on

Fifty years of research (Roediger, Karpicke, Bjork) has converged on a single finding: **being asked a question and recalling the answer strengthens memory more than re-reading or re-listening for the same amount of time**. This is the testing effect, or retrieval practice. Quick questions during lessons are not tests in the old sense — they are the single most effective teaching move we have.

This has two consequences.

**First: a course that runs for ten sessions without a single retrieval question is pedagogically broken**, no matter how good the content is. We cannot allow that failure mode to be possible. Retrieval has to happen regardless of what a teacher configures.

**Second: there must be no teacher switch for retrieval**, because giving a teacher a switch to turn off the most effective learning move is the wrong product to build. Teachers pick a course type ("Maths", "English comprehension", "CFA prep") and the system decides how much retrieval that course type needs, based on the research. Vocabulary drill fires retrieval questions every exchange. A general-purpose tutor fires them less often. The teacher never sees these knobs.

## 2. Pre-test and post-test must default on for every enrolled learner

Pre-test and post-test do something different from retrieval. They capture a before-and-after score so we can say "this learner improved by 28 percentage points." That number is the single most legible output of our system to a non-technical audience. It is what sells the product to a university, a training company, a donor, or a parent.

It is also **optional from a learning standpoint** — a well-taught course with frequent retrieval produces the same learning whether or not it is bookended by formal pre and post tests. But we still want both on by default, **because the market test needs those numbers on every enrolled learner**, not on the subset of courses where a teacher remembered to switch them on.

Teachers can turn them off for specific courses where they do not fit (a free-form exploration course, for example), but the default is on and they have to actively decide to disable it. Comprehension courses are the one exception: the pre-test is silently skipped because there is no passage loaded yet at course start, and there is nothing to pre-test without one.

## 3. The teacher's only control should be one card with two switches

Teachers are educators, not assessment designers. They should not be asked to decide how often retrieval fires, which selection strategy to use, or at which session number to place a test. Those questions either do not make sense any more (sessions are going away) or are answered automatically by the course type they pick at the start.

The teacher's entire control surface over assessments should be one card with three fields: pre-test on/off, post-test on/off, number of questions. That is the whole screen.

```
┌─ Assessments ────────────────────────────┐
│                                          │
│  [✓] Pre-test at course start            │
│      Measures baseline knowledge.        │
│      Questions: [ 5 ]                    │
│                                          │
│  [✓] Post-test at course end             │
│      Measures learning gain (uplift).    │
│      Uses the same questions as pre-test.│
│                                          │
│  ⓘ Quick retrieval questions during      │
│     lessons are always on — they're      │
│     how people learn.                    │
└──────────────────────────────────────────┘
```

The info line at the bottom is the load-bearing piece. It acknowledges that retrieval exists, explains why it is not a setting, and reframes "quick questions" as a learning tool rather than a test.

---

## What you are being asked to agree to

1. **The split.** Two separate things, built differently, one invisible to teachers, one visible.
2. **Uplift as mandatory market-test evidence.** Pre and post default on for every enrolled learner unless a teacher actively disables them.
3. **Folding this into the CourseArchetype plan.** Each of the six course types (Maths topic-DAG, English comprehension, history events, exam-prep concept syllabus, vocabulary drill, general tutor) declares its own default retrieval frequency and its own default pre/post behaviour.

## Out of scope for this decision

- **How often retrieval fires inside a lesson** — the scheduler's job, a separate piece of work already in plan.
- **Confidence-weighted answering** ("sure / guessing") — a related improvement, not on the critical path, defer.
- **Voice calls** — already do retrieval through conversation, no change needed.

## Status

- The CourseArchetype plan has been updated with a new section naming both tracks and their per-archetype defaults *(2026-04-15)*.
- An independent selector bug in the current code has shipped *(2026-04-15, [#161](https://github.com/paw2paw/HF/issues/161))*.
- Track implementation waits for the outcome-graph scheduler.
