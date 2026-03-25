# Boaz — Investor Demo Scenarios

> What do investors need to see to understand the product's value?
> Source: Derived from the [Slice 1 Build Specification](../first-course/first-course-spec.md). Each scenario maps to one link in the Slice 1 chain. They must be demonstrated in order.

---

## Scenario: Institution & Course Setup

**Purpose:** Show that an operator can stand up a course in the system without technical help. For investors, this is the "zero to something" moment — a school signs up and has a working course in minutes, not weeks.

**Screens:** Institution list, Domain settings, Course/Playbook creation page

**Happy path:**
1. Institution and Domain already exist (reused from prior testing — no wizard needed)
2. Operator creates a new Course (Playbook) under the Domain
3. Course appears in the list, ready for content upload
4. Playbook is scaffolded with identity spec (TUT-001), identity overlay, and VOICE-001
5. All other system specs are inactive — only the three required specs load

**Must work:**
- Institution → Domain → Playbook chain exists and is linked correctly
- `systemSpecToggles` in Playbook.config actually controls which specs the composition loads (not cosmetic)
- Playbook is published and accessible for session initiation

**Nice to have:**
- Clean, minimal UI — no clutter from unused features
- "Sim" label renamed to something investor-friendly (e.g. "Practice Session" or "Run Session")

---

## Scenario: Content Upload & Ingestion

**Purpose:** Show that a teacher uploads their course materials and the system automatically extracts structured teaching points. For investors, this demonstrates AI doing heavy lifting — turning a PDF into a teachable curriculum.

**Screens:** Content Upload page, Content/Assertions view (if visible)

**Happy path:**
1. Operator uploads course materials (PDF or text files) via the existing content upload flow
2. System ingests content: ContentSource → ContentAssertion[] (six categories, tree hierarchy)
3. Teaching points are visible or confirmable in the system
4. Course-level tutor instructions are extracted if present in the materials

**Must work:**
- Upload completes without error
- Ingestion produces ContentAssertions — not zero, not garbage
- Assertions are linked to the correct Playbook
- `renderTeachingContent` (section 12.6) filters teaching points to the current session scope — does not dump the entire assertion set into the prompt

**Nice to have:**
- Visual confirmation of how many teaching points were extracted
- Ability to preview what the tutor "knows" from the uploaded content

---

## Scenario: Student Enrollment

**Purpose:** Show that a student can be connected to a course. For Slice 1 this is minimal — one test student, manually created. For investors, the point is that the system tracks individual learners.

**Screens:** Student/Caller list, Enrollment view

**Happy path:**
1. One Caller record exists with a name
2. Caller is linked to the Playbook via CallerPlaybook
3. Sim can see this caller as a valid target for a session

**Must work:**
- Caller record exists in DB
- CallerPlaybook link is correct
- Sim session can be initiated for this specific caller against the correct Playbook

**Nice to have:**
- Student visible in a list UI (not just DB)
- Minimal student profile card showing name and enrolled course

---

## Scenario: Sim Session — Text-Based Tutoring

**Purpose:** The core demo moment. A student has a tutoring conversation with the AI, driven by the uploaded course content. For investors, this is the product — an AI tutor that teaches real material in a natural conversation.

**Screens:** Sim page (left sidebar → CALLS → Sim), Chat interface

**Happy path:**
1. Operator selects the test student and the course Playbook in Sim
2. Sim initiates a text chat session (no voice, no VAPI)
3. Tutor prompt is composed from the 8 active sections: preamble, quick_start, identity, content, teaching_content, course_instructions, instructions_voice, instructions
4. The remaining 15 sections return empty/default gracefully — no errors
5. Tutor greets the student and begins teaching from the course content
6. Student (operator playing student) has a multi-turn conversation
7. Session completes cleanly

**Must work:**
- Prompt composition succeeds with 8 active + 15 empty sections (no loader crashes on null/empty)
- Tutor references actual course content — not generic filler
- Session completes without errors or hanging
- Transcript is captured in full

**Nice to have:**
- Tutor feels natural — good pacing, asks questions, responds to answers
- Session has a clear beginning, middle, and end structure
- Teaching points covered are trackable

---

## Scenario: Post-Session Pipeline

**Purpose:** After the call ends, the system processes results automatically. For investors, this shows the AI doesn't just chat — it learns about the student and produces structured outputs.

**Screens:** (Background process — no direct screen, results appear in next scenario)

**Happy path:**
1. Session ends
2. LEARN stage runs — extracts facts and memories about the caller
3. ARTIFACTS stage runs — extracts summaries, facts, exercises
4. (Optional) MEASURE stage runs — scores caller parameters (only if stable)
5. All results persist in DB
6. Session record and transcript are never lost, even if a pipeline stage fails

**Must work:**
- LEARN and ARTIFACTS stages complete without error
- Results are written to DB and linked to the correct caller + session
- If ARTIFACTS fails, the session record and transcript still persist (no disappearing calls)
- Pipeline does not run inactive stages (SCORE_AGENT, ADAPT, EXTRACT_GOALS, ACTIONS) — or they fail silently

**Nice to have:**
- Pipeline completes in under 30 seconds
- MEASURE stage runs and produces personality/engagement scores
- Error handling produces a clear log if something fails

---

## Scenario: Results Visible in UI

**Purpose:** The payoff. An operator (or investor) can see what happened — the session exists, the transcript is readable, the AI's observations are visible. This closes the loop: input went in, intelligence came out.

**Screens:** Caller history/profile page, Session detail page, Transcript view, Observations/Artifacts view

**Happy path:**
1. Navigate to the test student's profile
2. The session appears in their history — not zero activity
3. Click into the session — full transcript is visible
4. Extracted observations from LEARN are displayed (memories, facts about the caller)
5. Session summary from ARTIFACTS is displayed

**Must work:**
- Session appears in caller history (not missing, not zero)
- Transcript is complete and readable
- LEARN observations are visible somewhere in the UI
- ARTIFACTS summary is visible somewhere in the UI

**Nice to have:**
- Clean, scannable layout — an investor can glance and understand
- Timestamps on transcript messages
- Observations categorised or labelled (not raw JSON)
- A "session score" or engagement indicator from MEASURE (if active)

---

## Scenario: End-to-End Chain (Full Walkthrough)

**Purpose:** The investor demo itself — all six scenarios above in sequence, showing the complete journey from course setup to visible results. Not a separate feature; it's confirmation the chain holds together.

**Screens:** All screens from scenarios above, in order

**Happy path:**
1. Show the institution and course exist
2. Show uploaded content and extracted teaching points
3. Show the enrolled student
4. Run a live Sim session (3–5 minutes of tutoring conversation)
5. Wait for pipeline to complete
6. Show the session in the student's history with transcript, observations, and summary

**Must work:**
- Every link in the chain works without manual intervention or workarounds
- No step requires SSH, database queries, or code changes to complete
- The entire walkthrough can be done from the browser UI

**Nice to have:**
- Completable in under 10 minutes end to end
- Smooth transitions between screens (no loading failures, no blank pages)
- A narrative arc: "Here's the course, here's the student, watch them learn, here's what the AI captured"

---

## Open Questions — All Resolved ✅

See [paul-technical.md](paul-technical.md#open-questions) for full resolutions.

| # | Question | Resolution |
|---|----------|------------|
| 1 | Spec toggle wiring | **DONE** — `a00ffca`. `systemSpecToggles` controls composition filtering. |
| 2 | Composition resilience | **DONE** — All 15 empty loaders handle null via `activateWhen` + fallbacks. |
| 3 | Teaching point filtering | **DONE** — `assertionIds` populated by `generateLessonPlan()`. Instruction assertions split to identity spec (Epic 2). |
| 4 | Pipeline selectivity | **ACCEPTABLE** — All 7 stages run; inactive ones produce nothing. Wastes tokens, doesn't break. |
| 5 | Pipeline failure handling | **DONE** — Transcript persists BEFORE pipeline fires. Sessions never disappear. |
| 6 | Infrastructure status | **RESOLVED** — Using existing deployment. |
| 7 | Fresh vs existing instance | **USE EXISTING** — Faster. PIPELINE-001 seeded via `npm run db:seed`. |
