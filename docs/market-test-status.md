# Market Test — Status Report for Boaz

**Date:** 4 April 2026
**Sprint:** 2 (complete)
**Environment:** Ready to deploy to TEST

---

## Phase 1 Exit Gate — All Criteria Met

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Pipeline runs after every call and produces visible results | **Pass** |
| 2 | Adaptation is observable between sessions | **Pass** |
| 3 | Mastery tracking shows progress across sessions | **Pass** |
| 4 | No data loss across sessions and days | **Pass** |

You can begin testing once we deploy to the TEST environment.

---

## What's Built — Your Requirements vs What's Ready

### Course Creation & Setup

| Your Requirement | Status | How to Test |
|-----------------|--------|-------------|
| Create course via wizard | **Working** | Go to Courses → New Course. Upload content, configure sessions. Same wizard you've used before. |
| Create a caller directly (fast-path, no form) | **Working** | Go to the course → Learners tab → Add Caller. Give it a name, hit create. |
| Course content from uploaded materials | **Working** | Upload during wizard. Extraction runs automatically. |

### The Testing Loop

| Your Requirement | Status | How to Test |
|-----------------|--------|-------------|
| Start a sim session | **Working** | Click on a caller → Start Session (or go to `/x/sim/[callerId]`). AI greets you. Have a conversation. End the call. |
| Pipeline runs after each session | **Working** | After ending a session, the pipeline runs automatically. You'll see it in the caller's detail page within a few seconds. |
| View the composed prompt for next session | **Working** | Caller detail page → Prompt Navigator. Three views: Summary (readable), Voice Prompt (what the AI sees), Raw JSON (everything). |
| See what changed between sessions | **Working** | Prompt Navigator has a diff mode — shows line-by-line changes between any two prompts. Click any two prompts to compare. |
| Mastery tracking visible | **Working** | Course → Proof Points tab. Shows per-module mastery bars, average mastery %, completion rate. Per-student mastery in the table. |
| Reset sessions and start over | **Working** | Caller detail page → Reset button. Wipes all session data, pipeline outputs, mastery progress, and prompts. Course and caller stay intact. You can restart immediately. |
| Pause mid-course, come back later | **Working** | Close the browser at any point. When you return and open the same caller, the system picks up exactly where you left off. |
| Run the loop multiple times | **Working** | Reset → run all sessions → reset → run again. No limits. Same course, same caller. |

### Onboarding & Surveys (Built for Phase 3, Available Now)

| Your Requirement | Status | How to Test |
|-----------------|--------|-------------|
| Public join link (blank form) | **Working** | Course → Learners tab → copy the join link. Open in an incognito window. You'll see the registration form. |
| Private join link (pre-filled) | **Working** | Append `?firstName=Test&email=test@example.com` to the join link. Form fields pre-populate. |
| Pre-survey (mandatory, can't skip) | **Working** | Learners see personality questions before their first session. No skip button — they must complete it. |
| Knowledge test (scored MCQ) | **Working** | If MCQ questions are generated for the course, they appear after the personality questions. Answers are scored, baseline stored. |
| Motivation question ("why are you here") | **Working** | Included in the personality survey as the last question. Answer feeds into the AI prompt. |
| Mid-survey (optional, between sessions) | **Working** | If configured, appears between sessions. Learners can skip it. |
| Post-survey (feedback after final session) | **Working** | Appears after the last teaching session. Confidence lift, satisfaction, NPS, free-text feedback. |
| Surveys delivered inline (not a separate page) | **Working** | All surveys render as chat messages within the same interface. No page navigation required. |

### AI Personalisation

| Your Requirement | Status | How to Test |
|-----------------|--------|-------------|
| AI knows the learner from survey data (PRE_LOADED mode) | **Working** | Complete the pre-survey for a caller, then start a session. The AI should use your name and goals from the start — no "what's your name?" questions. |
| AI discovers the learner when no data exists (COLD_START mode) | **Working** | Create a caller directly (no survey) and start a session. The AI should open with a warm welcome and ask for your name, goals, and experience. |
| Final session has reflection/wrap-up guidance | **Working** | On the last session of a course, the AI receives explicit instructions to summarise learning, reflect, celebrate progress, and suggest next steps. |
| Wrong answers logged silently (no correction shown) | **Working** | Answer a knowledge test question incorrectly. The answer is recorded and the AI adapts, but no "that's wrong" message appears in the chat. |

### Data & Reporting

| Your Requirement | Status | How to Test |
|-----------------|--------|-------------|
| Per-student mastery visible | **Working** | Course → Proof Points tab → student table shows Mastery % and Modules completed per student. |
| Module-by-module mastery aggregates | **Working** | Proof Points tab shows a bar chart with average mastery and completion rate for each curriculum module. |
| CSV export | **Working** | Proof Points tab → Export CSV. Includes name, email, confidence, mastery %, modules completed, NPS, satisfaction. |
| Caller detail with full history | **Working** | Click any caller → Journey tab shows all sessions. How tab shows personality and memories. What tab shows scores, targets, goals, module progress. |

### Environment & Stability

| Your Requirement | Status | How to Test |
|-----------------|--------|-------------|
| Stable test environment (data survives dev deploys) | **Working** | TEST environment has its own database. Paul's deployments to DEV do not affect your data. |
| Data persists across restarts | **Working** | All data in PostgreSQL. Environment restarts don't lose anything. |

---

## What's Not Built Yet

### Deferred — Not Needed for Market Test

These are features from your spec that we've deliberately deferred. They're designed for when real educators (not you) use the system. Since you're the only course designer for the market test, they add complexity without value right now.

| Feature | Why Deferred | When It's Needed |
|---------|-------------|-----------------|
| Drag-and-drop session editor (Journey Rail) | You set the session order during course creation. No need to rearrange after. | When external educators design their own courses |
| Survey toggle UI (enable/disable pre/mid/post) | One course, surveys configured in code. | When educators customise their survey strategy |
| Journey validation rules (6 checks before publish) | You won't accidentally put an assessment before a learning session. These rules protect less experienced course designers. | When external educators publish courses |
| Personalisation flag per question | You write all the questions and know which ones the AI should see. | When educators build surveys with mixed reporting/AI questions |
| Question groups with group-level toggle | The existing survey scopes (pre, mid, post, personality, knowledge test) provide natural grouping. | When surveys become more complex |
| Wrong-answer config UI (correct vs log vs conditional) | "Log and move on" is the right default for the market test. | When different courses need different pedagogical approaches |
| Post-assessment trigger config | The post-assessment runs after the final session. | When you need "trigger after N sessions" flexibility |
| Finished learner progress dashboard | Learners see a "journey complete" message. A full dashboard is nice-to-have. | Phase 3 polish |

### Phase 2 — After You've Validated the Testing Loop

| Feature | What It Is | Depends On |
|---------|-----------|------------|
| VAPI voice calls | Voice becomes the primary learning channel (instead of text chat) | Integrating existing VAPI codebase with React |
| WhatsApp registration & nudges | Welcome messages, session reminders, "start when ready" | Integrating existing WhatsApp codebase |
| WhatsApp between-session Q&A | Learners ask the AI tutor quick questions via WhatsApp | WhatsApp integration + prompt composition for Q&A |
| "Start later" after onboarding | Learner completes the form but starts their first session later via WhatsApp | WhatsApp integration |
| Demo journey (investor demos) | Two entry points: fresh course setup, or jump into existing course/caller | VAPI integration |

### Not Yet Surfaced (Data Exists, Display Pending)

| Feature | Current State | Effort |
|---------|--------------|--------|
| Pre/post knowledge test delta as headline metric | Uplift calculation works in the API. Not yet shown as a top-line number on Proof Points. | ~2 hours |
| Statistical significance (σ) for mastery | σ calculation exists for confidence lift. Not yet applied to mastery data. | ~1 hour |

---

## How to Start Testing

1. **We deploy Sprint 2 to TEST** — I'll handle this.
2. **Create your test course** — Courses → New Course → upload content, configure sessions.
3. **Create a test caller** — Learners tab → Add Caller.
4. **Run the loop:**
   - Start a session → have a conversation → end it
   - Go to the caller detail → Prompt Navigator → check the next prompt
   - Start the next session → verify the AI behaves differently
   - Repeat through all sessions
   - Check Proof Points tab → verify mastery accumulation
5. **Reset and repeat** — Caller detail → Reset → start over.

If something breaks or doesn't match your expectations, tell me exactly what you see and what you expected. Screenshots help.

---

## Open Decisions (Need Your Input)

| # | Decision | Context |
|---|----------|---------|
| P6 | Post-assessment trigger | Currently runs after the final session. Do you want a configurable "after N sessions" threshold, or is "after final session" correct for the market test? |
| B1 | Test course content | What content are you uploading for the test course? This affects how many modules the system creates and how mastery tracking works. |
| B5 | Post-assessment threshold | Same as P6 — how many sessions before the post-test? Or just "after the last session"? |
