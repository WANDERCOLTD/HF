# HumanFirst — First Course: Build Specification

> **Purpose:** Define the approach and detailed spec for getting HumanFirst from "components that work individually" to "a complete system that runs a real course with real students." This document lives in the GitHub repo and is the single source of truth for what we're building and in what order.
>
> **Audience:** Paul (CTO/developer), Boaz (product/spec), Claude Code (spec development assistant).
>
> **Status:** Living document. Slices are built sequentially. Each slice is locked once agreed, then updated only with implementation notes.

---

## The Problem

The system has been built as a complete platform — institution management, course setup, AI tutor configuration, post-call analytics, the lot. Individual components work. But there is no single path a user can walk from course creation to completed session with visible results. The chain breaks between components.

Specific failure observed (March 2026): course ingestion worked, a test call was made, the post-call pipeline never completed, the call disappeared from the system, and the caller showed zero activity. Root cause was likely infrastructure (DB capacity / Google account suspension), not a logic bug. This may already be resolved, but the broader point stands: we need to prove the chain works end to end before widening it.

## The Approach: Vertical Slices

Instead of fixing everything at once, we build one complete path through the system — a "vertical slice" — and prove it works with real data. Then we widen it.

**Rules:**
- Each slice is a complete chain from input to visible output.
- A slice's "done" condition must be met before the next slice is **specced and committed to**. Parallel investigation of upcoming dependencies is fine — but we don't build Slice 2 features until Slice 1 is proven.
- Each slice has a defined "done" condition — a thing you can show someone.
- Each slice has a **spec budget** — the minimum set of specs, pipeline stages, and prompt sections needed. Everything else is off.

**Four slices, built in order:**

| Slice | Summary | Done When |
|-------|---------|-----------|
| 1 | One student, one session, results persist | Session completes via Sim, transcript + observations visible in UI |
| 2 | Multi-session progression | Session 3 demonstrably references sessions 1 and 2 |
| 3 | Many students, concurrent | 20+ students, correct attribution, no cross-contamination |
| 4 | Partner-facing dashboard | A non-technical partner can see aggregate + per-student results |

---

## Slice 1 — One Student, One Session, Results Persist

### What This Slice Proves

That the system can take a course, run a text-based tutoring session against it, process the results, and show them to an operator. This is the minimum viable chain. Voice (VAPI) is not part of this slice.

### The Chain (every link must work)

```
Course content exists (uploaded or created)
  → Course is ingested (content → ContentSource → ContentAssertion[])
    → Playbook is scaffolded (identity spec, system specs, published)
      → One student is enrolled (can be manual/hardcoded)
        → Tutor prompt is composed (from course content + defaults)
          → Sim session runs (text chat, no voice, no VAPI)
            → Post-session pipeline runs (minimum stages)
              → Results persist in DB
                → Results are visible in the UI
```

**Note:** Slice 1 is text chat only via the Sim function. Voice (VAPI integration) is out of scope for Slice 1 — it comes in when we need it for student-facing sessions (Slice 3 or later).

If any link breaks, we fix it before moving on. No workarounds, no "we'll come back to it."

### Course Content

For Slice 1, Paul has sufficient course materials from previous testing to work with. The goal is to prove the chain works, not to test with final content.

Once Slice 1 is proven and all slices are checked, Boaz will provide comprehensive course materials for a full 10+ session course. That replaces whatever test content was used to validate the chain.

Requirements for the eventual full course content:
- Enough material for 10+ sessions
- Mixed content types if possible (explanatory text, examples, exercises) to test assertion extraction across categories
- Uploaded as PDF or text files via the existing content upload flow

### Institution & Domain Setup

**Hardcode or reuse a single institution.** No wizard, no branding, no terminology customisation. If an institution and domain already exist from previous testing, use those.

What must exist:
- One Institution record
- One Domain record (linked to institution)
- Domain has `lessonPlanDefaults` set to sensible defaults (can be hardcoded)

What doesn't matter yet:
- Institution type, branding, colours, logo, welcome message
- Terminology overrides (use whatever the defaults are)
- Onboarding flow phases (use hardcoded defaults)

### Spec Budget — What Loads, What Doesn't

**The agreed problem:** currently, scaffolding enables all active system specs on a playbook. This is wrong. For Slice 1, we need selective spec loading.

**Active specs (3):**

| Spec | Role | Why It's Needed |
|------|------|-----------------|
| Base archetype (e.g. TUT-001) | Defines the tutor's core identity, session structure, techniques | Without this, the tutor has no personality or teaching approach |
| Identity overlay | Domain-specific layer on top of the archetype | Required by composition — `extractIdentitySpec` merges base + overlay |
| VOICE-001 | Voice behaviour guidance (turn length, pacing, fillers, backchannels) | Without this, the tutor has no voice interaction rules |

**Inactive / not loaded (everything else):** GUARD-001 can use compiled defaults. INIT-001's first-call flow can be hardcoded. All other system specs are off.

**Key question for Paul:** Can `systemSpecToggles` in `Playbook.config` actually control which specs load into the composition pipeline? Or does the composition always load everything regardless of toggles? If the latter, that's a code change needed for Slice 1.

### Tutor Prompt Composition — Active Sections

Of the 27 composition sections, Slice 1 needs approximately 8. The rest either have no data (no prior sessions, no memories, no personality profile) or add complexity without value on a first session.

**Note:** The composition pipeline was designed for voice prompts (sent to VAPI), but the same prompt drives the text-based Sim. For Slice 1, we use the same composition logic — we just don't send the output to VAPI.

**Active sections:**

| # | Section | Data Loader | Why |
|---|---------|-------------|-----|
| -1 | `preamble` | `computePreamble` | Critical rules, curriculum context |
| 0 | `quick_start` | `computeQuickStart` | `you_are`, `this_session`, `voice_style`, `first_line` |
| 11 | `identity` | `extractIdentitySpec` | Merged identity (base archetype + overlay) |
| 12 | `content` | `extractContentSpec` | Content spec |
| 12.6 | `teaching_content` | `renderTeachingContent` | Teaching points for this session |
| 12.62 | `course_instructions` | `renderCourseInstructions` | Course-level tutor rules — load if present after ingestion, don't fail if absent |
| 14 | `instructions_voice` | `computeVoiceGuidance` | Voice behaviour from VOICE-001 |
| 15 | `instructions` | `computeInstructions` | Final instructions |

**Sections that should return empty/default gracefully (not error):**

| # | Section | Why It's Empty |
|---|---------|---------------|
| 1 | `caller_info` | Minimal caller data (just name) |
| 2 | `personality` | No personality measured yet |
| 3 | `learner_profile` | No profile data yet |
| 4 | `memories` | No prior calls |
| 5 | `behavior_targets` | Using defaults only |
| 6 | `call_history` | First call |
| 7 | `curriculum` | May have auto-generated data — load if present, don't fail if absent |
| 8 | `session_planning` | Same as curriculum |
| 9 | `learner_goals` | No goals extracted yet |
| 10 | `domain_context` | Low priority — can be empty |
| 12.5 | `content_trust` | Treat all content as trusted |
| 12.65 | `visual_aids` | No media |
| 12.7 | `pedagogy_mode` | Use default mode |
| 12.8 | `activity_toolkit` | No activities |
| 13 | `instructions_pedagogy` | Use default |

**Key question for Paul:** If a data loader returns empty/null, does the composition handle that gracefully, or does it error? Every loader in the "empty" list above must not break the composition if it has no data.

### Teaching Points — Session Filtering

The ingestion pipeline extracts assertions at full granularity (six categories, tree hierarchy, multiple depth levels). For a 10-session course, this will produce hundreds of teaching points.

**Requirement:** `renderTeachingContent` (section 12.6) must filter teaching points to the current session's scope before injecting into the prompt. If it currently dumps everything, that's a change needed for Slice 1.

**Key question for Paul:** Does `renderTeachingContent` filter by session/module, or does it load the full assertion set? If the latter, what's the fastest way to add filtering — is it driven by curriculum module mapping, or can it be done by assertion depth/order?

### Post-Session Pipeline — Active Stages

The full pipeline has 7 stages. Slice 1 needs 2, possibly 3.

**Active:**

| Stage | Call Point | What It Does | Why It's Needed |
|-------|-----------|--------------|-----------------|
| LEARN | `pipeline.learn` | Extracts facts/memories about the caller | Without this, Slice 2 has nothing to build on |
| ARTIFACTS | `pipeline.artifacts` | Extracts summaries, facts, exercises | This is what the operator sees as "results" |

**Potentially active (if stable):**

| Stage | Call Point | What It Does | Why |
|-------|-----------|--------------|-----|
| MEASURE | `pipeline.measure` | Scores caller parameters (Big 5, engagement) | Useful for Slice 2, but only if it's stable. If it's flaky, defer. |

**Inactive:**

| Stage | Reason to Defer |
|-------|----------------|
| SCORE_AGENT | Not needed until we're evaluating tutor quality |
| ADAPT | Not needed until per-student personalisation (Slice 3) |
| EXTRACT_GOALS | Not needed until learner goals are used in prompts (Slice 2+) |
| ACTIONS | Not needed until homework/follow-up workflows exist |

**Key question for Paul:** Can the pipeline be configured to run only specific stages? Or does it run all-or-nothing? If the latter, can inactive stages fail silently without blocking the pipeline?

**Key question for Paul:** If an active pipeline stage fails (e.g. LEARN succeeds but ARTIFACTS fails), what's the easiest way to ensure the session record and transcript are never lost? The current behaviour — session disappears entirely — must not happen in Slice 1. Propose the simplest error handling approach: partial results, transcript-only fallback, or whatever is fastest to implement.

### Student Enrollment

One test student, enrolled in the playbook. Can be created manually, via the UI, or hardcoded.

What must exist:
- One Caller record with a name
- CallerPlaybook link (enrolled in the course)
- Sim can initiate a session for this caller against the correct playbook

What doesn't matter yet:
- Registration flow (WhatsApp, email invites, bulk import)
- Cohort/classroom structure
- Onboarding identity interview

### Session Initiation

For Slice 1, the session is initiated via the **Sim** function (left sidebar → CALLS → Sim). This runs a text-based tutoring session as the test student against the course playbook. No voice, no VAPI.

This is the only call path that needs to work for Slice 1. "Try It" and "Teach" are out of scope.

**Naming note:** "Sim" is not self-explanatory for an operator or partner. As part of Slice 1 or Slice 4, rename this to something clearer — e.g. "Practice Session", "Test Call", or "Run Session." Exact label TBD, but flag it now so it doesn't ship to partners as "Sim."

### UI — What Must Be Visible

After the session completes and the pipeline runs, an operator looking at the system must be able to see:

1. **The session happened** — it appears in the caller's history, not zero activity
2. **The transcript** — what was said in the session
3. **Extracted observations** — whatever LEARN produced (memories, facts about the caller)
4. **Session summary** — whatever ARTIFACTS produced

If these four things are visible, Slice 1 is done.

### What's Explicitly Out of Scope for Slice 1

- Voice calls / VAPI integration (Slice 1 is text chat via Sim only)
- Multiple institutions, domains, or courses
- Branding, terminology, welcome messages
- Personality sliders / behaviour target customisation
- Group tone overrides
- Content trust level assignment (treat all as trusted)
- Curriculum editor or manual curriculum adjustment
- Activity toolkit, visual aids, pedagogy mode selection
- Student registration flows (WhatsApp, email)
- Concurrent users
- Partner-facing views

---

## Slice 2 — Multi-Session Progression (Preview)

> Detailed spec to be written after Slice 1 is complete. Outline here for context.

**What it proves:** The tutor remembers and builds on previous sessions.

**What's added to the chain:**
- Voice prompt composition includes `memories` (4), `call_history` (6), `curriculum` (7), `session_planning` (8)
- Post-call LEARN data from session 1 feeds into session 2's prompt
- Curriculum module state progresses — the tutor knows what was covered
- By session 3, the tutor's behaviour demonstrably reflects sessions 1 and 2

**Spec additions:** Same three specs. The difference is that the data loaders now have real data to pull from.

**Pipeline additions:** MEASURE (if not already active) + EXTRACT_GOALS.

**Done when:** Three sequential calls as one student. Third call references content from the first two. Curriculum progress visible in UI.

---

## Slice 3 — Many Students, Concurrent (Preview)

> Detailed spec to be written after Slice 2 is complete.

**What it proves:** The system handles multiple students on the same course without data leaking between them.

**Two sub-slices:**
- **3a — Isolation:** 5-10 students running sequentially. Each has their own learner profile and call history. No cross-contamination.
- **3b — Load:** 20+ students running concurrently. VAPI handles parallel calls. Post-call pipeline handles volume without dropping calls.

**Spec additions:** GUARD-001 as a live spec (target clamping needed when profiles diverge). `caller_info`, `learner_profile`, `behavior_targets` sections active in composition.

**Pipeline additions:** ADAPT (per-student personalisation).

**New requirements:** Student registration flow (WhatsApp webhook or bulk import). Cohort/enrollment management.

---

## Slice 4 — Partner-Facing Dashboard (Preview)

> Detailed spec to be written after Slice 3 is complete.

**What it proves:** A non-technical partner (school, university, training provider) can look at the system and understand what happened.

**What's needed:** Aggregate course progress view, per-student drill-down, call recordings accessible, key metrics (completion rate, engagement, curriculum coverage).

**Done when:** You can sit with a partner, show them the dashboard, and they understand it without narration.

---

## Open Questions for Paul

These need answers before Slice 1 development starts. Question 1 is the highest priority — if the toggles are cosmetic, that's a code change before anything else.

1. **Spec toggle wiring:** Do `systemSpecToggles` in `Playbook.config` actually control what the composition loads? Or is it cosmetic?

2. **Composition resilience:** If a data loader returns empty/null (e.g. no memories, no personality), does the composition handle it gracefully or error?

3. **Teaching point filtering:** Does `renderTeachingContent` filter by session/module, or dump the full set into the prompt?

4. **Pipeline selectivity:** Can the post-call pipeline run specific stages only? Or do all stages run and we need inactive ones to fail silently?

5. **Infrastructure status:** Is the DB capacity / Google account issue fully resolved? Are we confident the chain won't break for the same infrastructure reason?

6. **Fresh vs existing instance:** Do we build Slice 1 on the current deployment (faster, but carries accumulated test data and possible DB issues) or a clean installation (cleaner, but takes setup time)? Trade-off is speed vs confidence.

7. **The 10 gaps in the system description** (section 4 of React_system_description.md) — which of those are "known but undocumented" vs "not yet built"? Specifically #5 (INIT-001 contents), #6 (full archetype configs), and #10 (curriculum auto-generation trigger) — these could affect Slice 1.

---

## Working Agreement

- **Specs live in** `docs/first-course/` in the GitHub repo.
- **Boaz** writes specs (via Claude Chat → Claude Code → GitHub).
- **Paul** develops against specs from the same repo.
- **Each slice** gets its own detailed spec document before development starts.
- **Changes to a locked slice** require both of us to agree.
