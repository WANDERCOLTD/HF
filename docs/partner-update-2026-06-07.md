# Partner Update — What's New This Week

*Week ending Sunday 7 June 2026*

## At a glance

- **Phase 1 is now sellable** — we know who's buying (international recruitment agencies), why (their nurse candidates are failing the IELTS Speaking sub-band), at what price (against the £35/hr human-tutor incumbent), and through which channel. **Five live strategy docs** (D1 briefing, D2 priority TAM, D4 citation sheet, D5 entity lists, D8 sales GTM) and three more scoped (D3, D6, D7) — the artefacts an investor or sales partner expects to see
- **Educators** get a brand-new Course Design Console — a single screen with a live WhatsApp-style Preview of Call 1 where every chat bubble is click-to-edit
- **Learners** can now do voice calls end-to-end — dial-in, AI dials-out, or text — with accurate cost telemetry and clean call termination
- **Onboarding is safe enough for real testers** — PIN-gated first call, magic-link / Google / Microsoft sign-in, full GDPR + EU AI Act disclosure flow, pluggable email + SMS messaging
- **"Talk to your course"** — educators can edit a course conversationally; AI proposals land in a review tray, no silent writes
- **Four market-test courses ready** — IELTS Prep Lab, CIO / CTO Standard, Big Five, Psychology
- **25 data-leak paths closed** — one student can no longer see another's data
- **Foundations laid** for pronunciation / fluency scoring (PROSODY pipeline stage + pluggable voice-scoring providers)
- **Pipeline hardened** — full audit sprint (Track A perf + seven G-class fixes) plus the elimination of legacy heuristics in favour of declarative routing

> **Headline:** Seven days ago, voice calls didn't exist, the educator had no single place to see-and-edit a course, the system had open data-leak paths, Preview lied about staleness, and we had no professional TAM or GTM on paper. Today, voice works end-to-end with cost telemetry, educators get a WhatsApp-style live Preview with click-to-edit on every bubble, the data-leak class is structurally closed, the four market-test courses are running on the same pipeline, and we have a partner-grade strategy document set (D1 / D2 / D8) targeting Sector B and the NMC Band-7 IELTS wedge. We're materially closer to putting this in front of 100 testers.

---

## Outline — what's new this week {.page-break}

0. **Phase 1 is now sellable** — buyer, pain, price and channel all named; D1 / D2 / D4 / D5 / D8 live + D3 / D6 / D7 scoped
1. **A new "Course Design Console" for educators** — single screen for any course with Journey, Behaviour, and a live WhatsApp-style Preview of Call 1
2. **Voice is now ENABLED** — last week the product was text-only; this week learners can dial in, have the AI call them, or stay in chat
3. **Onboarding that's safe enough for real testers** — PIN-gated first call, magic-link / Google / Microsoft sign-in, full GDPR + EU AI Act disclosure flow, pluggable email + SMS messaging
4. **Chat-edit your course config** — educators can configure a course by typing to the AI; six new conversational mutators, all proposals routed through the human-review tray
5. **Course catalogue for market test — four flagship courses ready** — IELTS Prep Lab, CIO / CTO Standard, Big Five, Psychology
6. **Student experience polish** — chat-bubble transcripts, inline module switcher, durable picker, clean post-call summaries
7. **Speech assessment foundations** — pluggable voice-scoring layer + new PROSODY pipeline stage
8. **Quality, safety and trust** — 25 data-leak paths closed, phone uniqueness enforced, AI-to-DB boundary safer
9. **Preview staleness fixed** — Preview now correctly invalidates when an educator edits the course
10. **Pipeline hardened** — full audit sprint: Track A (perf + caps + cron + index) + seven G-class fixes + legacy heuristics eliminated
11. **Qualification dashboard for learners** — a learner can see their readiness for their exam (e.g., IELTS Band 7), with per-module rollups and a per-call qualification context strip
12. **Tallyseal partnership integration deepens** — V6 wizard spike, admin spec editor wired, disclosure write-path Q-CR9 landed, bridge migration runner in deploy
13. **Course Variant** — one-click clone a course for a new cohort (e.g., "IELTS Prep Lab — Vietnam cohort") via API + button
14. **Assessment quality** — deterministic MCQ option shuffle (no more "answer is always A"), multi-course data-routing chain made robust
15. **Infrastructure cleanup** — DB environments rationalised, end-of-session automation, Curriculum/Playbook duality consolidated, dead V4 wizard / wizard-lab / `get-started-v4` removed

---

## 0. Phase 1 is now sellable {.page-break}

This week we turned a year of intuition into a partner-grade TAM + GTM doc set. The headline isn't *"we made strategy docs"* — it's that **we can now walk into a sales conversation knowing who's buying, why, at what price, and through which channel.** The artefacts are downstream of that.

**Five of eight docs are live as PDFs** (D1, D2, D4, D5, D8). The remaining three (D3, D6, D7) are scoped with their place in the sequence reserved.

**What this unlocks:**

| | Last week | This week |
|---|---|---|
| **Sellable** | "AI tutoring, broadly" | Quote IRA buyer · NMC Band-7 Speaking pain · price anchor vs £35/hr human tutor · target list shape (330 IRAs) |
| **Investable** | Hand-wave on TAM | D1 / D2 with V/E/T confidence flags + written verification week |
| **Hireable** | No territory plan for a sales hire | D8 (script + price) + D5 scope (entity list) + IELTS-probe success criteria |
| **Focusable** | Product priorities debated on intuition | A yardstick: *does this help Sector B / IELTS wedge / IRA channel?* |

The full set is D1 through D8; **five are written and live as PDFs (D1, D2, D4, D5, D8)**, and the remaining three (D3, D6, D7) have their scope locked and their place in the sequence reserved.

**The locked spine** (shared across every doc, so the language is consistent for any reader):

- **5-level nomenclature:** Sector → Wedge → Channel → Account → Cohort
- **Sizing map:** TAM = Sector / SAM = Channel / SOM = Account
- **7-sector portfolio** A–G; Sector B and Sector G locked as Phase 1
- **Phase 1 commitment:** Sector B / NMC speaking-band-7 wedge / IRA channel
- **Confidence flags** on every number: [V] verified · [E] estimate · [T] TBD

### The doc set

| Code | Doc | Status | Why it exists |
|------|-----|--------|---------------|
| **D1** | Briefing Note — *Why HFF Needs a Professional TAM + GTM* | **V0.2 — done** | The short read for a partner who doesn't have time for the full deck. Lays out the gap (intuition-led targeting), why it matters now (100 testers + sales conversations imminent), and the shape of the answer (sector segmentation + defensible Phase-1 wedge). Essay-style SCQA, glossary on the last page. |
| **D2** | Priority TAM Overview — *Sector B + IELTS Wedge* | **V0.2 — done** | The market sizing for the wedge we're actually attacking. Bottom-up sizing of internationally-trained nurses / doctors / midwives / care pros who need IELTS Band 7 (or OET) for UK NMC / GMC / HCPC registration. Includes the 7-sector portfolio map, top-citations table, and the IELTS-probe success criteria. |
| **D3** | Full TAM + GTM Analysis (25–35 pp) | Scoped, next | The investor-facing long-form. Each of the 7 sectors gets a deep-dive, channel taxonomy is exhaustive, CPD meta-sector is body-by-body, Phase 2 / 3 / 4 are forward-planned, risk register is full, WW expansion thesis (US / EU / APAC) is sketched. Now unblocked — D4 + D5 are live so every number can cite a citation-sheet row. |
| **D4** | Citation Sheet (72 rows) | **V0.1 — done** | Every figure in D1 / D2 / D8 collapsed into one auditable sheet (metric_id, value WW + UK, source URL, as-of date, V/E/T confidence). The thing a serious partner will ask for: *"where did that number come from?"* |
| **D5** | Entity Lists (78 rows × 7 tabs) | **V0.1 — done** | The actual call lists. IRAs (from NHS Employers Code-of-Practice), healthcare regulators (9 UK statutory), publishers, pathway providers, test owners, CPD bodies, NHS Trusts. Every row has name · type · contact role · pipeline status · owner. What sales opens on a Monday morning. |
| **D6** | TAM Picture Slide | Scoped, lower priority | The ASCII TAM picture from D2 rendered as a designed slide for board / investor decks. Content exists; just needs design. |
| **D7** | Nomenclature Wiki | Scoped, lower priority | The 5-level nomenclature + sizing map dropped into the team wiki, so it stops living in chat threads. |
| **D8** | Sales GTM Plan, Phase-1 Slice — *NMC Speaking-Band-7 via IRA Channel* | **V0.1 — done** | The first actual sales plan. Target: NMC nurse candidates failing on the **Speaking** sub-band (the modal failure point). Channel: **International Recruitment Agencies** who already have the candidate, already pay for IELTS prep, and have a direct commercial incentive to get registration faster. Sales script outline + IRA target list shape + price anchor against the £35/hr human-tutor incumbent. |

### Verification week (before any investor share)

D2 + D8 currently rely on five **estimates** that need conversion to **verified**:

1. First-attempt healthcare-IELTS pass rate (~30–40%) — pull IELTS Partners disaggregated data + OET band distribution (2 days)
2. Per-candidate English-prep spend (£1–2.5k) — 5–10 IRA exec interviews (1 week)
3. IRA market-share Top-5 (~50%) — Companies House + FOI top-30 NHS Trust IRA contracts (1 week)
4. OSCE-prep TAM (£40–60m) — NMC OSCE candidate × commercial provider price points (2 days)
5. NHS overseas-nurse net spend (~£200m/yr — NAO is gross) — FOI NHSE Workforce T&E accounts (2 weeks)

**Why this matters to a partner conversation:** we're no longer pitching "AI tutoring, broadly." We're pitching a specific buyer (the IRA), with a specific pain (Speaking sub-band failures), at a specific price, against a specific incumbent — with the citation chain visible.

## 1. Course Design Console {.page-break}

The biggest single piece of work this week. An educator opens any course and lands on a **Preview** tab by default. They see Call 1 rendered as a chat — pre-call survey card, AI intro call, divider for "Call 1 begins", welcome, onboarding phases, knowledge probe, first teaching turn, NPS sticky-note at the end.

- Every bubble / divider / sticky-note is clickable — opens a slide-in editor for that exact section
- A second tab ("Journey") lets the educator edit pacing, modules, and milestones inline
- A third tab ("Behaviour") lets them shape AI tone, depth, and guardrails
- A prominent Refresh button lets them re-render Preview after edits

**What this replaces:** previously editors had to navigate to ~6 different admin pages and infer what the learner would experience. Now: one page, see-it-then-edit-it.

## 2. Voice is now ENABLED

Last Monday the product was text-only. This week, voice is live end-to-end.

- Voice routes through our metered Anthropic wrapper, so we get accurate token + cost telemetry on every call
- Voice provider is a pluggable interface — multiple providers can coexist
- Per-learner voice override (a specific learner can run on a different provider)
- Three-button lobby for learners: **Talk here** / **Call me** / **Chat**
- Voice config is directly editable (the awkward "Override" indirection is gone)
- Voice secrets are structurally separated from learner-visible config
- Transcripts split into Learner / AI rows correctly

**What's now possible:** a real learner can dial in, get coached, the cost lands on our books accurately, the transcript drives the next prompt, and we know how the call ended.

## 3. Onboarding & enrolment

- **PIN-gated first call** — first-time learners must verify identity via emailed PIN before their first call. Closes the "anyone with a magic link can dial" gap
- **Age-range capture** — every learner is asked their age band atomically with name + email; required, AI can't skip it
- **Phone capture** — added during enrolment, normalised to international format, unique per caller (database-enforced)
- **Magic-link sign-in** as primary returning-user flow
- **Google + Microsoft sign-in** for new users
- **Six disclosures** (GDPR Article 13, EU AI Act Article 50, AUP, Article 22, marketing opt-in, ToS) — all promoted from DRAFT to release-candidate copy, render with proper read-signal audit trail
- **Admin escape hatches** (operator-only, audit-logged): skip PIN on demand; "Continue as test caller" one-click synthetic enrolment; phone-takeover from earlier test callers so the same number can be re-used
- **No more `/join` flash** — the auto-submit interstitial that used to flicker is gone
- **Admin session is preserved** when an admin walks the regular enrolment flow
- **Pluggable messaging** — new `MessagingProvider` abstraction with an email + SMS adapter registry. We can swap SMS providers (e.g., Twilio → MessageBird) without code changes
- **Enrol-links page now shows V1 + V2 URLs per cohort** — easier to A/B and to give partners the right link for their tester

## 4. Chat-edit your course config

A course-aware chat surface — typed, not spoken — where an educator can say things like:

- *"Swap the primary curriculum to X"*
- *"Attach a linked curriculum for the Pakistan cohort"*
- *"Update the intake form to ask about prior IELTS attempts"*
- *"Change the voice provider to ElevenLabs"*
- *"Show me the current voice config"*
- *"Switch the voice scoring mode to IELTS"* (new this week)

Seven new conversational tools were added this week. Every AI-proposed change still lands in the **Pending Changes** tray for human review before going live — no silent AI writes.

## 5. Courses for market test

| Course | Who it's for | What it teaches | Why it's our pick |
|--------|--------------|-----------------|-------------------|
| **IELTS Prep Lab** | English learners targeting a band score (typically 6.5–7.5) for university or visa | Conversational speaking & listening practice — IELTS Part 1, 2, 3 topics with pronunciation feedback and fluency scoring | Largest TAM in language-cert prep; clearest "did the AI help" signal (band score is objective) |
| **CIO / CTO Standard** | Senior tech execs and aspiring tech execs | Strategic frameworks, board-level communication, vendor management, team-design patterns | Highest willingness-to-pay segment; tests whether HF can hold its own in exec-coaching tone |
| **Big Five** *(short tester course)* | Anyone curious about themselves, or partners who want a quick taste | A guided exploration of the Big Five (OCEAN) personality model — Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism — with AI-led reflection prompts | Fastest "aha" moment in under 10 minutes; doesn't require domain expertise from the learner |
| **Psychology** *(short tester course)* | Curious general audience, no prerequisites | Foundational psychology concepts delivered as conversation | A second short course so partners can compare the system on two different subject domains |

The two short courses (Big Five + Psychology) are deliberately bite-sized — a partner can walk a 5-minute call and feel the loop without committing to a full IELTS or CIO arc.

## 6. Student experience polish

- Chat-bubble transcript layout everywhere (Call tab, Tune tab, sim)
- Inline module quick-switcher (modal, no page navigation)
- Picker choice persists across visits (no need to re-pick the module each time)
- Inline call-transcript expander on the Tune tab
- Defensive retry on the rare enrolment-race where the caller record wasn't visible yet
- Closing message on the final intake turn — no more silent end

## 7. Speech assessment foundations

- A **PROSODY** stage now exists in the adaptive pipeline (wired in, ready to receive scores)
- Voice-scoring providers have CRUD + admin UI
- **Voice scoring mode is now a first-class operator choice** — every course page shows a *"Voice scoring: IELTS"* or *"Voice scoring: General"* pill on the header. IELTS mode scores the four-band rubric (Fluency, Pronunciation, Lexical Resource, Grammar). General mode scores conversational pace. An educator can flip it via Cmd+K
- The system is ready to plug in SpeechAce or SpeechSuper for IELTS pronunciation scoring as a follow-on

## 8. Quality, safety and trust

- **25 student-scope data leaks closed** — routes where a student could have seen another student's calls / goals / memories by tampering with a query param. All now structurally locked to the session's own caller.
- **Phone uniqueness** at the database level
- **FK consistency check** is now a CI gate (no more orphan records reaching dev / staging)
- **Three new AI-to-DB guards** documented and enforced (orphan-curriculum prevention, primary-playbook-link enforcement, Preview-staleness propagation)
- **Schema migrations cannot land without a paired migration file** (CI guard)

## 9. Preview staleness fixed

When an educator regenerates a curriculum, imports modules, uploads a course reference, or links a subject — the Preview lens now correctly shows "stale, click Refresh". Previously these four paths silently kept Preview on the old version, which could mislead the educator into thinking their edit didn't take.

## 10. Pipeline hardening (the audit sprint)

Less visible to partners than the design console, but this is what lets us put real testers on the system without fear. A multi-day audit sprint landed nine separate hardening pieces.

- **Track A (perf + safety)** — added per-call caps on AI parameter writes, wrapped the high-risk destructive paths in transactions, exposed a cron endpoint for scheduled maintenance, and added a partial database index that cut a critical query from ~400ms to ~12ms
- **Seven G-class fixes** from the adaptive-loop measure/adapt audit (G2, G3, G5, G8, G9, G10, G12) — each one a specific structural weakness in the EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE chain that could have produced silently wrong learner outcomes
- **Legacy heuristics eliminated** — the pipeline previously had fall-back heuristics (string matching, magic constants) sitting alongside the declarative configuration. Replaced with a single `lessonPlanMode`-aware routing layer. Two long-standing bug classes (I-C1 vacuous routing + G10 instantiate mismatch) closed with a formal proof script
- **PROSODY stage wired** into the adaptive loop (reorder + parallel-batch fix)
- **LO scoring** is now universal across all courses with an AI-to-DB whitelist guard
- **Tutor briefing validator** + 140-row backfill — closed a class of malformed tutor briefings that could reach learner sessions
- **Market-test readiness assessment** — formal stocktake committed; identified eight gap areas, of which six are now closed and two are tracked

**Net:** the bits of the engine that have to be right when 100 strangers start using it are now actually right, with regression tests in place to keep them right.

## 11. Qualification dashboard for learners

A learner now has a clear answer to *"am I ready for my exam?"*

- **Readiness rollups** computed at the curriculum level — modules feed up into a single qualification readiness score (e.g., *"73% ready for IELTS Band 7"*)
- **Qualification dashboard UI** in the student app shows per-module readiness, what's blocking, and what to focus on next
- **Per-call qualification context strip** in the sim — the learner sees what the call is targeting and why
- **Post-call session summary** — at the end of a call the learner gets a structured recap (what was covered, what improved, what's next)
- **Mastery-discipline config** enforced at the database write site (was previously only enforced in prompts — AI could bypass it)
- **`qualificationAnchor` field** on Curriculum + a derivation helper + a 3-route refactor — lets us link a curriculum to a specific qualification (IELTS Band 7, NMC Speaking, etc.) so readiness has a target to aim at, with a CI guard against divergence

## 12. Tallyseal partnership integration deepens

We continue to integrate with the **Tallyseal** spec-authoring + disclosure-emission framework. This week:

- **V6 wizard spike** — a playground that lets us author the *Create Recipe* config via Tallyseal's `CrawcusSpec` format. Phase 1 of replacing our in-house V5 wizard
- **Intake spec storage + admin editor wired** — admins can edit intake specs through the Tallyseal `admin-editor` package; spec is parsed server-side and projected to a body cache; PUBLISHED rows backfill cleanly
- **Q-CR9 disclosure write-path** — disclosures + signals from intake now write into typed Tallyseal tables (the structural SIGNAL-not-gate guarantee — a disclosure signal can't mutate the acknowledgement state)
- **Bridge migration runner** — explicit `tallyseal:migrate` step in the deploy pipeline so the typed tables stay in sync
- **Six disclosure files** (GDPR Art 13, EU AI Act Art 50, AUP, GDPR Art 22(3), marketing opt-in, ToS) promoted from DRAFT to RC.1 with body lorem stripped
- **Items 12 + 13 adopted** — spec-driven tool calling replaces our regex-based field extractor; `ageBand.adultOnly()` invariant wired

## 13. Course Variant — clone a course for a new cohort

A new **Course Variant API** + one-click button lets an educator clone an existing course (its modules, LOs, references, voice config, intake spec, behaviour targets) for a different cohort — e.g., *"IELTS Prep Lab — Vietnam cohort"* off the back of *"IELTS Prep Lab — Pakistan cohort"*. Underlying Curriculum can be shared (one source of truth) while Playbook config diverges.

## 14. Assessment quality

- **Deterministic MCQ option shuffle** — multiple-choice questions used to drift toward "the answer is always A". Now the shuffle is deterministic per learner so the *experience* is randomised but the *grading* is reproducible
- **Multi-course data-routing chain** made robust — assessments now work consistently across all four market-test courses (was previously fragile when a learner was enrolled in more than one)
- **Multi-enrolment ordering fix** — when a student has multiple enrolments, the system now picks the primary / most-recent one deterministically (was previously arbitrary)
- **Tutor-briefing validator** + 140-row backfill — closes a class of malformed tutor briefings that could reach learner sessions

## 15. Infrastructure cleanup

- **Database environments rationalised** — dev points at sandbox; staging has its own DB; the confusing third "dev" DB is retired
- **End-of-session automation** — a single command (`/mmm`) merges open PRs, pulls main on the VM, cleans up stale worktrees + local branches, writes a session closeout
- **Curriculum / Playbook duality closed** — an 8-month-old data-model duality is fully consolidated. We can now have a single curriculum shared across course variants (e.g., *"IELTS for Pakistan"* + *"IELTS for Vietnam"* sharing core modules).
- **Dead code removed** — V4 wizard eval suite, wizard-lab page + API + topbar label, `get-started-v4` redirect stub — all deleted
- **Migration tooling** — shadow-DB workaround documented + `generate-migration.sh` wrapper added + CI guard blocks schema changes without a paired migration file
- **CI greening** — 22 mock-gap test failures unblocked, 10 stale unit tests fixed, Prisma client generated before tsc, ratchet bumps applied

---

## Try it — live URLs {.page-break}

All on the dev environment. Sign in first, then everything else opens normally.

### Sign in
**https://dev.humanfirstfoundation.com/login**
Magic-link sign-in (primary) or Google / Microsoft. Returning users land straight on their roster.

### See the new Course Design Console
**https://dev.humanfirstfoundation.com/x/courses**
Pick a course → defaults to the new Preview tab with WhatsApp-style chat bubbles. Click any bubble to edit that section inline. Try the **Journey** and **Behaviour** tabs too.

### Try the chat-based course management
Inside any course detail page, look for **Chat** in the tab strip.
Try saying: *"Show me the current voice config"*, *"Update the intake form"*, *"Swap the primary curriculum"*.

### Try a learner journey (self-enrol as a tester)
**https://dev.humanfirstfoundation.com/x/enrol-links**
Lists every cohort with a "Copy" button. Copy a link, open an **Incognito** window, paste it, and walk the full learner flow: enrolment → age range → disclosures → PIN → first call → sim.

### Try voice (after enrolling)
On `/x/sim/<your-caller-id>` after enrolling, you'll see a three-button lobby:

- **Talk here** (browser mic / speaker)
- **Call me** (PSTN — the system dials your phone)
- **Chat** (text only)

### See AI-spend telemetry live
The top status bar on any admin page shows today + month-to-date spend. After a voice call, refresh and confirm the call shows up with real token / cost numbers.

### Educator: watch a tester journey
**https://dev.humanfirstfoundation.com/x/callers**
Pick any test caller → see their calls, transcripts (chat-bubble layout), Tune tab with inline transcript expander, and the post-call summary.

---

## Cheat-sheet — a 10-minute self-serve demo

1. Sign in at **https://dev.humanfirstfoundation.com/login**
2. Open `/x/courses` → pick **IELTS Prep Lab** → land on the new **Preview** lens — show WhatsApp-style bubbles, click a bubble to edit
3. Switch to the **Journey** lens — show inline edit
4. Switch to the **Chat** tab — type *"Change the welcome message tone to warmer"* — show the Pending Changes tray catching the AI proposal
5. Open `/x/enrol-links` → copy a **Big Five** or **Psychology** link → Incognito window → walk the enrolment in 60 seconds → land on sim → hit **Talk here** → 2-min call
6. Back in the operator window: open `/x/callers/<id>` to see the call land with transcript, cost, and the next prompt already shaped by what was just said

That's the full loop — educator-edit → learner-experience → adapt — in one sitting.

---

## Logins {.page-break}

All on **https://dev.humanfirstfoundation.com/login**.

| Email | Password | Role | Notes |
|-------|----------|------|-------|
| `admin@test.com` | `admin123` | Superadmin | Full access to everything |
| `hff@test.com` | `admin123` | HFF Partner / Super Tester | Recommended for partner demos |
| `sim@test.com` | `admin123` | Market Tester | Learner-side experience |
| `teach@abacus.com` | `hff` | School Educator | Educator-side view, scoped to Abacus Academy |
| `healthcare@hff.com` | `hff2026` | Healthcare Educator | Educator-side view, scoped to a healthcare facility |
