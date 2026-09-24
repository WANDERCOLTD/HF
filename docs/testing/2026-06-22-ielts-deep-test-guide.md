# IELTS Deep Test Guide — Knob-by-Knob, Source-by-Source, Module-by-Module

**Audience:** Eldar and Boaz.
**Purpose:** Every educator-tunable value on the IELTS Speaking Practice course, every content source, every outcome, every per-module setting — each with "what you asked for", "what we built", "how to test it". The shallow survey guide lives alongside this; use this one when you want exhaustive coverage.

---

## Environment Status — Ready

| Environment | URL | Content sources | Module source-refs | LLM Scoring | Assessment Plan |
|---|---|---|---|---|---|
| **DEV (demo)** | dev.humanfirstfoundation.com | 6 of 6 present | 11 of 11 resolve | ON | Upfront Baseline + End Mock |
| **SANDBOX** | engineering local | 6 of 6 present | 11 of 11 resolve | ON | Upfront Baseline + End Mock |

If anything in this table ever looks wrong, that's an environment reset, not a bug.

---

# Part 1 — Course-Level Setup & Identity

These are the high-level decisions the educator made once when designing the course.

| # | What you asked for (BDD intent) | What we built | How to test it |
|---|---|---|---|
| 1.1 | The course is targeted at IELTS test-takers aiming for Band 6.5–7.5. | Audience set on the course. | Course → Overview tab → Audience reads as IELTS test-taker cohort. Live: tutor's framing assumes IELTS test prep. |
| 1.2 | Subject discipline = English language assessment prep (distinct from coaching). | Subject discipline field set. | Course → Overview tab. Field is set to language-assessment-prep, not coaching/content. |
| 1.3 | Teaching mode = directive, exam-prep oriented (not open Socratic). | Teaching mode field; cascadeable from Domain. | Course → Teaching tab. Mode visible with cascade chip. Tutor in Part 1 uses directive coaching, not pure questioning. |
| 1.4 | Interaction pattern = multi-turn (Q → A → feedback → retry). | Interaction-pattern field. | Course → Teaching tab. Pattern visible. Live Part 1: tutor asks, learner answers, tutor corrects, learner retries. Not "next question". |
| 1.5 | Plan emphasis = practice-and-feedback (not content-delivery). | Plan-emphasis field. | Course → Teaching tab. Emphasis shown. |
| 1.6 | Progression mode = sequenced (Baseline → P1 → P2 → P3 → Mock). | Progression mode = sequenced. | Course → Modules tab. Module list in fixed order. Learner sees Baseline first. |
| 1.7 | Strict prerequisites = ON (Mock locked until Baseline + practice). | Strict-prerequisites boolean. | Brand-new learner: Baseline is the only available next module. Mock is locked until Baseline complete. |
| 1.8 | Module sequence policy allows re-running practice modules. | Module-sequence-policy field. | After completing first Part 1, learner can re-enter Part 1. System tracks attempt count. |
| 1.9 | First call mode = baseline_assessment (NOT a normal coaching session). | First-call-mode field. | First-ever session for a learner is exam-shell Baseline, not chat-feed coaching. |
| 1.10 | Lesson plan mode = adaptive (tutor doesn't read from a fixed script). | Lesson-plan-mode field. | Live Part 1: tutor's questions depend on what learner just said, not a rigid sequence. |
| 1.11 | Session count target is set. | Session-count number on course. | Course → Overview tab. Number visible. |
| 1.12 | Per-session duration target is set. | Duration-mins number on course. | Course → Overview tab. Duration visible. |
| 1.13 | Modules-authored = TRUE (modules are educator-authored, not LLM-generated). | Modules-authored flag. | Course → Modules tab. Module list shown as authored, not generated-on-demand. |
| 1.14 | Module source tag for traceability (which seed brought this in). | seedSourceTag = "ielts-seed-v1". | Engineering visibility only; not a tester action. |

---

# Part 2 — Scoring System (deep)

## 2.1 LLM IELTS Scoring (the per-course toggle, replacement for the engineering env-var)

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 2.1.1 | LLM Scoring toggle exists on the Course Scoring tab. | Toggle on Course → Scoring tab. | Visit Course → Scoring → see the toggle. |
| 2.1.2 | Toggle cascades from Domain when unset. | Cascade chip shows source (Course / Domain / system default). | Unset at Course, set at Domain → chip says "Domain". Set at Course → chip says "Course". |
| 2.1.3 | Toggling OFF stops band production. | The scoring path skips when disabled. | Flip OFF. Run a Baseline. No bands appear on learner profile. |
| 2.1.4 | Toggling ON produces bands. | The LLM-judged path runs. | Flip ON (currently ON). Run a Baseline. 4 bands appear within a few minutes. |
| 2.1.5 | Toggling at Domain → applies to all child Courses (unless overridden). | Cascade is read at the call point. | Flip at Domain → Course inherits. Override at Course → Course value wins. |

## 2.2 Scoring Mode + Tier Preset

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 2.2.1 | Course uses transcript-based LLM scoring with prosody as enhancement. | Scoring mode field. | Course → Scoring tab → Mode field shown. |
| 2.2.2 | Course uses an IELTS 9-band tier preset (not the generic 4-tier scheme). | tierPresetId set to IELTS 9-band. | Scoring tab → Rubric Calibration lens shows the 9 bands (1–9). |
| 2.2.3 | Each of the 4 IELTS criteria maps to the same 9-band scheme. | skillTierMapping declares per-criterion mapping. | Rubric Calibration lens: Fluency / Lexical / Grammatical / Pronunciation each shown with the 9 bands. |

## 2.3 Tier Bands (the 9-band IELTS scheme on this course)

Each tier-band-row has 3 sub-knobs: threshold, label, value.

| # | Tier | Threshold | Band Label | Tester verifies |
|---|---|---|---|---|
| 2.3.1 | secure | ≥ 1.00 | Band 7 | Learner scoring at the top tier sees "Band 7" framing. |
| 2.3.2 | developing | ≥ 0.70 | Band 5.5 | Learner at mid-high tier sees "Band 5.5" framing. |
| 2.3.3 | emerging | ≥ 0.55 | Band 4 | Learner at mid-low tier sees "Band 4" framing. |
| 2.3.4 | approachingEmerging | ≥ 0.30 | Band 3 | Learner at low tier sees "Band 3" framing. |
| 2.3.5 | (below approaching) | < 0.30 | (system default) | Learner below 0.30 — no formal label; framing softens. |

## 2.4 Mastery / Progression Thresholds

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 2.4.1 | LO Mastery Threshold (LO becomes "mastered" at this score). | Configurable; cascadeable Domain → Course. | Course → Scoring tab. Threshold shown with cascade chip. |
| 2.4.2 | Skill EMA Half-life (how strongly recent sessions weight). | Configurable in days. | Scoring tab → half-life shown. Setting shorter weights recent more strongly. |
| 2.4.3 | Memory Decay Scale (how quickly memories stale). | tolerances.memoryDecayScale field. | Scoring tab → Tolerances lens → scale field. |

## 2.5 Progress Narrative

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 2.5.1 | Course generates a written progress narrative for the learner. | progressNarrative.enabled flag. | Learner profile after multiple sessions → written narrative visible. Toggle OFF → no narrative. |

## 2.6 BehaviorTargets — Per-Skill Scoring Targets (the 4 IELTS criteria)

| # | Parameter ID | Educator-set Target | Scope | What it means | How to test it |
|---|---|---|---|---|---|
| 2.6.1 | skill_fluency_and_coherence | 0.65 | Playbook | Cohort target = Band 6.5 on Fluency and Coherence. | Learner profile shows current Fluency band; gap to target visible. |
| 2.6.2 | skill_lexical_resource | 0.65 | Playbook | Cohort target = Band 6.5 on Lexical Resource. | Learner profile shows current Lexical band; gap visible. |
| 2.6.3 | skill_grammatical_range_and_accuracy | 0.65 | Playbook | Cohort target = Band 6.5 on Grammatical Range and Accuracy. | Learner profile shows current Grammar band; gap visible. |
| 2.6.4 | skill_pronunciation | 0.65 | Playbook | Cohort target = Band 6.5 on Pronunciation. | Learner profile shows current Pronunciation band; gap visible. |

**Per-skill scoring-target editor (UI) is still pending** — currently editable only in the underlying data. Filed as next-sprint work.

---

# Part 3 — Welcome & Intake (deep)

## 3.1 Welcome Toggles

| # | Toggle | Current value | What you asked for | What we built | How to test it |
|---|---|---|---|---|---|
| 3.1.1 | welcome.goals.enabled | TRUE | Capture learner's goals at intake. | Toggle on Journey tab. | Fresh enrollment: learner sees a goals question. |
| 3.1.2 | welcome.aboutYou.enabled | TRUE | Capture learner's background. | Toggle on Journey tab. | Fresh enrollment: learner sees an About-You step. |
| 3.1.3 | welcome.aiIntroCall.enabled | FALSE | Optional AI-led intro call. | Toggle on Journey tab. | Currently OFF. Flip ON → fresh enrollment offers an intro call. |
| 3.1.4 | welcome.knowledgeCheck.enabled | FALSE | Welcome-level knowledge check. | Toggle on Journey tab. | Currently OFF. |

## 3.2 Session-Flow Intake (the deeper intake configuration)

| # | Setting | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 3.2.1 | sessionFlow.welcomeMessage | "Test Opening 2" | Educator can write a custom welcome message. | Edit the message on Journey tab. Re-enroll fresh learner. New message appears. |
| 3.2.2 | sessionFlow.intake.goals.enabled | TRUE | Capture goals during the intake stop. | Fresh enrollment intake collects goals. |
| 3.2.3 | sessionFlow.intake.goals.question | "What would you like to get out of this course?" | Educator phrases the goals question. | Live intake: learner sees that exact question. Edit → new wording appears. |
| 3.2.4 | sessionFlow.intake.aboutYou.enabled | TRUE | Capture About-You during intake. | Live intake collects About-You. |
| 3.2.5 | sessionFlow.intake.knowledgeCheck.enabled | TRUE | Capture a knowledge check during intake. | Live intake includes a quick knowledge check. |
| 3.2.6 | sessionFlow.stops | [true] | Whether a structured intake stop exists. | Live: learner goes through the intake stop on enrollment. |

## 3.3 Profile Fields Captured (from the Baseline module)

The Baseline module's profileFieldsToCapture source-ref points at `ielts-speaking-profile-fields`. Each field is captured and stored on the learner profile.

| # | Profile field key | Question shown to learner | How to test it |
|---|---|---|---|
| 3.3.1 | profile:reason | "What's bringing you to IELTS Speaking? Work, study, immigration, something else?" | Live intake → learner sees this question → response saved on profile. |
| 3.3.2 | (further profile fields per the source) | (see source content) | After intake, profile shows captured answers. |

**Tester action:** open the learner profile after intake. Verify all captured fields appear. Cross-check against the source's declared field list (Eldar can pull the source content).

## 3.4 Intake-to-Course Effect

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 3.4.1 | Captured profile shapes tutor framing. | Captured fields written to learner record; read by composition. | Live Part 1 after intake. Tutor's tone reflects the learner's stated reason and target band. |
| 3.4.2 | Captured exam date drives urgency framing. | Composition reads exam date. | Set a near exam date in intake. Live Part 1: tutor's framing reflects urgency. Set a far date: relaxed framing. |

---

# Part 4 — Per-Module Deep Dive

Each of the 5 IELTS modules has its own knob set. Below: every knob on every module, with the actual current value.

## 4.1 Baseline Assessment

| # | Knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 4.1.1 | mode | examiner | Tutor stays silent during answers. | Live Baseline. Tutor reads cue card; learner answers; tutor doesn't interrupt. |
| 4.1.2 | label | "Baseline Assessment" | Educator-visible label. | Course → Modules tab. Label shown. |
| 4.1.3 | duration | "20 min fixed" | Fixed 20-minute session. | Live Baseline ends at the 20-minute mark. |
| 4.1.4 | minSpeakingSec | 1200 | Learner should speak ~20 min total. | Track speaking time in a Baseline. Below the floor → tutor prompts to continue. |
| 4.1.5 | questionTarget | min 0, target 0 | No fixed question count (free-form Baseline). | Live: tutor's question count varies session-to-session. |
| 4.1.6 | scoreReadoutMode | on-screen | Bands shown on-screen at end. | Baseline end → bands appear on-screen, not just read aloud. |
| 4.1.7 | cueCardPool | 88 cards from cue-card-bank-v1 | Cue card prompts available. | Live: cue card appears at the long-turn moment. Multiple Baselines show variety. |
| 4.1.8 | scaffoldPool | 14 scaffolds from stall-scaffolds-monologue | Recovery scaffolds for monologue. | Live: stall in Baseline long turn. Tutor uses a monologue-style scaffold (e.g. "Take another moment."). |
| 4.1.9 | scheduledCues | [] (none) | No timed cues during Baseline. | Live: tutor doesn't fire automatic time cues. |
| 4.1.10 | profileFieldsToCapture | 4 fields from ielts-speaking-profile-fields | Captured during intake. | After Baseline → profile shows the 4 fields populated. |
| 4.1.11 | closingLine | "That's the end of your Baseline. I'll share your focus area on screen." | Verbatim closing. | Live Baseline end: tutor says this line verbatim. |
| 4.1.12 | firstTimeOrientationLine | "This is a relaxed first call, not a test, so I can hear you speak English and give you an honest starting point. We'll do all three Parts at exam pace — Part 1, then a cue card with one minute to prepare, then a few follow-up questions. About twenty minutes total." | Verbatim first-time opener. | Fresh learner's first Baseline: tutor opens with this line verbatim. Second Baseline (re-attempt): opener skipped or briefer. |

## 4.2 Part 1: Familiar Topics

| # | Knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 4.2.1 | mode | tutor | Tutor coaches per-answer. | Live Part 1: corrections after each answer. |
| 4.2.2 | label | "Part 1: Familiar Topics" | Educator-visible label. | Modules tab. |
| 4.2.3 | duration | "Student-led" | Learner chooses when to end. | Live: tutor offers to continue or end at intervals. |
| 4.2.4 | minSpeakingSec | 600 | Learner should speak ~10 min. | Track speaking time; below the floor → tutor prompts. |
| 4.2.5 | questionTarget | min 5, target 8 | 5–8 questions per Part 1 session. | Count questions in a Part 1. Tutor wraps within range. |
| 4.2.6 | scoreReadoutMode | end-of-module-on-screen | Bands at end, on-screen. | Part 1 end: bands appear on-screen, not mid-session. |
| 4.2.7 | topicPool | 52 topics from part1-topic-library-v1 | Variety of Part-1 topics. | Across multiple Part 1 sessions: different topics. |
| 4.2.8 | scaffoldPool | 15 scaffolds from stall-scaffolds-discussion | Recovery scaffolds for discussion. | Stall in Part 1 ("I don't know"). Tutor uses a discussion-style scaffold (e.g. "Take your time."). |
| 4.2.9 | scheduledCues | [] | No timed cues. | Tutor doesn't auto-fire time cues. |
| 4.2.10 | closingLine | "Good. Want another Part 1 topic, switch to a different Part, or end here?" | Verbatim closing. | Live Part 1 end: tutor says verbatim. |
| 4.2.11 | firstTimeOrientationLine | "Part 1 questions are short, on familiar topics like home, work, hobbies. Aim for two or three sentences per answer — give a reason or an example after your first sentence." | Verbatim first-time opener. | Fresh learner's first Part 1: tutor opens with this line. |

## 4.3 Part 2: Cue Card Monologues

| # | Knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 4.3.1 | mode | mixed | Coaching with examiner-style long turn. | Live Part 2: tutor coaches before/after but silent during 2-min monologue. |
| 4.3.2 | label | "Part 2: Cue Card Monologues" | Educator-visible label. | Modules tab. |
| 4.3.3 | duration | "Student-led" | Learner chooses end. | Live: tutor offers to continue or end. |
| 4.3.4 | minSpeakingSec | 120 | Learner should speak ≥ 2 min in the long turn. | Below 120s → tutor prompts to continue. |
| 4.3.5 | questionTarget | min 1, target 1 | 1 cue card per Part 2 session. | Live: one card per session. |
| 4.3.6 | scoreReadoutMode | end-of-module-on-screen | Bands at end, on-screen. | Part 2 end: bands on-screen. |
| 4.3.7 | cueCardPool | 88 cards from cue-card-bank-v1 | Same library as Baseline / Mock. | Multiple Part 2 sessions show different cards. |
| 4.3.8 | scaffoldPool | 14 monologue scaffolds | Stall recovery during monologue. | Stall during the 2-min long turn. Tutor scaffold (e.g. "Take another moment."). |
| 4.3.9 | scheduledCues | [{at:45,"15 seconds left"}, {at:60,"Your two minutes start now"}] | Time cues fire at 45s + 60s mark. | Live Part 2 prep: at 45s mark, tutor says "15 seconds left". At 60s mark, tutor signals "Your two minutes start now". |
| 4.3.10 | closingLine | "That's the end of Part 2. Take a moment, then we'll move on." | Verbatim closing. | Live Part 2 end: tutor says verbatim. |
| 4.3.11 | firstTimeOrientationLine | "In Part 2 you'll speak for two minutes on a single cue card. You'll get one minute to prepare. Cover all the bullets and try to use a range of tenses — past, present, future — in one turn." | Verbatim first-time opener. | Fresh learner's first Part 2: tutor opens with this line. |

## 4.4 Part 3: Abstract Discussion

| # | Knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 4.4.1 | mode | tutor | Tutor coaches per-answer. | Live Part 3: corrections after each answer. |
| 4.4.2 | label | "Part 3: Abstract Discussion" | Educator-visible label. | Modules tab. |
| 4.4.3 | duration | "Student-led" | Learner chooses end. | Live: tutor offers to continue or end. |
| 4.4.4 | minSpeakingSec | 420 | Learner should speak ≥ 7 min total. | Track speaking time; below floor → prompt. |
| 4.4.5 | questionTarget | min 4, target 5 | 4–5 questions per Part 3 session. | Count questions in a Part 3. |
| 4.4.6 | scoreReadoutMode | end-of-module-on-screen | Bands at end, on-screen. | Part 3 end: bands on-screen. |
| 4.4.7 | topicPool | 64 themes from part3-theme-library-v1 | Themes linked to Part 2 topics. | Part 3 after Part 2: tutor's themes feel related to the Part 2 cue card. |
| 4.4.8 | scaffoldPool | 15 discussion scaffolds | Stall recovery for discussion. | Stall in Part 3. Tutor scaffold (e.g. "Take your time."). |
| 4.4.9 | scheduledCues | [] | No timed cues. | Tutor doesn't auto-fire. |
| 4.4.10 | closingLine | "Good. Another Part 3 theme, switch Parts, or end here?" | Verbatim closing. | Live Part 3 end: tutor says verbatim. |
| 4.4.11 | firstTimeOrientationLine | "Part 3 questions are abstract — opinion, comparison, prediction. Aim for three or four sentences per answer. Use an extension technique: a reason, a contrast, an example, or a careful hedge." | Verbatim first-time opener. | Fresh learner's first Part 3: tutor opens with this line. |

## 4.5 Mock Exam

| # | Knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 4.5.1 | mode | examiner | Formal examiner posture throughout. | Live Mock: tutor stays examiner across all 3 sub-parts. |
| 4.5.2 | label | "Mock Exam" | Educator-visible label. | Modules tab. |
| 4.5.3 | duration | "20 min fixed" | Fixed 20-minute simulation. | Live Mock ends at 20 min. |
| 4.5.4 | minSpeakingSec | 1200 | Learner should speak ~20 min. | Track in Mock. |
| 4.5.5 | questionTarget | min 0, target 0 | No fixed question count — sampling drives. | (See Assessment Plan §6 for sampling target.) |
| 4.5.6 | scoreReadoutMode | aloud-with-indicative-qualifier | Bands read aloud at end with "indicative" qualifier. | Live Mock end: tutor reads bands aloud, qualifying them as indicative. |
| 4.5.7 | cueCardPool | 88 cards from cue-card-bank-v1 | Same library as Baseline / Part 2. | Live Mock: cue card present. |
| 4.5.8 | scaffoldPool | 14 monologue scaffolds | Stall recovery during Mock Part 2. | Stall during Mock long turn. Tutor scaffold. |
| 4.5.9 | scheduledCues | [{at:45,"15 seconds left"}, {at:60,"Your two minutes start now"}] | Time cues fire during Mock Part 2. | Live Mock Part 2 prep: cues fire as in Part 2. |
| 4.5.10 | closingLine | "That's the end of your Mock Exam. Here are your indicative bands." | Verbatim closing. | Live Mock end: tutor says verbatim before the readout. |
| 4.5.11 | firstTimeOrientationLine | "This is a full IELTS Speaking simulation at exam pace — Part 1, Part 2 cue card with one minute to prepare and two minutes to speak, then Part 3 follow-up questions. About twenty minutes total. I'll share your indicative bands at the end." | Verbatim first-time opener. | Fresh learner's first Mock: tutor opens with this line. |

## 4.6 Module Defaults (applies when a module doesn't override)

| # | Default | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 4.6.1 | mode | tutor | Default tutor coaching mode for unspecified modules. | (Not testable on IELTS — every module sets its own.) |
| 4.6.2 | intake | none | Intake doesn't fire per-module by default. | Per-module sessions don't trigger intake mid-course. |
| 4.6.3 | bandVisibility | hidden_mid_module | Bands hidden during a session. | Live: no band readouts shown mid-session. |
| 4.6.4 | theoryDelivery | embedded_only | No standalone theory deliveries. | Live: tutor weaves theory into coaching, doesn't pause for a theory lecture. |
| 4.6.5 | correctionStyle | single_issue_loop | One correction per answer, then retry. | Live Part 1 / Part 3: tutor picks one issue per answer, asks for retry. |

---

# Part 5 — Content Sources Deep Dive

The 6 ContentSource rows the IELTS modules consume.

## 5.1 cue-card-bank-v1 (Source 2) — 88 cue cards

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 5.1.1 | A pool of Part 2 cue cards covering people, places, things, experiences. | 88 cards seeded as a ContentSource. | Modules tab → Baseline/Part 2/Mock → Source badge green. Live: cards appear across sessions. |
| 5.1.2 | Each card has a topic + bullet structure. | Card shape: {topic, bullets[]}. | Live Part 2: tutor reads topic + bullets aloud (or shown on-screen). |
| 5.1.3 | Cards re-used across Baseline / Part 2 / Mock per BDD reuse-path. | All 3 modules share the same source. | Cards may repeat across Baseline → Part 2 → Mock for the same learner. |

## 5.2 part1-topic-library-v1 (Source 1) — 52 topics

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 5.2.1 | Familiar-topic question library for Part 1. | 52 topics, each with question variations. | Modules tab → Part 1 source badge green. Live: variety across Part 1 sessions. |
| 5.2.2 | Topics cover the 4 most common Part 1 clusters (home, work, hobbies, daily routine). | Topic set includes those clusters. | Across multiple Part 1 sessions: at least one from each cluster appears. |

## 5.3 part3-theme-library-v1 (Source 3) — 64 themes

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 5.3.1 | Abstract-discussion themes linked to Part 2 topic clusters. | 64 themes seeded. | Live Part 3 after Part 2: tutor's theme relates to the Part 2 card topic. |
| 5.3.2 | Themes support the 7 Part 3 question types. | Themes carry question-type metadata. | Live Part 3: tutor's questions span the 7 types across a session. |

## 5.4 stall-scaffolds-monologue (Source 6) — 14 scaffolds

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 5.4.1 | Recovery prompts when learner stalls during a 2-minute monologue. | 14 scaffolds. | Live Part 2 / Mock Part 2: stall deliberately → tutor uses one of these scaffolds. |
| 5.4.2 | Scaffolds match the 7 stall types. | Scaffold set covers each type. | See §7 below for the 7 stall types. |

## 5.5 stall-scaffolds-discussion (Source 7) — 15 scaffolds

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 5.5.1 | Recovery prompts for discussion-style stalls (Part 1 / Part 3). | 15 scaffolds. | Live Part 1 / Part 3: stall → tutor uses one. |
| 5.5.2 | Scaffolds match the 7 stall types in discussion form. | Type-tagged. | See §7. |

## 5.6 ielts-speaking-profile-fields (Source 14) — 4+ profile fields

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 5.6.1 | Capture the learner's IELTS profile (reason, target band, exam date, current self-band, etc.). | Fields source-linked to the Baseline module. | Live intake: learner sees these prompts. Profile populated after Baseline. |

---

# Part 6 — Assessment Plan (deep)

The CourseAssessmentPlan substrate. Two moments declared.

## 6.1 Upfront Baseline Moment

| # | Sub-knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 6.1.1 | kind | upfront-baseline | First chronological moment. | Verify Baseline runs first. |
| 6.1.2 | shellKind | exam | Mounted in the formal exam shell. | Live Baseline: dark exam screen, not chat-feed. |
| 6.1.3 | moduleSlug | baseline | Runs the Baseline module. | Live first session = the baseline module. |
| 6.1.4 | scoringSpec | spec-ielts-measure-001 | Uses the IELTS LLM rubric. | Bands appear after Baseline. |
| 6.1.5 | samplingPolicy.scope | cross-curriculum | Samples across the whole curriculum, not per-unit. | Items across Baseline span multiple parts/topics, not one bucket. |
| 6.1.6 | samplingPolicy.contentKind | cue-card | Samples cue cards. | Live: cue card prompts seen. |
| 6.1.7 | samplingPolicy.count.min | 3 | At least 3 items. | Count items in a Baseline; ≥ 3. |
| 6.1.8 | samplingPolicy.count.target | 5 | Target 5 items. | Count items; typically 5. |
| 6.1.9 | samplingPolicy.count.max | 7 | At most 7. | Count; ≤ 7. |
| 6.1.10 | samplingPolicy.stratification.perCriterion | 1 | At least 1 item per criterion. | Across Baseline items: at least one card stratification per Fluency / Lexical / Grammar / Pronunciation. |

## 6.2 End Mock Moment

| # | Sub-knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 6.2.1 | kind | end-mock | Final chronological moment. | Mock runs at end of journey. |
| 6.2.2 | shellKind | exam | Mounted in the formal exam shell. | Live Mock: dark exam screen. |
| 6.2.3 | moduleSlug | mock | Runs the mock module. | Confirmed module shown. |
| 6.2.4 | scoringSpec | spec-ielts-measure-001 | Same LLM rubric. | Bands appear after Mock. |
| 6.2.5 | samplingPolicy.scope | cross-curriculum | Samples across. | Items span multiple parts. |
| 6.2.6 | samplingPolicy.contentKind | cue-card | Cue cards. | Live Mock Part 2: cue card. |
| 6.2.7 | samplingPolicy.count.min | 4 | At least 4 items (more than Baseline). | Count; ≥ 4. |
| 6.2.8 | samplingPolicy.count.target | 6 | Target 6 items. | Count; typically 6. |
| 6.2.9 | samplingPolicy.count.max | 8 | At most 8. | Count; ≤ 8. |
| 6.2.10 | samplingPolicy.stratification.perCriterion | 1 | At least 1 per criterion. | Cross-criterion coverage. |

## 6.3 No-Plan declaration (other courses)

| # | What you asked for | What we built | How to test it |
|---|---|---|---|
| 6.3.1 | Courses with no formal assessment declare so explicitly. | noAssessmentPlan flag on Playbook config. | Big Five OCEAN / CIO/CTO Revision Aid: declare no plan. They don't deliver a Baseline or Mock. |

---

# Part 7 — Stall Recovery (7 stall types)

The 7 stall types are now typed; each has scaffold variants in the monologue + discussion scaffold pools.

| # | Stall type | Triggered when | What the tutor should do | How to test it |
|---|---|---|---|---|
| 7.1 | early-stall | Learner starts but freezes within first few seconds. | Brief redirect (e.g. "Take another moment."). | Live Part 2: deliberately freeze in first 5 seconds. Tutor produces a brief scaffold, not a full reset. |
| 7.2 | deep-stall | Learner has been silent for an extended period (mid-turn). | Longer scaffold; offers an angle. | Stay silent 20+ seconds. Tutor offers a starter angle. |
| 7.3 | i-dont-know | Learner explicitly says "I don't know" / "no idea". | Tutor offers a starter angle, doesn't just repeat the question. | Say "I don't know" → tutor reframes, doesn't repeat verbatim. |
| 7.4 | opinion-gap | Learner is asked an opinion question but can't form one. | Tutor offers contrasting frames to choose from. | Live Part 3 opinion question: stall on it. Tutor offers two framings. |
| 7.5 | abstraction-freeze | Learner can talk concretely but freezes on abstract framings (common in Part 3). | Tutor invites the learner to anchor on a concrete example. | Live Part 3 abstract question: stall. Tutor invites a concrete example. |
| 7.6 | vocabulary-search | Learner pauses searching for a specific word. | Tutor offers a paraphrase prompt, not the word. | Hesitate mid-sentence on a word. Tutor invites paraphrase, doesn't supply the word. |
| 7.7 | blank-out | Learner loses their thread entirely mid-turn. | Tutor offers a re-anchor (e.g. "Let me ask differently"). | Mid-turn: lose your thread. Tutor re-anchors. |

---

# Part 8 — Part 3 Technique Focus (4 focus labels)

The pin shows ONE of these labels during a Part 3 session. The selection rule decides which.

| # | Focus label | When the engine should pin it (selection rule intent) | How to test it |
|---|---|---|---|
| 8.1 | giving reasons | When the learner's reasoning is the weakest dimension on the current Part 3 question type. | Live Part 3 on an "opinion" question type after some practice. Pin shows "Focus: giving reasons" if the learner has been weak on reasoning. |
| 8.2 | structuring an argument | When the learner's structural fluency is weakest (poor cohesion, jumping). | Live Part 3 on a complex theme. Pin shows "Focus: structuring an argument" if the learner has jumped between ideas. |
| 8.3 | handling a challenge | When the tutor has pushed back and the learner deflected or collapsed. | Tutor pushes back during Part 3 ("Why do you say that?"). Pin can switch to "Focus: handling a challenge". |
| 8.4 | expanding an answer | When the learner is producing short, undeveloped answers. | Live Part 3 with short answers. Pin shows "Focus: expanding an answer". |

The selection-rules pedagogy is still under team review — observe whether the pin label feels right and feed back.

The pin MUST NOT show "Fluency and Coherence" / "Lexical Resource" / "Grammatical Range and Accuracy" / "Pronunciation" during a session — those are scoring criteria (internal), allowed only on Mock Results.

---

# Part 9 — Voice & AI Runtime

| # | Knob | Current value | What you asked for | How to test it |
|---|---|---|---|---|
| 9.1 | voice provider | (cascadeable) | Educator picks the voice service. | Course → Voice tab. Provider visible. |
| 9.2 | voice id | (cascadeable) | Specific voice. | Voice tab. Live: tutor sounds like the picked voice. |
| 9.3 | language | English | Course language. | Voice tab. Tutor speaks English. |
| 9.4 | voiceConfig.maxDurationSeconds | 1800 | Hard cap on session length. | Voice tab. 30-minute cap visible. A runaway session is cut at 30 min. |
| 9.5 | voice.prosodyMode | ielts | IELTS-specific prosody profile. | Voice tab. Mode visible. Scoring uses IELTS prosody when prosody is connected. |
| 9.6 | per-call-point AI model overrides | (cascadeable) | Educator picks model per call-point. | Course → AI Config tab. Per-call-point overrides visible. |

---

# Part 10 — Outcomes (OUT-01..OUT-27) — the LEARN goals

27 learning outcomes the course tracks. Each is a discrete behaviour the learner should demonstrate. The system tracks per-LO mastery via `lo_rollup` strategy.

| # | Outcome ref | What the learner should demonstrate | How to test it |
|---|---|---|---|
| 10.1 | OUT-01 | Extends every answer to the minimum length expected for Part 1. | Part 1 sessions — learner produces 2–3-sentence answers. LO progress visible on profile. |
| 10.2 | OUT-02 | Selects the framework opening matched to the question type. | Live Part 1: learner uses appropriate openers per question type. |
| 10.3 | OUT-03 | Recovers from unknown topics without freezing. | Part 1: learner faces an unfamiliar topic and recovers (stall recovery counts). |
| 10.4 | OUT-04 | Maintains one-topic discipline through the long turn. | Part 2: learner stays on the cue card without drifting. |
| 10.5 | OUT-05 | Produces natural 2–3 sentence Part 1 answers. | Part 1: answers feel natural-length, not rushed or rambling. |
| 10.6 | OUT-06 | Uses varied discourse markers across answers. | Part 1: learner varies "well", "so", "you know", "actually", etc. |
| 10.7 | OUT-07 | Demonstrates confidence on the four most common Part 1 topic clusters. | Across multiple Part 1 sessions: home / work / hobbies / daily routine. |
| 10.8 | OUT-08 | Uses the 1-minute Part 2 prep strategically. | Part 2 prep: learner uses it to plan, not freeze. |
| 10.9 | OUT-09 | Addresses all cue card bullets with natural progression. | Part 2: learner covers all bullets. |
| 10.10 | OUT-10 | Sustains the full 2 minutes without giving up. | Part 2: doesn't trail off before 2 min. |
| 10.11 | OUT-11 | Varies tenses across past, present, future within a single turn. | Part 2 long turn: learner shifts tense. |
| 10.12 | OUT-12 | Uses personal experience as the anchor for abstract cue cards. | Part 2 abstract card: learner anchors on personal example. |
| 10.13 | OUT-13 | Identifies the seven Part 3 question types. | Part 3: learner recognises question type when asked. |
| 10.14 | OUT-14 | Matches grammar pattern to question type. | Part 3: tense/structure varies appropriately by question type. |
| 10.15 | OUT-15 | Deploys an extension technique on every answer. | Part 3: every answer includes reason / example / contrast / hedge. |
| 10.16 | OUT-16 | Maintains coherence under challenge. | Part 3 challenge: learner doesn't lose thread. |
| 10.17 | OUT-17 | Makes concessions and acknowledges nuance. | Part 3: learner uses "but on the other hand", "to some extent". |
| 10.18 | OUT-18 | Eliminates language-search hesitation in the long turn. | Part 2: hesitation patterns reduce over sessions. |
| 10.19 | OUT-19 | Uses topic-specific collocations. | Part 1 / Part 3: learner deploys collocations specific to the topic. |
| 10.20 | OUT-20 | Avoids formal or written-style vocabulary. | Cross-Part: no overly bookish language. |
| 10.21 | OUT-21 | Produces error-free complex sentences. | Cross-Part: complex sentence accuracy improves. |
| 10.22 | OUT-22 | Controls the Band 7 grammar error pattern. | High-band learners: specific Band-7 error patterns addressed. |
| 10.23 | OUT-23 | Varies intonation naturally across the turn. | Cross-Part: intonation variance present. |
| 10.24 | OUT-24 | Improves pronunciation on 2–3 targeted problem sounds. | Profile shows targeted sounds; progress tracked. |
| 10.25 | OUT-25 | Completes a full mock test at exam pace. | Mock session: learner completes without losing pace. |
| 10.26 | OUT-26 | Self-diagnoses across the four criteria. | Mock end + after a few sessions: learner accepts/discusses feedback against the 4 criteria. |
| 10.27 | OUT-27 | Recovers from a "bad moment" without derailment. | Part 2 / Mock: tester deliberately creates a stumble. Learner recovers. |

**Tester action:** open the learner profile after a few sessions. The 27 LOs should appear with per-LO progress signals (heatmap or per-LO mastery values). Higher mastery = more evidence accumulated.

---

# Part 11 — Skill Targets (SKILL-01..SKILL-04) — the ACHIEVE goals

4 high-level skill targets. Each cascades to band 6.5 default per the BehaviorTargets in §2.6.

| # | Skill ref | Educator-set target | What the rubric says | How to test it |
|---|---|---|---|---|
| 11.1 | SKILL-01 | Reach Band 6.5 on Fluency and Coherence | "Speaks fluently with rare hesitation … uses cohesive devices naturally and varies them. Develops topics coherently and appropriately across all three parts, including Part 3 abstract questions." | Learner profile shows Fluency band. After Baseline + Mock: learner's Fluency band is computed against this rubric. |
| 11.2 | SKILL-02 | Reach Band 6.5 on Lexical Resource | "Uses a wide range of vocabulary flexibly and accurately, including some idiomatic language. Topic-specific collocations deployed naturally. Paraphrases skilfully — student can convey precise meaning even when a word is unavailable. Errors in word choice/formation rare." | Profile shows Lexical band. |
| 11.3 | SKILL-03 | Reach Band 6.5 on Grammatical Range and Accuracy | "Uses a wide range of grammatical structures, including complex structures, with high accuracy. Errors rare and do not affect intelligibility. Self-corrects most errors." | Profile shows Grammar band. |
| 11.4 | SKILL-04 | Reach Band 6.5 on Pronunciation | "Highly intelligible. Stress used effectively, including contrastive stress for emphasis. Intonation varied and natural, used to signal meaning, attitude, turn-taking. Remaining pronunciation features are first-language accent rather than errors." | Profile shows Pronunciation band. |

---

# Part 12 — Live Behaviour Matrix (the survey-level matrix)

This is the matrix from the shallow guide, repeated here so a tester running this doc alone has everything.

## 12.A Tutor Behaviour Per Module

| What you asked for | What we built | How to test it |
|---|---|---|
| Part 1 tutor coaches per-answer. | tutor mode. | Live Part 1: corrections after each answer, retry. |
| Part 2 tutor silent during long turn. | examiner mode segment within mixed. | Live Part 2 long turn: silent. |
| Part 3 tutor coaches per-answer. | tutor mode. | Live Part 3: corrections. |
| Mock Exam tutor uses formal examiner posture throughout. | mock-exam mode. | Live Mock: formal posture; bands at end. |
| Baseline tutor uses examiner posture. | examiner mode. | Live Baseline: examiner; bands at end. |

## 12.B Part 3 Focus Pin

| What you asked for | What we built | How to test it |
|---|---|---|
| Learner sees technique focus pinned. | Pin renders technique label. | Live Part 3: pin shows one of the 4 technique labels. |
| Pin updates as focus changes. | Substrate supports updating. | Pin can change between answers. |
| Runtime guard blocks criterion labels from leaking. | Leak-detection gate. | Not directly testable. |
| Mock Results screen is the ONE place criterion labels appear. | Leak rule sanctions Mock Results. | After a Mock: per-criterion bands shown only on Results. |

## 12.C Scoring

| What you asked for | What we built | How to test it |
|---|---|---|
| Bands after Baseline. | LLM-judged scoring wired. | Run Baseline; 4 bands appear. |
| Bands after Mock. | Same path. | Run full Mock; 4 bands. |
| Prosody as enhancement. | Enhancement chip on bands. | If prosody connected, chip appears. |

## 12.D Cue Cards / Topics / Scaffolds

| What you asked for | What we built | How to test it |
|---|---|---|
| Part 2 cue card appears. | Sources seeded; module repointed. | Live Part 2: card present. |
| Part 1 topic variety. | Topic library seeded. | Multiple sessions: variety. |
| Part 3 themes related to Part 2. | Theme library seeded. | Part 3 after Part 2: related. |
| Stall recovery covers 7 types. | Stall types typed; scaffolds seeded. | See §7. |
| Source-resolution badge on Modules tab. | Badge shipped. | Modules tab: green badges. |

## 12.E Learner Screen Type (Shell)

| What you asked for | What we built | How to test it |
|---|---|---|
| Mock → exam shell. | Capability-driven exam shell mounts. | Live Mock: dark exam screen. Mode pill "Mock Exam". |
| Baseline → exam shell, different framing. | Same shell, different pill. | Live Baseline: same shell, pill "Examiner". |
| Part 1 / 3 → chat-feed. | Default chat-feed. | Live practice: standard chat UI. |
| Enrollment → intake wizard. | Intake-wizard shell. | Fresh enrollment: intake wizard. |
| Mock end → results readout. | Results Readout shell. | Mock end: dedicated readout. |
| One dispatcher decides what mounts. | Central dispatcher. | Modules tab preview matches live. |

## 12.F Educator Admin Surface

| What you asked for | What we built | How to test it |
|---|---|---|
| Modules tab is bi-pane. | Bi-pane editor. | Course → Modules tab: left list + right cards. |
| Module Inspector cards vary by mode. | Mode-aware cards. | Different-mode modules: different cards. |
| New Content tab. | Read-only browse. | Course → Content tab. |
| Content tab per-chip item counts. | Counts landed (#2242). | Chips show counts. |
| SIM-shell preview lens. | Preview lens shipped. | Modules tab → click → preview. |
| Preview dims on cross-cutting. | Dim + hint chip. | Cross-cutting toggle → preview dims. |
| Teaching tab inspector drops module-scoped settings. | Scope filter (#2243). | Teaching tab Inspector: no module-scoped settings. |
| Journey + Scoring tabs same filter. | Filter applied (#2245). | Same — Journey + Scoring Inspectors filter. |
| Cascade chip + status badge for all knobs. | Data-presence gate (#2240). | Cascade chips correctly reflect set-vs-default. |

---

# Part 13 — What to Flag if You See It

Anti-behaviours. Flag with time, course, module, what you were doing.

| # | Symptom | Why it's a bug |
|---|---|---|
| 13.1 | Scoring criterion label visible during a Part 3 session ("Fluency…", "Lexical…", "Grammatical…", "Pronunciation"). | Should be technique focus only. Mock Results is the only sanctioned surface. |
| 13.2 | Empty cue card on a Part 2 session. | Cards always available; environment issue. |
| 13.3 | Baseline or Mock ending with no band scores. | LLM Scoring should produce 4 bands. Toggle issue. |
| 13.4 | Tutor coaching during a Mock or Baseline. | Examiner mode is silent. |
| 13.5 | Tutor silent during Part 1 / Part 3 practice. | Tutor mode coaches per-answer. |
| 13.6 | Mode pill saying something other than "Examiner", "Mock Exam", or absent. | Pill should match the mode. |
| 13.7 | Wrong shell on wrong screen. | Mock = exam, practice = chat-feed, enrollment = intake-wizard, Mock end = results readout. |
| 13.8 | Cascade chip showing wrong source. | Chip should reflect actual cascade resolution. |
| 13.9 | Source badge green but no content runtime. | Badge logic disagrees with resolver. |
| 13.10 | Teaching / Journey / Scoring Inspector showing module-scoped settings. | Those belong on Modules tab. |
| 13.11 | Content tab item count = 0 for a populated module. | Count logic broken. |
| 13.12 | Intake Wizard NOT appearing on first enrollment. | Shell dispatch failed for enrollment. |
| 13.13 | Captured profile fields missing from learner profile after intake. | Intake-to-profile write failed. |
| 13.14 | Part 2 cue card bullets missing or partial. | Card-shape broken. |
| 13.15 | Scheduled cues NOT firing at 45s / 60s mark in Part 2 / Mock. | Cue scheduler broken. |
| 13.16 | First-time orientation line NOT played on first session. | Orientation logic broken. |
| 13.17 | First-time orientation REPLAYED on second session. | Orientation logic broken (other direction). |
| 13.18 | Closing line not delivered verbatim at session end. | Closing line drift. |
| 13.19 | Tier band label saying "Generic" or wrong band number. | Tier preset broken. |
| 13.20 | Same cue card across 5 consecutive Part 2 sessions for one learner. | Sampling not varying. |
| 13.21 | Stall scaffold = literal repeat of the cue card / question. | Stall recovery missing/broken. |
| 13.22 | Part 3 focus pin missing entirely during a Part 3 session. | Focus selection failed. |
| 13.23 | A Baseline / Mock item count below the sampling-policy min. | Sampling engine broken. |
| 13.24 | A Baseline / Mock item count above the sampling-policy max. | Sampling engine broken. |
| 13.25 | Mock Exam length significantly over 20 min. | Voice config max-duration not enforced. |

---

# Part 14 — Suggested Walkthrough

For one fresh learner enrollment on the IELTS Speaking Practice course, run in this order.

1. **Educator surface sweep.** Course → Overview / Modules (preview lens) / Journey / Teaching / Scoring / Content tabs. Verify Sections 1, 2, 3 above are visible.
2. **Inspect each module.** Modules tab → click each of Baseline / Part 1 / Part 2 / Part 3 / Mock. Compare Inspector values against §4 of this doc.
3. **Fresh enrollment.** Sign up a new learner. Verify Intake Wizard mounts. Walk through intake. Cross-check captured profile fields against §3.3.
4. **Baseline Assessment.** Run the full Baseline. Verify §4.1, §6.1 (sampling), §11 (skills), §12.B (no criterion leak), §12.E (exam shell). At end, verify §13.3 (4 bands appear).
5. **Part 1 (×2 sessions).** Verify §4.2 (knobs), §10.1–10.7 (Part 1 outcomes), §5.2 (topic variety).
6. **Part 2.** Verify §4.3, §5.1 (cue card present), §6.1 (sampling), §10.8–10.12 (Part 2 outcomes). Deliberately stall (§7 — each stall type if time).
7. **Part 3 (×2 sessions).** Verify §4.4, §5.3 (theme related to Part 2), §8 (focus pin), §10.13–10.17 (Part 3 outcomes), §12.B (no criterion leak in pin).
8. **Mock Exam.** Verify §4.5, §6.2 (Mock sampling), §12.A (formal posture throughout), §12.B (pin), §13.4 (no tutor coaching during answers).
9. **Mock Results screen.** Verify §4.5.6 (read aloud with indicative qualifier), §6.2.10 (per-criterion bands shown — sanctioned here only).
10. **Cross-check the learner profile.** §10 outcomes show signals, §11 skills show bands, profile fields populated.

---

# Part 15 — Not Yet Done

| Gap | What the educator wants | Status |
|---|---|---|
| Assessment Plan editor (bi-pane) | Author Baseline + Mid-points + Mock per course. | Substrate done; UI editor next sprint. |
| Per-cue-card type editor | Tag each Part 2 cue card as personal / abstract. | Data type done; editor next sprint. |
| Stall-recovery scaffold editor | Edit the scaffold pool per module. | Data type done; editor next sprint. |
| Score readout mode editor | Per-module on-screen / end / aloud setting. | Data type done; editor next sprint. |
| Per-module shell capability overrides | Per-course visual tweaks (e.g. mock vs examiner pill). | Data type done; editor not yet. |
| Part 3 selection rules editor | Author rules deciding focus switches. | Rules under pedagogy review. |
| Assessment Plan resolution badge on Course Overview | At-a-glance health of plan resolution. | Not yet. |
| Per-skill scoring target editor (BehaviorTarget UI) | Set "cohort target = band 6.5 in Pronunciation". | Filed for next sprint. |
| MCQ-rounds data feed | Real question data for quiz-mode modules. | For CIO/CTO, not IELTS. |
| Per-criterion progress narrative variants | Narratives that differ per criterion. | Not yet. |

---

# Part 16 — What's Changed Since Last Cycle (headline diffs)

- **Bands now appear after Baseline and Mock** (was silent — prosody vendor unwired).
- **Part 3 focus pin shows technique labels** (was scoring criterion — the partner-blocker).
- **Mock Exam has its own formal screen via mock-exam mode** (was using same shell as Baseline).
- **Dedicated Results Readout screen at Mock end** (didn't exist).
- **Dedicated Intake Wizard screen at enrollment** (didn't exist).
- **Cue cards now appear in Part 2 / Baseline / Mock** (was empty — content sources missing).
- **Per-course LLM Scoring toggle** (was an environment variable).
- **Cascade chips on scoring knobs** — educator sees provenance.
- **SIM-shell preview lens on Modules tab.**
- **New Content tab with per-chip item counts** (this week's #2242).
- **Source-resolution badges on Modules tab rows.**
- **Teaching / Journey / Scoring tab inspectors no longer show module-scoped settings** (this week's #2243, #2245).
- **Data-presence coverage gate** keeps cascade-chip claims honest (this week's #2240).

---

# Appendix A — How to Verify a Knob is Actually Live

For any knob in this doc:

1. **Inspect the knob.** Course → relevant tab → find the knob. Note its current value and cascade chip.
2. **Predict the behaviour.** From this doc, what should change in the learner experience when the knob is at this value?
3. **Run the session.** Live session that exercises that knob.
4. **Observe.** Does the learner experience match the prediction?
5. **Flip the knob.** Change the value. Re-predict. Run again. Re-observe.

This is the structural test loop. Almost every row in this doc fits this pattern.

---

# Appendix B — The 7 Stall Types vs The 7 Part 3 Question Types

Sometimes confused. They're orthogonal:

- **7 stall types** (§7) — failure modes of the LEARNER. Recovery scaffolds match.
- **7 Part 3 question types** (referenced in OUT-13) — categories of QUESTION the tutor asks. Examples: opinion / cause-effect / comparison / hypothetical / past-future / argument / reflection.

A learner can stall (any of the 7 stall types) on any of the 7 question types. Stall recovery is per stall type, not per question type.
