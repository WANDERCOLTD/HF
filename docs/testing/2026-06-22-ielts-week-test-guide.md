# IELTS Test Guide — Comprehensive Knob-by-Knob Walkthrough

**Audience:** Eldar and Boaz.
**Purpose:** Every knob the educator has for the IELTS Speaking Practice course, in three columns — **what you asked for** (the educator intent in BDD language), **what we built** (the change that landed), and **how to test it** (where to go, what to change, what to observe).

---

## Environment Status — Ready

Both test environments are set up. As of 22 June 2026:

| Environment | URL | Content sources | Module source-refs | LLM Scoring | Assessment Plan declared |
|---|---|---|---|---|---|
| **DEV (demo)** | dev.humanfirstfoundation.com | 6 of 6 present | All 11 resolve | ON | Yes (upfront Baseline + end Mock) |
| **SANDBOX** | engineering local | 6 of 6 present | All 11 resolve | ON | Yes (same) |

If anything in the table above ever looks wrong, that's the symptom of an environment reset. Otherwise, you can start testing directly.

---

## Section 1 — Course-Level Setup Knobs (the things the educator decided once)

These are the high-level decisions about the course. Most aren't changed mid-test — but each one should be visible and reflected.

| What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|
| **Audience.** The course is targeted at a specific learner cohort (IELTS test-takers aiming for Band 6.5–7.5). | Audience is set on the course (IELTS Speaking Practice). | Course → Overview tab. Audience shown. Reflects in tutor framing — tutor introduces the course as IELTS-specific. |
| **Subject Discipline.** This is an English-language assessment-prep course, distinct from coaching or content tutoring. | Subject discipline field is set to "Language assessment prep". | Course → Overview tab. Field shown. Should not be empty or set to "general coaching". |
| **Teaching Mode.** The tutor should use a directive, exam-prep-oriented teaching mode rather than open Socratic. | Course teaching mode is set to "directive" (with the right balance for exam prep). | Course → Teaching tab. Mode toggle shown with a cascade chip ("from Course"). Switching tutorial styles for a session should reflect this. |
| **Interaction Pattern.** Multi-turn conversation, not one-shot Q&A. | Interaction pattern is "Q-then-A-then-feedback-then-retry" (multi-turn). | Course → Teaching tab. Live Part 1 session: tutor asks, learner answers, tutor corrects, learner retries — that pattern, not just question-answer-next. |
| **Plan Emphasis.** This course emphasises practice and feedback over pure knowledge delivery. | Plan emphasis is set to "practice-and-feedback". | Course → Teaching tab. Plan-emphasis field shown. |
| **Progression Mode.** Modules are sequenced in a fixed Part 1 → 2 → 3 → Mock order, not free-choice. | Progression mode = "sequenced" (with strict prerequisites). | Course → Modules tab. Module list shown in order. Learner cannot skip Part 2 to go straight to Mock. |
| **Module Sequence Policy.** Within the sequence, the learner re-runs Part 1/2/3 multiple times before Mock. | Module sequence policy supports re-running practice modules. | Live: after first Part 1 session, the learner can do Part 1 again; the system tracks attempt count. |
| **Strict Prerequisites.** A Mock session cannot start before the Baseline is complete. | Strict prerequisites flag is ON. | Live: a brand-new learner sees Baseline as the only available next module. Mock is locked until Baseline + practice modules have been touched. |
| **First Call Mode.** The very first session is a Baseline Assessment — not a normal practice session. | First call mode = "baseline_assessment". | First session on a fresh learner: examiner-mode, indicative bands at end, not coaching. |
| **Lesson Plan Mode.** The course doesn't use a rigid lesson-plan structure; tutor adapts within the module's scope. | Lesson plan mode is set to the adaptive variant. | Live Part 1 / Part 3: tutor doesn't read from a fixed script; coaches based on what the learner just said. |
| **Session Count target.** The course is designed for roughly a defined number of sessions to reach the band target. | Session count is set on the course (visible to educator). | Course → Overview tab. Session count shown. |
| **Per-session Duration target.** Each non-fixed-duration session has a target time. | Duration in minutes is set on the course. | Course → Overview tab. Duration target shown. Live: tutor wraps a Part 1 / 3 session around that target. |

---

## Section 2 — Scoring & Mastery Knobs (the engine's judgement)

Where the engine measures the learner. Many landed or were made cascadeable this week.

| What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|
| **LLM IELTS Scoring on/off, per course.** The educator should be able to turn LLM-judged scoring on or off without engineering involvement. Was an engineering-environment variable. | Per-course toggle on the Course Scoring tab. Cascade chip shows whether it's set at the course, inherited from Domain, or default. | Course → Scoring tab. Toggle visible. Turn it OFF → run a Baseline → no bands produced. Turn it ON (currently ON) → run a Baseline → 4 bands produced. Cascade chip updates as you flip. |
| **Scoring Mode.** Course uses transcript-based LLM scoring with prosody as enhancement, not prosody-only. | Scoring mode = "LLM transcript primary, prosody enhancement". | Course → Scoring tab. Mode visible. |
| **Tier Preset.** The course uses the IELTS-specific 9-band tier preset, not the generic 4-tier scheme. | Tier preset ID set on course. Cascadeable from Domain. | Course → Scoring tab → Rubric Calibration lens. Preset shown. The 9 bands appear (1–9), not the 4-tier scheme. |
| **Skill Tier Mapping.** The 4 IELTS criteria each map to the 9-band scheme. | Skill-tier mapping JSON declares the four criteria → 9-band mapping. | Scoring tab → Rubric Calibration. Each of Fluency / Lexical / Grammatical / Pronunciation shown mapped to 9 bands. |
| **LO Mastery Threshold.** The point at which an LO is considered "mastered" by the learner. | Configurable threshold (decimal e.g. 0.85). Cascade from Domain → Course. | Course → Scoring tab. Threshold visible. Cascade chip shows source. Change it at Domain → Course inherits unless explicitly overridden. |
| **Skill EMA Half-life.** How much weight to give recent sessions vs older when averaging band scores over time. | Half-life days configurable. Cascade chip shown. | Scoring tab. Half-life visible. Setting it shorter weights recent sessions more strongly. |
| **Memory Decay Tolerance.** How quickly the engine should consider a memory stale. | Memory decay scale configurable (under tolerances). | Scoring tab → Tolerances. Decay scale visible. |
| **Progress Narrative.** The course generates a written progress narrative for the learner. | Progress narrative configuration block on the course. | Learner profile after several sessions. Written narrative appears (e.g. "You've made strong gains on Fluency and Coherence; let's focus on…"). |
| **Per-Skill Scoring Target.** The educator can set "I expect this cohort to reach band 6.5 on Pronunciation" per criterion. | Behaviour-target rows declared per skill. UI editor filed for next sprint. | Currently: visible only in the underlying data. Filed as not-yet-done. |
| **Behaviour-parameter Registry.** The educator can review the full set of parameters the engine measures (4 IELTS skills + 4 raw prosody signals + supporting parameters). | Registry amended this week with all 8 IELTS-relevant parameter rows (4 skill criteria + 4 prosody-raw). | Course → behaviour-parameters registry view. All 8 visible. |

---

## Section 3 — Enrollment & Intake (the learner's first contact)

This was thinly covered before — expanding it. The intake / enrollment surface is its own behaviour set.

| What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|
| **A dedicated intake screen.** When the learner enrolls in the course for the first time, they should see a structured intake — not the regular chat screen. | New Intake Wizard screen, mounted automatically on enrollment sessions. | Sign up a fresh learner on the IELTS course. First screen is intake-styled (form-like / wizard-style), distinct from a normal chat. |
| **Goals capture toggle.** The educator can choose whether to ask the learner about their goals during intake. | Welcome.goals.enabled flag on the course (currently ON for IELTS). | Course → Journey tab. Goals-capture toggle visible. Currently ON → learner sees a "What would you like to get out of this course?" question during intake. Flip OFF → no goals capture. |
| **Goals capture question copy.** The educator can phrase the goals question. | Goals question text is configurable per course. | Course → Journey tab → intake settings. Question text shown ("What would you like to get out of this course?"). Edit and re-run intake. |
| **About-You capture toggle.** The educator can ask the learner about themselves / their background. | Welcome.aboutYou.enabled flag (currently ON). | Course → Journey tab. Toggle visible. ON → intake collects About-You. OFF → skipped. |
| **AI Intro Call toggle.** The educator can offer an AI-led introductory call as part of intake. | Welcome.aiIntroCall.enabled flag (currently OFF for IELTS). | Course → Journey tab. Toggle visible. Flip ON → enrolled learner is offered an intro call before Baseline. |
| **Knowledge Check toggle.** The educator can include a baseline knowledge check during intake. | Welcome.knowledgeCheck.enabled flag (currently OFF on welcome; ON under sessionFlow.intake). | Course → Journey tab. Knowledge-check setting visible. |
| **Welcome Message.** The educator can write a custom welcome message the learner sees on enrollment. | Welcome message text field on the course. | Course → Journey tab → Welcome / Intake card. Edit message. Re-enroll a fresh learner — new message appears. |
| **Intake captures specific profile fields.** The educator can specify which profile fields about the learner the system should capture (target band, current band estimate, native language, exam date, weeks until exam, etc.). | Profile-fields-to-capture source linked on the Baseline module (currently `ielts-speaking-profile-fields`, contains the canonical IELTS profile-field set). | Live intake on a fresh learner — verify which profile fields are captured. Captured fields visible on the learner profile after intake. |
| **The captured profile shapes the rest of the course.** The learner's target band, current self-assessed band, exam date, etc. should influence how the tutor coaches. | Captured profile fields written to the learner record and read by the engine during composition. | After intake: tutor's tone and framing in Part 1 reflect the learner's stated target band (e.g. higher target → more demanding correction; closer exam date → urgency in framing). |

---

## Section 4 — Module-Level Knobs (the 5 IELTS modules)

The IELTS Speaking Practice course has 5 modules: Baseline / Part 1 / Part 2 / Part 3 / Mock. Each has the same knob shape, used differently. The matrix below describes each knob; the table after gives the per-module values.

### Per-knob description

| What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|
| **Module Mode.** Each module sets the tutor's posture: tutor mode (active coaching), examiner mode (silent), mixed (coaching with embedded long-turn), or mock-exam mode (full 3-part simulation). | Module mode field on every module. Drives shell selection + tutor behaviour. | Course → Modules tab → click each module. Mode visible. Live: tutor posture matches the mode. |
| **Module Duration.** Each module has either a fixed duration (Baseline / Mock = 20 min) or is student-led. | Duration field on each module. | Modules tab → module Inspector → Duration. Live: Baseline / Mock end cleanly at 20 mins; practice modules continue for as long as the student is engaged. |
| **Closing Line.** The educator can set a verbatim closing line the tutor delivers at session end. | Per-module closing line field. | Live session → end of session → tutor says the configured line verbatim (e.g. Baseline: "That's the end of your Baseline. I'll share your focus area on screen."). |
| **First-time Orientation Line.** The educator can set a verbatim opening line for the learner's first encounter with this module. | Per-module first-time orientation line. | Live: first time a learner enters a module, tutor speaks the orientation line. On second visit, the line is skipped (or briefer). |
| **Cue Card Pool.** For modules that use cue cards (Baseline, Part 2, Mock), the educator chooses the pool of cue cards. | Per-module cue card pool source-ref. Currently all 3 point at the canonical cue-card source library. | Modules tab → module Inspector → Cue Card Pool. Source shown with a status badge (green if resolves). Live: cue card appears at session start. |
| **Topic Pool.** For Part 1 / Part 3, the educator chooses the topic pool the tutor draws from. | Per-module topic pool source-ref. | Modules tab → module Inspector → Topic Pool. Source shown with status badge. Live: Part 1 tutor opens with a topic from the configured pool. |
| **Scaffold Pool.** When the learner stalls or loses their thread, the educator's chosen scaffold pool drives the tutor's recovery prompts. | Per-module scaffold pool source-ref. Baseline / Part 2 / Mock use monologue scaffolds; Part 1 / Part 3 use discussion scaffolds. | Live: deliberately stall in a session. Tutor's recovery prompt matches the stall type from the configured scaffold pool. |
| **Profile Fields to Capture.** For the intake module (Baseline), the educator chooses which fields to capture. | Per-module profile-fields-to-capture source-ref (Baseline only). | See Section 3 above. |
| **Scheduled Cues.** The educator can schedule cues to fire at specific moments inside a session (e.g. "at minute 1, prompt the learner to start speaking"). | Per-module scheduled cues array. | Live session → cue fires at the scheduled time. |
| **Minimum Speaking Seconds.** Below this threshold of learner speaking time, the system considers the answer too short and prompts the learner to expand. | Per-module min speaking seconds value. | Live Part 2: give a 30-second monologue (below the 90-second floor). Tutor prompts you to continue speaking. |
| **Question Target.** The expected number of questions the tutor will run in this module. | Per-module question target number. | Live: tutor closes the module roughly at the target question count. |
| **Score Readout Mode.** When the learner sees their band scores from this module. Options: shown on-screen during, shown at end, or read aloud with the indicative band. | Per-module score readout mode field. Now properly typed. | Live: Baseline / Mock end → bands appear per the configured readout mode. |

### Per-module values currently set

| Module | Mode | Duration | Question Target | Min Speaking (sec) | Has Cue Cards | Uses Stall Scaffolds |
|---|---|---|---|---|---|---|
| **Baseline Assessment** | examiner | 20 min fixed | (per module) | (per module) | Yes — cue card bank | Monologue scaffolds |
| **Part 1 Practice** | tutor | student-led | (per module) | (per module) | No (uses topic pool instead) | Discussion scaffolds |
| **Part 2 Long Turn** | mixed | student-led | (per module) | (per module) | Yes — cue card bank | Monologue scaffolds |
| **Part 3 Discussion** | tutor | student-led | (per module) | (per module) | No (uses topic pool instead) | Discussion scaffolds |
| **Mock Exam** | examiner | 20 min fixed | (per module) | (per module) | Yes — cue card bank | Monologue scaffolds |

Tester action: open each module Inspector and confirm the per-module values are populated, the source badges are green, and the live session behaviour matches.

---

## Section 5 — Voice & Runtime Knobs

| What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|
| **Voice Provider.** The educator picks which voice service the tutor uses. | Voice provider field on the course. Cascadeable. | Course → Voice tab. Provider shown. |
| **Specific Voice.** A particular voice within the provider. | Voice ID field. | Voice tab. ID shown. Live: tutor sounds like the picked voice. |
| **Language.** Course-level language setting (English for IELTS). | Language field. | Voice tab. Set to English. Tutor speaks English. |
| **Max Session Duration.** A hard cap to prevent runaway sessions. | Voice config max-duration-seconds setting (currently 1800 = 30 min). | Voice tab. Duration cap visible. Live: a runaway session hits the cap. |
| **Prosody Mode.** The IELTS course uses an IELTS-specific prosody profile for scoring. | Voice.prosodyMode = "ielts". | Voice tab. Prosody mode field shown. |
| **AI Model Provider per Call-Point.** The educator can override which AI model is used for a specific call-point (e.g. scoring vs composition vs intake) at the Course level. | Per-call-point AI override block on Playbook.config (and cascadeable from Domain). | Course → AI Config tab. Call-point overrides visible. |

---

## Section 6 — Assessment Plan (the chronology of formal moments)

The new typed primitive — every course declares when assessment moments fire and how items are sampled.

| What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|
| **Declared assessment design per course.** The educator can declare: this course has an upfront Baseline, optionally mid-point checks, and a final assessment. | CourseAssessmentPlan typed primitive on Playbook.config. IELTS Speaking Practice currently declares: end-of-course Mock, mounted in exam shell, scored via the IELTS LLM rubric, sampling cross-curriculum with a per-criterion floor of 4 items, target 6, max 8. | Course → Scoring tab → Assessment Plan section. End moment shown. (UI editor for the plan is not yet — but the data is readable.) |
| **Sampling strategy per moment.** For each assessment moment, the educator declares sampling scope (per-unit / cross-curriculum / weakest-skill-anchored), item count (min / target / max), content kind, stratification. | Sampling policy declared inside each moment. | IELTS Mock: sample is cross-curriculum, 4–6–8 items, per-criterion stratification (one per skill minimum). Live Mock: see that range of items appear. |
| **Sampling engine actually picks items at session start.** When a Mock starts, the system reads the plan and picks the sampled items. | Course-agnostic sampling engine consumes the plan. | Start a Mock on a fresh learner. Count items presented — should fall within the configured min/target/max. |
| **Courses with no formal assessment declare so explicitly.** Coaching-only courses don't silently fall through. | Plans can declare "no formal plan" with a reason. | IELTS Speaking Practice DOES have a plan (Mock end). Other courses (Big Five OCEAN, CIO/CTO Revision Aid) declare no plan. |
| **Coverage gate stops the team shipping new courses with no decision.** Either declare a plan or declare "no plan". | Coverage gate runs at build time. | Not testable by you — but means future new courses can't slip through. |

---

## Section 7 — Behavioural Test Matrix (the live experience)

This is the original behaviour-by-behaviour matrix from before, kept here because some things are best tested live not by inspecting knobs.

### A. Tutor Behaviour Inside Each Module Section

| What you asked for | What we built | How to test it |
|---|---|---|
| Part 1 tutor coaches per-answer. | Tutor mode wired. | Live Part 1 — corrections after each answer, retry prompted. |
| Part 2 tutor silent during long turn. | Examiner mode wired. | Live Part 2 — silent during prep + 2-min monologue. |
| Part 3 tutor coaches per-answer. | Tutor mode wired. | Live Part 3 — coaching pattern. |
| Mock Exam tutor uses formal examiner posture throughout. | Mock-exam mode wired with formal framing. | Live Mock — formal posture across all 3 parts; bands at end. |
| Baseline tutor uses examiner posture. | Examiner mode wired. | Live Baseline — examiner tone; indicative bands at end. |

### B. Part 3 Technique Focus Pin (the partner-blocking fix)

| What you asked for | What we built | How to test it |
|---|---|---|
| Learner sees technique focus pinned on screen (one of: "giving reasons" / "structuring an argument" / "handling a challenge" / "expanding an answer"). | Pin renders the technique label, not the scoring criterion. | Live Part 3 — pin shows technique label. Must NOT show "Fluency and Coherence" / "Lexical Resource" / "Grammatical Range and Accuracy" / "Pronunciation" during the session. |
| Pin updates as focus changes mid-session. | Substrate supports updating mid-session. | Pin can change between answers. Switching is driven by selection rules still under pedagogy review — observe whether the switches feel right and feed back. |
| Runtime guard blocks scoring-criterion labels from ever rendering to a learner surface during a session. | Leak-detection gate runs at compose time. | Not directly testable; but means any criterion-label leak you see is a known regression — flag immediately. |
| Mock Results screen is the ONE place learner-facing criterion labels are allowed. | Leak rule sanctions Mock Results explicitly. | After a Mock — per-criterion bands shown on the Results screen only. |

### C. Scoring — Bands After Baseline & Mock

| What you asked for | What we built | How to test it |
|---|---|---|
| After Baseline, indicative band scores per criterion. | LLM-judged scoring wired. | Run a Baseline. 4 bands appear within a few minutes. Defensible against transcript. |
| After Mock, updated bands. | Same path applies. | Run a full Mock. 4 bands on Mock Results screen. |
| Prosody as an enhancement, not the only path. | Prosody enhancement chip on skill bands when present. | If prosody vendor is connected, small "enhanced" chip next to band. If not, bands still valid. |

### D. Cue Cards / Topics / Stall Scaffolds

| What you asked for | What we built | How to test it |
|---|---|---|
| Part 2 cue card prompt appears. | Six content sources seeded; modules repointed. | Live Part 2 — cue card present. |
| Part 1 tutor draws from a topic pool. | Part 1 topic library source seeded. | Live Part 1 — opener from the seeded set. Variety across multiple sessions. |
| Part 3 themes related to Part 2. | Part 3 theme library seeded. | Live Part 3 right after Part 2 — questions feel related. |
| Stall recovery: 7 stall types handled. | Stall types declared; scaffold pool seeded. | Live Part 2 — deliberately stall ("I don't know", long silence). Tutor uses an appropriate scaffold, not just a repeat. |
| Source-resolution badge on every Modules tab row. | Status badge shipped (#2216). | Course → Modules tab → each row has a small badge. Green = sources resolve. |

### E. Learner Screen Type (Shell)

| What you asked for | What we built | How to test it |
|---|---|---|
| Mock Exam → formal exam-style screen. | Capability-driven exam shell mounts automatically on Mock. | Live Mock — visibly more formal screen than practice. Mode pill "Mock Exam". |
| Baseline → formal exam-style screen with different framing. | Same exam shell, different mode pill. | Live Baseline — same shell, mode pill "Examiner". |
| Part 1 / 3 practice → normal chat-feed screen. | Default chat-feed shell. | Live practice — standard chat UI. |
| Enrollment → intake wizard screen. | New intake-wizard shell shipped this week (#2222). | Fresh enrollment — intake wizard screen mounts. |
| Mock end → dedicated Results Readout screen. | New Results Readout shell shipped this week (#2220). | End of a Mock — dedicated readout screen with per-criterion bands. |
| One dispatcher decides what mounts. | Central dispatcher + Modules tab preview uses the same logic. | Modules tab preview matches the live experience for each module. |

### F. Educator Admin Surface

| What you asked for | What we built | How to test it |
|---|---|---|
| Modules tab is a bi-pane editor. | Bi-pane Modules tab editor shipped. | Course → Modules tab — left list, right intent-grouped cards (HOW / WHEN / ALLOWANCES). |
| Module Inspector cards vary by mode. | Mode-aware HOW cards. | Click a Part 2 module vs a quiz module — card content differs. |
| New Content tab for typed teaching content. | Content tab skeleton (read-only). | Course → Content tab. |
| Content tab shows per-chip item counts (e.g. "12 cue cards" / "27 LOs"). | Item-count chips landed this week (#2242). | Content tab — chips show the count beside each content type. |
| SIM-shell preview lens on Modules tab. | Preview lens shipped. | Modules tab → click a module → right pane shows the learner-facing preview. |
| Preview pane dims when selection is cross-cutting. | Dim + hint chip when a cross-cutting setting is being edited. | Modules / Journey / Teaching / Scoring tabs — pick a cross-cutting toggle → preview dims with explanation. |
| Teaching tab inspector hides module-scoped settings (which belong in the Module Inspector). | Scope filter applied to Teaching tab Inspector this week (#2243). | Course → Teaching tab → Inspector should NOT show settings that are module-scoped (those live on Modules tab). |
| Same scope filter on Journey and Scoring tabs. | Filter applied to Journey + Scoring tabs this week (#2245). | Course → Journey tab + Scoring tab — same — module-scoped settings absent from those inspectors. |
| Educator can see status of cascade values at a glance. | Data-presence coverage gate ensures cascade values resolve (#2240). | Indirectly visible — when a cascadeable knob is at default, cascade chip shows "system default". When set, chip shows source. |

---

## Section 8 — Comprehensive Delivery List (this week, ordered)

Every learner- or educator-facing PR merged for IELTS-relevant work in the past week. Cross-reference for the team only — tester doesn't need to read this row-by-row.

### Learner-facing changes (15)

| PR | What landed | What the tester / learner notices |
|---|---|---|
| #2134 | Part 3 focus pin shows technique label (the partner-blocker fix). | Pin on Part 3 screen shows technique focus, not criterion. |
| #2142 | Prosody enhancement chip on learner skill bands. | "Enhanced" chip on bands when prosody connected. |
| #2143 | IELTS LLM scoring rubric defined. | (Engine — surfaces as bands.) |
| #2153 | Generic SessionFocus substrate powers Part 3 fix. | (Engine.) |
| #2155 | LLM scoring spec wired into the scoring stage. | Bands appear after Baseline / Mock. |
| #2157 | Prosody reclassified as enhancement, not primary. | Band display style. |
| #2164 | Part 3 selection rules defined. | Pin updates during Part 3. |
| #2165 | Runtime gate blocks internal labels from leaking to learner. | Safety net. |
| #2169 | LLM scoring toggle moved from engineering setting to per-course. | Course → Scoring tab toggle. |
| #2199 | Single dispatcher decides learner shell. | (Engine.) |
| #2202 | Three capability-driven shell components. | Live: shells match the mode. |
| #2218 | Learner chat surface dispatches via the central dispatcher. | Live: exam shell on Mock/Baseline, chat shell on practice. |
| #2220 | Results Readout shell + post-Mock mount. | Mock end → dedicated readout screen. |
| #2221 / #2241 | IELTS content sources seeded + module configs repointed. | Part 1/2/3 sessions show real content. |
| #2222 | Intake Wizard shell + enrollment mount. | First-ever learner interaction → intake wizard screen. |

### Educator-facing changes (20)

| PR | What landed | Where to verify |
|---|---|---|
| #2120 | Preview pane dims on cross-cutting selection. | Multi-tab — pick a cross-cutting toggle, preview dims. |
| #2121 | Modules tab bi-pane editor (HOW / WHEN / ALLOWANCES). | Course → Modules tab. |
| #2126 | Coloured stripe on bi-pane cards. | Modules tab cards. |
| #2127 | Modules tab left-hand list as card-style rows. | Modules tab left rail. |
| #2128 | IELTS seed reads from the canonical course-reference doc. | Wizard course-creation flow. |
| #2130 | IELTS seed writes per-cue / per-topic / per-scaffold learning-objective assertions. | Course content data on Inspector. |
| #2131 | Every content assertion stamped with its teaching method. | Inspector — assertions show method. |
| #2133 | Course-reference doc upload auto-extracts content. | Wizard upload flow. |
| #2189 | Four scoring knobs cascade from Domain → Course. | Domain settings + Course Scoring tab — cascade chips. |
| #2200 | Three learner-facing enums properly typed (cue card type, stall type, score readout mode). | Foundation; per-cue-card editors next sprint. |
| #2201 | Behaviour-parameter registry amended with 8 IELTS-relevant rows. | Registry view. |
| #2211 | SIM-shell preview lens on Modules tab. | Modules tab → click module → preview. |
| #2213 | New Content tab (read-only browse). | Course → Content tab. |
| #2214 | Module Inspector cards vary by mode. | Modules tab → click different-mode modules. |
| #2215 | Preview lens uses canonical dispatcher. | Modules tab preview matches live. |
| #2216 | Source-resolution status badge on each Modules tab row. | Modules tab — green/amber badge. |
| #2217 | LLM IELTS Scoring toggle + cascade chip on Course Scoring tab. | Course → Scoring tab. |
| #2240 | Data presence coverage gate for cascade knobs. | Indirect — cascade chips never claim "set" for unset values. |
| #2242 | Content tab per-chip item counts + LO-ref backfill. | Course → Content tab — chips show counts. |
| #2243 / #2245 | Teaching / Journey / Scoring tab inspectors drop module-scoped settings. | Those tab inspectors no longer show settings that belong on Modules tab. |

---

## Section 9 — What to Flag if You See It

Behaviours that should NOT happen. Flag with the time, course, module, and what you were doing.

1. **Scoring criterion labels visible during a Part 3 session.** Pin should show technique focus, never "Fluency and Coherence" / "Lexical Resource" / "Grammatical Range and Accuracy" / "Pronunciation" during a session.
2. **Empty cue card on a Part 2 session.** Cards should always be present.
3. **Baseline or Mock ending with no band scores.** Should always produce 4 bands.
4. **Tutor coaching during a Mock or Baseline.** Examiner mode is silent during answers.
5. **Tutor silent during Part 1 or Part 3 practice.** Tutor mode coaches per-answer.
6. **Mode pill showing something other than "Examiner", "Mock Exam", or absent (practice).**
7. **Wrong shell on wrong screen.** Mock = exam shell, practice = chat feed, enrollment = intake wizard, Mock end = results readout.
8. **Cascade chip showing wrong source.** Setting at Course should mark chip "Course"; not setting should mark chip "Domain" or "system default".
9. **Source badge green on Modules row but no content shows up at runtime.** Disagreement between badge logic and resolver.
10. **Teaching / Journey / Scoring tab Inspector showing a module-scoped setting.** Those belong on Modules tab.
11. **Content tab item count saying 0** for a module that has content. Cross-check.
12. **Intake wizard not appearing on first enrollment.** The Intake Wizard shell should mount automatically.
13. **Captured profile fields don't appear on learner profile post-intake.** Intake-to-profile write may have failed.

---

## Section 10 — Suggested Test Walkthrough

For a single fresh learner enrollment on the IELTS Speaking Practice course, run in this order.

1. **Educator surface sweep.** Visit Course → Overview / Modules (with preview lens) / Journey / Teaching / Scoring / Content tabs. Verify every section above is populated.
2. **Fresh enrollment.** Sign up a new learner. Verify Intake Wizard mounts. Walk through the intake — goals capture, About-You, profile fields. Verify the learner profile shows captured fields.
3. **Baseline Assessment.** Verify exam shell mounts, examiner tone, no criterion labels visible, indicative bands at end.
4. **Part 1.** One session. Verify topic from topic pool, tutor coaches per-answer.
5. **Part 2.** One session. Verify cue card from cue-card pool, examiner posture during 2-min turn, deliberately stall once and verify scaffold response.
6. **Part 3.** One session. Verify technique focus pin appears, tutor coaches per-answer.
7. **Mock Exam.** Full run. Verify mock-exam mode posture, exam shell throughout, bands at end.
8. **Mock Results.** Verify dedicated Results Readout screen, per-criterion bands shown.
9. **Cross-check the profile** — bands per criterion should differ between Baseline and Mock if any practice happened in between.

---

## Section 11 — Not Yet Done (visible to operator, not learner)

| Gap | What the educator wants | Status |
|---|---|---|
| Assessment Plan editor | Bi-pane editor on Course Scoring tab to compose Baseline / mid-points / Mock. | Substrate done; UI editor next sprint. |
| Per-cue-card type editor | Tag each Part 2 cue card as personal vs abstract. | Data type done; editor next sprint. |
| Stall-recovery scaffold editor | Edit the scaffold pool. | Data type done; editor next sprint. |
| Score readout mode editor | Per-module on-screen / end / aloud setting. | Data type done; editor next sprint. |
| Per-module shell capability overrides | Small per-course visual tweaks. | Data type done; editor not yet. |
| Part 3 selection rules editor | Author the rules deciding focus switches. | Rules under pedagogy review. |
| Assessment Plan resolution badge on Course Overview | At-a-glance health of the course's plan. | Not yet. |
| Per-skill scoring target editor | "Cohort target = band 6.5 in Pronunciation". | Filed for next sprint. |
| MCQ-rounds data feed | Real question data for quiz-mode modules (CIO/CTO, not IELTS). | Filed for next sprint. |

---

## Section 12 — What's Changed Since Last Test Cycle

If you've tested IELTS Speaking Practice before, the headlines:

- Bands now appear after Baseline and Mock (was silent — scoring path required an unwired vendor).
- Part 3 focus pin shows technique labels (was scoring criterion — the partner-blocker).
- Mock Exam has its own formal screen via mock-exam mode (was using the same shell as Baseline).
- Dedicated Results Readout screen at Mock end (didn't exist).
- Dedicated Intake Wizard screen at enrollment (didn't exist).
- Cue cards now appear in Part 2 / Baseline / Mock (was empty — content sources missing).
- Per-course LLM Scoring toggle (was an environment variable; no per-course tuning).
- Cascade chips on scoring knobs — educator can see whether a value is set at Domain, Course, or default.
- SIM-shell preview lens on Modules tab (educator sees learner-facing screen without leaving editor).
- New Content tab with per-chip item counts.
- Source-resolution badges on Modules tab rows.
- Teaching / Journey / Scoring tab inspectors no longer show module-scoped settings.

Everything else is foundation work for next sprint's per-cue-card / per-scaffold / per-Assessment-Plan editor surfaces.
