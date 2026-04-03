# Learner Join Flow

How a learner goes from receiving a course link to their first AI tutoring session.

---

## Overview

```
Educator shares link  →  Learner clicks  →  Join page  →  Auto sign-in  →  Onboarding  →  Survey  →  First call
```

The entire flow is **zero-friction**: no password creation, no email verification, no app download. One link, one form, straight into learning.

---

## Step 1: Educator Shares a Link

The educator copies a **magic join link** from their course's Learners tab:

```
https://lab.humanfirstfoundation.com/join/abc123def456
```

This link is tied to a specific classroom (cohort). The educator can share it via email, WhatsApp, classroom notice board, or any channel.

**Optional:** The link can pre-fill learner details:
```
/join/abc123?firstName=Sarah&lastName=Jones&email=sarah@school.com
```
When all fields are pre-filled, the learner joins instantly without typing anything.

---

## Step 2: Join Page

The learner sees a branded page with their institution's logo and a welcome message:

```
┌─────────────────────────────────┐
│                                 │
│      [School Logo]              │
│                                 │
│    Join Year 10 Biology         │
│                                 │
│  "Welcome to Greenfield Academy │
│   — where every learner         │
│   thrives."                     │
│                                 │
│  First Name  [...............]  │
│  Last Name   [...............]  │
│  Email       [...............]  │
│                                 │
│     [ Join Classroom ]          │
│                                 │
└─────────────────────────────────┘
```

- The button uses the institution's brand colour
- Community groups show "Join Community" instead
- If the email already has an account, they're directed to sign in

**What happens behind the scenes:**
- A student account is created automatically
- The learner is enrolled in the course
- A session cookie is set (auto-sign-in — no login step)

---

## Step 3: Onboarding (First Visit Only)

On their first visit, the learner sees a 4-step welcome wizard:

| Step | What the learner sees |
|------|-----------------------|
| 1. Welcome | Institution branding, teacher's name, personalised welcome message |
| 2. Your Goals | Learning goals set by the teacher — learner can confirm or add their own |
| 3. How It Works | Brief explanation: personalised AI tutor, goal-driven, natural conversation |
| 4. Ready | "Start Your First Conversation" button |

The learner can skip this at any point.

---

## Step 4: Pre-Course Survey

Before the first tutoring session, the learner completes a short survey in a **chat-style interface** (feels like messaging, not a form):

### Phase 1: About You (~30 seconds)

```
🤖  Hey! I'm your AI study partner for Biology.
    Mrs Smith set this up for you. Before we
    dive in, I'd love to learn a bit about you.

🤖  How confident are you in Biology?
    ⭐⭐⭐⭐⭐

🤖  How much do you already know about this topic?
    [ Never studied ] [ A little ] [ Know the basics ] [ Know it well ]
```

### Phase 2: Knowledge Check (if configured)

```
🤖  Now let's do a quick knowledge check — just 5
    questions. Don't worry about getting them right,
    this just helps me understand where you're
    starting from.

🤖  What is the powerhouse of the cell?
    ○ Nucleus
    ○ Mitochondria  ←
    ○ Ribosome
    ○ Cell membrane
```

**Why this matters:** The AI tutor uses the pre-test score to calibrate its first session. A learner who scores 80% gets different questions than one who scores 20%.

---

## Step 5: First Tutoring Session

The learner enters the **sim chat** — a web-based conversation with their AI tutor. The tutor already knows:
- The learner's confidence level and pre-test score
- The course content and teaching goals
- What session they're on and what to cover

---

## Step 6: Ongoing Journey

The system tracks where each learner is on their **learning journey**:

```
[Pre-Survey] → [Session 1] → [Session 2] → ... → [Mid-Survey] → ... → [Final Session] → [Post-Survey]
     ✓             ✓            ● current
```

- Returning learners pick up exactly where they left off
- Mid-course surveys check in on progress
- After enough sessions, a post-survey measures improvement
- The educator sees all of this on their dashboard

---

## Data Collected

| When | What | Purpose |
|------|------|---------|
| Join | Name, email | Account + communication |
| Pre-survey | Confidence, prior knowledge | Baseline for measuring improvement |
| Pre-test | Subject knowledge score | Calibrate AI difficulty |
| Each session | Transcript, topics covered, engagement | Adaptive teaching |
| Post-survey | Confidence, satisfaction, NPS | Evidence of improvement |
| Post-test | Subject knowledge score | Measure 2-sigma improvement |

---

## Edge Cases

| Scenario | What happens |
|----------|-------------|
| Link expired | "This join link has expired" message |
| Link invalid | "Invalid or expired join link" message |
| Already a member | "Please sign in instead" with login link |
| Existing account, new course | Added to the new classroom, no new account |
| Pre-filled link with all fields | Joins instantly, no form shown |
| No pre-test configured | Knowledge check phase is skipped automatically |
| Learner returns after gap | Picks up at their current journey position |

---

## For Educators

To get started:
1. Create a course using the Build Course wizard
2. Go to the **Learners** tab on your course
3. Copy the **magic join link**
4. Share with your students

That's it. Students handle the rest themselves.
