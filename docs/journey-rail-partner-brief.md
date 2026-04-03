<!-- MAINTENANCE: Update this doc when stop types or survey logic changes.
     Technical reference: ~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-journey-stops.md
     Contract source: docs-archive/bdd-specs/contracts/session-types-v1-contract.json -->

# The Learning Journey

## How HumanFirst courses work — and what's changing

---

## What is it?

Every HumanFirst course is a **journey** — a sequence of steps that guide a learner from their first interaction to course completion. Some steps are conversations with the AI tutor. Others are quick surveys that capture how the learner is feeling.

The **Journey Rail** is how educators set up, visualise, and manage this sequence.

---

## Before & After

### Before

| Area | How it works today |
|------|-------------------|
| **Course setup** | Educator says "I want 4 sessions" — system creates 4 learning calls plus a first call and a last call |
| **Surveys** | Survey questions are buried inside the first-call configuration. Hard to find, hard to customise. |
| **Managing the course** | Two separate views: one for the first/last call setup, another for the session plan. Educator has to bounce between them. |
| **Learner experience** | Every learner starts with a survey form, then their first call. No way to skip. No mid-course check-in. |
| **Returning learners** | System doesn't know where the learner left off — always sends them to the welcome page. |

### After

| Area | How it will work |
|------|-----------------|
| **Course setup** | Educator says "4 sessions" — system creates the full journey: optional pre-survey, first call, 4 learning sessions, last call, optional post-survey. All visible on one rail. |
| **Surveys** | Surveys are their own step on the journey. Educator can enable/disable pre-survey, mid-survey, and post-survey with one toggle. Default questions provided, fully customisable. |
| **Managing the course** | One view. One rail. Click any step to expand and edit it. Add, remove, reorder steps inline. |
| **Learner experience** | Each survey is skippable per learner. Learners who don't want to answer can skip straight to their session. |
| **Returning learners** | System knows exactly where each learner is on the journey and sends them to the right step automatically. |

---

## The Educator Experience

### Creating a course

During course setup, the educator sees a simple checklist:

- **Pre-Survey** (on by default) — "Ask learners about their goals and confidence before they start"
- **Mid-Survey** (off by default) — "Check in with learners halfway through"
- **Post-Survey** (on by default) — "Gather feedback and satisfaction at the end"

Each survey comes with sensible default questions that the educator can customise or leave as-is.

### Managing the journey

The educator sees the full journey as a visual rail:

```
  Pre-Survey          [optional]
  |
  First Call           welcome, orientation, discovery
  |
  Learn 1              Introduction to topic
  |
  Learn 2              Deeper exploration
  |
  Mid-Survey           [optional]  — "How are you finding the course?"
  |
  Learn 3              Practice and application
  |
  Learn 4              Review and consolidation
  |
  Last Call             reflection, celebration, goodbye
  |
  Post-Survey          [optional]  — NPS, satisfaction, feedback
```

**What educators can do on this rail:**

- **Click any step** to expand and see/edit its details
- **Add a step** between any two existing steps
- **Remove a step** they don't need
- **Change the type** of a learning session (e.g., from "Learn" to "Review" or "Assessment")
- **Mark steps as optional** — learners can choose to skip them
- **Drag to reorder** learning sessions (first call and last call stay pinned)
- **Toggle surveys on/off** — one click to enable or disable any survey

### Editing survey questions

When an educator expands a survey step, they see the questions with simple controls:

- Add or remove questions
- Choose question type: star rating, multiple choice, free text, or Net Promoter Score
- Reorder questions by dragging
- Preview exactly what the learner will see

### Where survey questions come from

Survey questions follow a three-level system:

1. **System defaults** — HumanFirst provides sensible starting questions for every survey
2. **Organisation overrides** — An organisation can set their own standard questions across all courses
3. **Course customisation** — Each educator can further tailor questions for their specific course

This means a new educator gets great defaults out of the box, while experienced users can fully customise.

---

## The Learner Experience

### First visit (new learner)

1. **Click the join link** shared by their teacher
2. **Enter name and email** — account created automatically
3. **Pre-Survey** — a friendly chat-style form asking about goals and confidence (skippable)
4. **First call** — AI tutor introduces itself, sets expectations, begins teaching
5. **Learning sessions** — series of practice conversations with the AI
6. **Mid-Survey** (if enabled) — quick check-in: "How are you finding the course?"
7. **More learning sessions**
8. **Last call** — AI reflects on progress, celebrates achievements, says goodbye
9. **Post-Survey** — satisfaction rating, NPS, open feedback (skippable)

### Returning learner

The system remembers exactly where each learner is on their journey. When they return:

- If they're mid-course, they go straight to their next session
- If they have an incomplete survey, they're prompted to complete it (or skip)
- If they've finished everything, they see their progress dashboard

### Skipping

Every survey is optional for learners. They see a simple choice:

> **Quick Survey (2 min)**
> Your teacher has a few questions.
>
> [Start Survey]  &nbsp;&nbsp;&nbsp; [Skip]

If they skip, the system records it and moves them to their next step. No friction.

---

## What data is captured and how it's used

### Surveys capture structured data

| Survey | What's asked | How it's used |
|--------|-------------|---------------|
| **Pre-Survey** | Confidence level, prior knowledge, learning goals, concerns | AI tutor personalises its approach based on the learner's starting point |
| **Mid-Survey** | How they're feeling, satisfaction so far, areas needing help | Educator can intervene early if a learner is struggling |
| **Post-Survey** | Confidence improvement, overall satisfaction, NPS, open feedback | Educator sees impact evidence; aggregated across the course for reporting |

### Where educators see the results

- **Per-learner view** — click any learner to see their individual survey responses (pre, mid, post side by side)
- **Course-level view** — aggregated statistics: average NPS, satisfaction distribution, confidence lift from start to end
- **Export** — download all survey data as CSV for external reporting

### How the AI uses survey data

The AI tutor reads the pre-survey answers before the first call. If a learner said:
- *"I'm not confident at all"* — the AI starts gently, builds up gradually
- *"My goal is to pass my exam"* — the AI focuses on exam-relevant material
- *"I struggle with the maths side"* — the AI gives extra attention to mathematical concepts

This personalisation happens automatically. The educator doesn't need to configure it.

---

## Two types of step

The journey has two distinct types of interaction:

| Type | What the learner does | Example |
|------|----------------------|---------|
| **Survey** (form) | Answers questions on screen — star ratings, multiple choice, free text | Pre-Survey, Mid-Survey, Post-Survey |
| **Session** (conversation) | Has a voice or chat conversation with the AI tutor | First Call, Learn 1-4, Last Call |

Surveys are quick web forms. Sessions are rich AI conversations. They never overlap — a survey is never part of a call, and a call never includes a form.

---

## Key benefits

### For educators
- **One place to manage everything** — no more switching between tabs
- **Surveys are visible and controllable** — not hidden in configuration
- **Flexibility** — add, remove, reorder any step; toggle surveys on/off
- **Smart defaults** — works great out of the box, fully customisable when needed

### For learners
- **No friction** — surveys are optional, skippable, and quick
- **Always in the right place** — system remembers where they left off
- **Personalised from day one** — AI adapts based on survey responses

### For the organisation
- **Standard survey templates** — set once at the organisation level, applies to all courses
- **Evidence of impact** — pre/post confidence lift, NPS, satisfaction — all captured automatically
- **Scalable** — works the same whether you have 10 learners or 10,000
