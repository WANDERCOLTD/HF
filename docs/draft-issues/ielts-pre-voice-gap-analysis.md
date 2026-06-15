# IELTS Pre-Voice Testing — Gap Analysis

Source: `~/Downloads/HF-IELTS-Pre-Voice-Testing-Checklist.md` (5 units, 51 scenarios).
Mapped against existing Journey/Voice registries (`lib/journey/setting-contracts.entries.ts`, `lib/settings/voice-setting-contracts.ts`), `AuthoredModule` schema, pipeline stages, and UI primitives. Inverse-probed per `.claude/rules/agent-report-verification.md`.

**Legend** — Gap plan column:
- `SET — <file>::<field>` — knob already exists; wire-up only
- `PARTIAL — <plan>` — infrastructure exists, small extension needed
- `GAP — <plan>` — new infrastructure; references gap-theme number from companion analysis

---

## Unit 1 — Assessment

| Original story / AC | Our interpretation | Gap plan / existing setting |
|---|---|---|
| Learner has completed registration; selected tutor voice; read trial explanation; this is first session | Backgrounded by `firstCallMode = "baseline_assessment"` + voice/intake registration | **SET** — `setting-contracts.entries.ts::firstCallMode` (G2); voice picker `voice-setting-contracts.ts::voiceId` (S1) |
| Tutor introduces itself warmly; says once "If you're ever unsure — just ask me." | Opening line + one-shot reassurance template | **SET** — `setting-contracts.entries.ts::welcomeMessage` (G2). Reassurance line can be appended via `onboardingFlowPhases` first-phase prompt |
| Transition from Part A to Part B is **seamless** (no announcement / no break) | Persona directive — single conversational arc spanning context + assessment phases | **PARTIAL (Theme 1)** — same `baselineAssessment.silentMode` knob also carries a "no-phase-break" directive into the prompt's persona section. ~5 extra lines on the same flag. |
| Questions **designed to provoke extended answers** | Question-style hint to LLM (open-ended vs yes/no) | **PARTIAL (Theme 1)** — module-scoped `instructions` template adds an "open-ended only" directive. ~5 lines on the same template. |
| Collects through natural conversation: Reason / Target band / Timeline / Self-assessed level | Conversational profile capture → typed CallerAttribute keys | **PARTIAL (Theme 10)** — extend `lib/pipeline/extract-callerMemory` to recognise 4 typed keys: `ielts:reason`, `ielts:targetBand`, `ielts:timeline`, `ielts:selfLevel`. Composer reads via existing `CallerAttribute` reader. ~30 lines, no schema. |
| All collected info persisted to learner profile | CallerAttribute write at end of EXTRACT stage | **SET** — `lib/pipeline/extract-callerMemory.ts` (existing AGGREGATE-stage writer). Theme 10 wires the keys. |
| Part B feels like natural conversation, not a test (no test announcement, seamless transition) | Persona/instruction directive baked into prompt for `firstCallMode = baseline_assessment` | **PARTIAL** — `lib/prompt/composition/transforms/pedagogy.ts` branches on baseline_assessment but doesn't carry a configurable "do not announce" knob. **GAP-thin:** new `baselineAssessment.silentMode: boolean` on `Playbook.config` → render directive into instructions section. ~15 lines. |
| Tutor asks questions similar to Part 1 style; topics familiar/personal | Question-style hint to LLM | **SET** — covered by `teachingStyle` (G3) + module-scoped `instructions` template (when Theme 1 ships) |
| Tutor follows up naturally on what learner says | Generic conversational-AI behaviour | **SET** — default LLM behaviour; reinforced by `personality` section |
| Learner speaking time reaches min 6 minutes | Module-scoped completion gate | **GAP (Theme 1 + Theme 9)** — add `AuthoredModule.settings.minSpeakingSec = 360` on Assessment module; end-of-session evaluator compares against `Session.learnerDurationSec`. Wire to incomplete counter. |
| Covers enough ground to assess all 4 criteria (FC / LR / GRA / P) | PROSODY pipeline stage outputs CallScore × 4 | **SET** — `lib/pipeline/prosody-consumer.ts` writes 4 CallScores when `tierPresetId = "ielts-speaking"`. Needs **PARTIAL**: hard validation that all 4 are non-null before marking session complete. |
| Tutor doesn't speak >30s continuously | Runtime monitor or prompt-level reinforcement | **GAP (Theme 7)** — `lib/voice/talk-time-stats.ts` measures post-call; surfaces yellow chip in AttainmentTab. Runtime intervention deferred. |
| Tutor turn count ≤ learner turn count | Same post-call telemetry | **GAP (Theme 7)** — same helper computes `tutorTurnCount / learnerTurnCount` ratio. |
| Tutor acknowledges something specific the learner said + closes forward-looking | Composer's `closing` / `offboarding` section | **PARTIAL** — `setting-contracts.entries.ts` G6 group has offboarding settings. Need module-scoped override for Assessment-specific closing template (**Theme 1**). |
| Does not give scores, grades, or detailed feedback | Examiner-mode-lite behaviour | **PARTIAL** — `AuthoredModuleMode = "examiner"` exists but Assessment is a `tutor`-mode case. Add `Playbook.config.suppressLearnerFacingScores: boolean` (already implied by current behaviour; pin in writeGate). |
| Tutor closes with verbatim "That gives me a good picture..." | Configurable closing line | **GAP-thin** — `AuthoredModule.settings.closingLine: string` (Theme 1 module-scoped settings). |
| Learner lands on home screen | Sim post-call redirect | **SET** — `sim/PostCallProgressCard.tsx` + module picker page |
| Next recommended session highlighted | Recommendation engine output | **SET** — `lib/curriculum/recommend-next-module.ts` |
| No scores shown to learner | Already covered by examiner-mode + suppressLearnerFacingScores | **PARTIAL** — same as scores/grades row above |
| Profile contains Reason / Target band / Timeline / Self-assessed level | CallerAttribute read | **PARTIAL (Theme 10)** — see profile capture row above |
| A score exists for all 4 criteria, none null/zero | PROSODY completion gate | **PARTIAL** — `lib/pipeline/prosody-consumer.ts` writes; need post-write validation + retry. ~10 lines. |
| Learning plan generated | Lesson plan trigger post-Assessment | **PARTIAL** — `lib/lesson-plan/*` exists but isn't wired to fire after baseline. Add post-pipeline hook: when `firstCallMode = baseline_assessment` + status = complete → `generateLessonPlan(callerId)`. ~20 lines. |
| Next recommended session is set | Recommendation engine write | **SET** — `recommend-next-module.ts` already runs |
| Incomplete first attempt → re-enter once | Incomplete-attempt counter | **GAP (Theme 9)** — add `CallerModuleProgress.incompleteAttempts INT DEFAULT 0`. End-of-session evaluator increments. |
| Incomplete second attempt → process with available data, mark done | Second-attempt waiver | **GAP (Theme 9)** — same counter; `incompleteAttempts >= 1` next attempt waives the completion gate, marks `MASTERED` regardless. |
| Tester can review transcript / scores / profile / plan after every run | Admin review surfaces | **SET** — transcript in `Session.transcript`; scores in `CallScore`; profile in CallerAttribute; plan in `lib/lesson-plan/*`. Render in Attainment tab (already exists). Missing: profile block — small render extension. |
| Tester can run as new/returning learner | Fresh-vs-returning toggle | **GAP (Theme 12)** — new `/x/test/ielts/assessment?learnerMode=fresh\|return` route + `cloneDemoCaller` helper. ~60 lines. |
| Direct link exists to run Session 1 repeatedly | Tester entry point | **GAP (Theme 12)** — same route as above |

---

## Unit 2 — Part 1: Familiar Topics

| Original story / AC | Our interpretation | Gap plan / existing setting |
|---|---|---|
| Tutor greets briefly | Opening line per module | **PARTIAL (Theme 1)** — module-scoped `welcomeMessage` override |
| References something from previous session if not first | Cross-session memory recall | **PARTIAL** — `recentCalls` + `loadPriorCallFeedback` already feed composition. Extend to emit a "Last Part 1: …" delta line. ~15 lines. |
| Moves into exam-style questions immediately — no preamble | Persona instruction | **PARTIAL (Theme 1)** — module-scoped `instructions` directive |
| Min 10 / target 12–15 questions | Question count target | **GAP (Theme 8)** — `AuthoredModule.settings.questionTarget = {min: 10, target: 13}`. Composer renders into INSTRUCTIONS. EXTRACT counts interrogatives → mark incomplete if under min. |
| Topics familiar and personal | Topic pool config | **PARTIAL** — `Playbook.config.firstCallCurriculumFocus` (G3) is the existing knob; needs module-scoped equivalent (Theme 1) for Part 1 specifically. |
| Brief feedback after some answers | Persona behaviour | **SET** — default tutor-mode behaviour; reinforced by `teachingStyle = "adaptive"` |
| Learner speaking time min 10 min | Module-scoped completion gate | **GAP (Theme 1 + Theme 9)** — `AuthoredModule.settings.minSpeakingSec = 600` |
| Tutor doesn't speak >30s continuously | Same as Assessment | **GAP (Theme 7)** — post-call only |
| Tutor speaking ≤20% of total session | Talk-ratio monitor | **GAP (Theme 7)** — same helper |
| One specific observation + one concrete improvement at close | Closing template with structured slots | **GAP-thin (Theme 1)** — `AuthoredModule.settings.closingTemplate` with `{observation, improvement}` placeholders. ~15 lines. |
| Learner lands on home screen | Sim post-call redirect | **SET** — `sim/PostCallProgressCard.tsx` + module picker page (same primitive as Assessment) |
| Next recommended session highlighted | Recommendation engine output | **SET** — `lib/curriculum/recommend-next-module.ts` (same as Assessment) |
| Pipeline produces 4 per-criterion scores | PROSODY output | **SET** — `lib/pipeline/prosody-consumer.ts` |
| No scores shown to learner | Suppress flag | **PARTIAL** — same as Assessment |
| Score delta vs previous Part 1 session viewable | Tester review surface | **PARTIAL (Theme 11)** — extend AttainmentTab + Snapshot to show per-criterion delta by querying ordered CallScore. ~40 lines, read-only. |
| Updated learning plan viewable | Lesson plan storage | **PARTIAL** — `lib/lesson-plan/*` exists; render in Attainment tab. ~20 lines. |
| Incomplete first / second attempt policy | Same as Assessment | **GAP (Theme 9)** |
| Tester direct link + fresh/return toggle | Tester entry | **GAP (Theme 12)** — `/x/test/ielts/part1` |

---

## Unit 3 — Part 2: Cue Card Monologue

| Original story / AC | Our interpretation | Gap plan / existing setting |
|---|---|---|
| First-time orientation: tutor voice-only "In Part 2 you'll speak for 2 minutes…" | One-shot per-module orientation | **GAP-thin (Theme 1)** — `AuthoredModule.settings.firstTimeOrientationLine: string` + `CallerModuleProgress.orientationShown: bool`. ~20 lines. |
| Cue card appears immediately after | Cue card render trigger | **GAP (Theme 3)** — `<PinnedCardSlot>` above SimChat. Populated from `Session.metadata.pinnedCard` (no migration). |
| Cue card has topic + 3–4 bullet points | Cue card content shape | **GAP (Theme 1 + Theme 3)** — `AuthoredModule.settings.cueCardPool: Array<{topic, bullets}>`; session start picks one; writes to `Session.metadata.pinnedCard`. ~30 lines. |
| Cue card pinned + remains visible throughout prep + monologue | Sticky render through phase | **GAP (Theme 3)** — pinned slot persists until phase=complete |
| Prep phase: 60s soft fill bar, no countdown number | Prep timer UI | **PARTIAL** — `hf-progress-bar-fill` primitive exists. Wrap in `<PrepFillBar duration={60} />`, no numeric label. ~20 lines. |
| Tutor fully silent during prep | Voice silence gate | **GAP (Theme 2)** — `AuthoredModule.settings.prepSilenceSec: 60` → VAPI assistant `firstMessageMode = "wait-for-user"` + suppress tool calls during the window. ~30 lines (provider-side). |
| Topic prompt appears in chat feed (Personal/Abstract variant) | Scripted chat insert | **GAP-thin (Theme 3)** — `<PinnedCardSlot>` supports a `secondaryNote` row beneath bullets. |
| PPF (Past/Present/Future) sentences appear | Scripted chat insert | **GAP-thin (Theme 3)** — same secondaryNote slot OR new `<ScriptedChatInsert>` (3 lines as system messages). ~15 lines. |
| Note-taking instruction: "Write 3 bullet points only…" | Scripted chat insert | **GAP-thin (Theme 3)** — same insert mechanism |
| At 45s tutor says "15 seconds left" | Time-keyed tutor speech | **GAP (Theme 2)** — Phase 1 client-side `useEffect` timer fires pre-baked TTS at `t=45s`. ~30 lines. |
| At 60s tutor says "Your time starts now — go ahead" | Time-keyed tutor speech | **GAP (Theme 2)** — same scheduler, `t=60s` |
| Monologue timer starts immediately after | Phase transition | **GAP (Theme 2)** — phase state machine in client; emit `phase=monologue` event |
| Fill bar transitions to monologue bar (same style, different colour) | Phase-coloured fill bar | **PARTIAL** — same primitive, `<MonologueFillBar duration={120} colour="accent" />`. ~10 lines beyond Theme 3. |
| Tutor fully silent throughout monologue | Voice silence gate | **GAP (Theme 2)** — `monologueSilenceSec: 120` provider directive |
| Silent for 10s → subtle visual nudge (no voice) | Stall-detection UI cue | **GAP (Theme 2 — visual variant)** — client-side `useEffect` watches `lastSpeechAt`; renders a fade-in chip after 10s silence. No voice triggered. ~25 lines. |
| Monologue ends at natural stop OR 2-min timer | Hard cutoff | **PARTIAL (Theme 2)** — VAPI `maxDurationSeconds` per-session can be set; needs override to be module-scoped (Theme 1). |
| Tutor gives 1–3 lines feedback based on actual monologue | Post-monologue feedback generation | **SET** — composer's `feedback` section runs at end-of-call. Module-scoped instruction template (Theme 1) tunes length. |
| Tutor offers re-speak, system records 60s silently, tutor closes verbally | Re-speak sub-phase | **GAP (Theme 2)** — new phase `respeakRecord` (60s) → close. Adds phase to client state machine. ~40 lines. |
| Tutor **closes warmly** at end of session | Closing tone directive (distinct from verbatim closingLine) | **PARTIAL (Theme 1)** — module-scoped `closingTone: "warm" \| "neutral" \| "examiner"` flag rendered into the offboarding section. ~5 lines on existing Theme 1 registry. |
| Learner returned to home screen + next recommended highlighted | Sim post-call redirect + recommendation | **SET** — `sim/PostCallProgressCard.tsx` + `recommend-next-module.ts` (same as Assessment) |
| <60s monologue → LLM-only feedback, no external scoring | Duration gate on PROSODY | **GAP (Theme 6 variant)** — `lib/pipeline/prosody-consumer.ts` skips IELTS CallScore writes when `monologueDurationSec < 60`; composer still runs feedback prose. ~15 lines. |
| 90s monologue threshold = incomplete-first gate | Incomplete-attempt counter | **GAP (Theme 9)** — `AuthoredModule.settings.incompleteThresholdSec = 90` overrides `minSpeakingSec` for monologue-shaped sessions. |
| Pipeline produces 4 scores, learning plan updated | Standard pipeline output | **SET / PARTIAL** — same as Part 1 (plan update is wired-up gap) |
| Tester can view monologue duration + scores + delta + updated plan + cue card | Tester review surface | **PARTIAL (Theme 11 + Theme 3)** — extend AttainmentTab; cue card replay reads `Session.metadata.pinnedCard` (already populated by Theme 3). |
| Tester direct link + fresh/return toggle | Tester entry | **GAP (Theme 12)** — `/x/test/ielts/part2` |

---

## Unit 4 — Part 3: Abstract Discussion

| Original story / AC | Our interpretation | Gap plan / existing setting |
|---|---|---|
| Available from day 1 — no minimum prerequisite | No unlock gate | **SET** — default; no prerequisite required |
| Tutor introduces the topic ("Today's topic is…") | Topic announcement | **GAP-thin (Theme 1)** — module-scoped `instructions` template renders topic |
| Tutor declares session focus ("Today we're working on giving reasons…") | Focus area declaration | **PARTIAL** — derived from weak parameters; needs **derivation logic** (see below) |
| Focus derived from weak areas | Weakest-parameter selector | **PARTIAL** — `CallerTarget.currentScore` per-parameter exists; add `lib/curriculum/derive-focus-area.ts` that returns `min(currentScore)` parameter slug. ~20 lines. |
| Topic + focus appear as a pinned message in chat feed | Sticky banner | **GAP (Theme 3)** — `<PinnedCardSlot>` with `kind="topicFocus"` variant (text-only, no bullets). |
| Pinned message remains fixed at the top throughout entire session | Persistent pin | **GAP (Theme 3)** — same slot, no auto-dismiss |
| No individual questions are pinned | Slot scope constraint | **SET (Theme 3)** — slot is single-content; only topic+focus block is rendered |
| 4–6 questions total | Question count target | **GAP (Theme 8)** — `questionTarget = {min: 4, target: 5}` |
| Learner speaking time 7–10 min | Module-scoped completion gate | **GAP (Theme 1 + Theme 9)** — `minSpeakingSec = 420` |
| Tutor asks follow-up / challenges / moves forward based on answer | Tutor reactive logic | **SET** — default LLM behaviour with `teachingStyle = "socratic"` |
| Tutor **does not interrupt or correct mid-answer** | Persona directive (no barge-in) | **PARTIAL (Theme 1)** — module-scoped `instructions` template adds an explicit "wait for natural turn-end" directive. Voice-side barge-in suppression is a provider knob (VAPI `endpointing` / no interruption) — covered when Theme 2 server-tools land. ~5 lines prompt + provider config note. |
| Silent 10s OR "I don't know" → scaffolding prompt | Stall-recovery branch | **GAP (Theme 2 — stall variant)** — client-side silence detector + transcript-side "I don't know" matcher → invoke a pre-baked scaffold message from `AuthoredModule.settings.scaffoldPool`. ~40 lines. |
| Does not rephrase/repeat unless silent another 10s | Cooldown on stall recovery | **GAP (Theme 2)** — same detector with 10s cooldown between scaffolds |
| One specific observation + one concrete gain at close | Structured closing template | **GAP-thin (Theme 1)** — same as Part 1 closingTemplate |
| Closes **warmly and briefly** | Closing tone + length directive | **PARTIAL (Theme 1)** — module-scoped `closingTone: "warm"` + `closingMaxLines: 2` (same Theme 1 registry as Part 2). ~3 lines. |
| Learner returned to home screen | Sim post-call redirect | **SET** — `sim/PostCallProgressCard.tsx` (same as Assessment) |
| Pipeline produces 4 scores; focus area performance tracked; plan updated | Standard pipeline + focus delta | **PARTIAL (Theme 11)** — CallScore writes 4 criteria. Focus-area delta = compute pre/post score on the focus parameter; write to `Session.metadata.focusDelta`. ~15 lines. |
| No scores shown to learner | Suppress flag | **PARTIAL** — same as Assessment |
| Incomplete first / second attempt policy | Same | **GAP (Theme 9)** |
| Tester can view focus area assigned + scores + delta + updated plan | Tester review | **PARTIAL (Theme 11)** — render focus-area + delta in AttainmentTab |
| Tester direct link + fresh/return toggle | Tester entry | **GAP (Theme 12)** — `/x/test/ielts/part3` |

---

## Unit 5 — Mock Exam

| Original story / AC | Our interpretation | Gap plan / existing setting |
|---|---|---|
| Completed Assessment + 2× Part 1 + 2× Part 3 required | Module unlock prerequisite | **GAP (Theme 5)** — widen `AuthoredModule.prerequisites` to `Array<{moduleId, minCompletions}>` |
| Mock button visible from day 1 but locked until now | Visible-but-locked tile state | **GAP (Theme 5)** — add `LOCKED` to `CallerModuleProgress.status` enum (4-state) |
| Examiner operates in pure examiner mode throughout | Examiner mode discriminator | **SET** — `AuthoredModule.mode = "examiner"` (existing) |
| No coaching/feedback given during exam | Behaviour from examiner mode | **SET** — `lib/prompt/composition/transforms/pedagogy.ts` examiner branch |
| No timers shown on screen — system counts internally | UI hide-timer flag | **GAP (Theme 4)** — `ExamModeShell` hides all numeric timers; client tracks internally |
| Only visible is a dual waveform (learner / examiner colours) | Exam-mode visual isolation | **GAP (Theme 4)** — `<ExamModeShell>` + `<DualWaveform>`. WebRTC remote audio analyser node for examiner level. ~80 lines. |
| Mock entry confirmation screen with "This is your mock exam…" + Start button | Pre-exam dialog | **GAP-thin (Theme 1)** — `AuthoredModule.settings.entryConfirmation: {body, ctaText}`. Generic `<EntryConfirmation>` component. ~30 lines. |
| Examiner introduces exam briefly | Opening line | **PARTIAL (Theme 1)** — module-scoped welcomeMessage |
| Asks 4–6 familiar-topic questions (P1) | Question count + topic pool | **GAP (Theme 8)** — `questionTarget` per part requires **sub-module structure** (see below) |
| Minimal acknowledgments only ("Thank you" / "I see") | Examiner vocab lexicon | **GAP-thin (Theme 1)** — `AuthoredModule.settings.acknowledgementVocab: string[]` |
| Does not coach/correct/give feedback | Examiner mode | **SET** — examiner mode |
| Silent 10s → "Take your time" / silent further 10s → next question | Stall-recovery sequence | **GAP (Theme 2)** — same scheduler as Part 3 stall; pre-baked scaffolds from `acknowledgementVocab` |
| Transitions directly to Part 2 when sufficient questions covered | Phase transition within session | **GAP (new pattern — sub-modules)** — Mock needs **three sub-phases (P1/P2/P3) inside a single session**. Add `AuthoredModule.settings.subPhases: Array<{key, questionTarget, hasCueCard, durationSec}>`. Client state machine drives transitions. Connects to Theme 6 (per-part scoring). ~60 lines. |
| Cue card appears pinned for Part 2 | Cue card render in mock | **GAP (Theme 3 + sub-phases)** — same PinnedCardSlot, fires on `subPhase=p2` |
| Examiner says "You have one minute to prepare" | Scripted line | **GAP (Theme 2)** — pre-baked TTS at subPhase boundary |
| System counts 1 minute internally — no timer on screen | Hidden timer | **GAP (Theme 4 + Theme 2)** — ExamModeShell + scheduler |
| Soft fill bar during prep — no countdown number | Prep bar (no number) | **SET / PARTIAL** — same `<PrepFillBar>` as Part 2 standalone |
| At 45s "You have about 15 seconds left" | Time-keyed examiner cue | **GAP (Theme 2)** — same scheduler |
| At 60s "Please begin your talk now" | Same | **GAP (Theme 2)** |
| Examiner silent during monologue, soft progress bar shown | Same as Part 2 standalone | **GAP (Theme 2 + Theme 3)** |
| Silent 10s → "Please continue"; stops <2min → "Can you tell me a little more?" | Stall-recovery variants | **GAP (Theme 2)** — scaffold pool per subPhase |
| At 2min examiner closes "Thank you", cue card removed | Phase end + pin clear | **GAP (Theme 2 + Theme 3)** — scheduler emits `subPhaseEnd`; PinnedCardSlot clears |
| Transitions directly to Part 3 | Sub-phase transition | **GAP (sub-modules)** — same client state machine |
| Asks 4–6 abstract questions linked to Part 2 topic (P3) | Question count + cross-subphase context | **GAP (Theme 8)** — per-subphase `questionTarget`; composer reads previous subPhase's `pinnedCard.topic` for linkage |
| P3 minimal acknowledgments only ("Thank you" / "I see") | Examiner vocab lexicon (P3 mirror of P1) | **GAP-thin (Theme 1)** — same `acknowledgementVocab` knob applied to P3 subPhase. ~0 lines beyond P1 row (subPhase config already passes it through). |
| P3 silent 10s → "Take your time"; further 10s → next question | Stall-recovery sequence (P3 mirror) | **GAP (Theme 2)** — same scheduler + scaffold pool keyed to `subPhase=p3`. ~0 lines beyond Theme 2 generic dispatch. |
| Closes "That's the end of the speaking test. Thank you." | Scripted close | **GAP-thin (Theme 1)** — module-scoped `closingLine` |
| Examiner says "Give me a moment while I review your exam." | Processing-screen handoff line | **GAP (Theme 13)** — pre-baked TTS at session end + `<ProcessingScreen>` |
| Screen shows "Reviewing your exam…", dual waveform removed | Processing screen | **GAP (Theme 13)** — new component, ~40 lines |
| System processes async: per-criterion scores per part / overall band / strengths-weaknesses / updated plan | Per-part pipeline + aggregation | **GAP (Theme 6)** — `CallScore.segmentKey` column; PROSODY iterates segments via existing `segment-mock-transcript.ts` helper. ~40 lines + migration. |
| Overall band estimate is **calculated** (distinct from "rendered") | Aggregation of 12 per-part criteria into single band | **PARTIAL (Theme 6)** — extend PROSODY consumer to write `Session.metadata.overallBand: number` after per-part scores land. Mean-of-12 with rounding-to-nearest-half-band per IELTS convention. ~10 lines. |
| Learning plan is **updated** after Mock | Lesson plan regen trigger on Mock complete | **PARTIAL** — same hook as Assessment plan-trigger; fires when `mode = examiner` + status = complete. ~5 lines beyond Assessment row. |
| Learner taken to Results screen when processing complete | Async hand-off | **GAP (Theme 13)** — poll/subscribe on `Session.status`; redirect on done |
| Results: Overall band / Per-criterion FC/LR/GRA/P / 1 strength / 1 area to work on | Results renderer | **GAP (Theme 13)** — new `/x/student/[courseId]/results/[sessionId]` route. Strength = max-criterion; area = min-criterion. Reuses Snapshot v3 block primitives. ~80 lines. |
| Primary CTA: "Continue with [next session] →" OR "Tell us what you think →" | Trial-state-dependent CTA | **PARTIAL** — `Playbook.config.trialPolicy` (does this exist?) — **probe needed**. Likely **GAP-thin** — new flag + survey link slot. |
| Results email sent automatically | Auto-email on Mock complete | **GAP — UNVERIFIED** — email infrastructure not probed. Probe `lib/email/` / `lib/notifications/` before designing. If infra exists → ~30 lines templated send. If not → significant. |
| Results screen permanently accessible from home screen | Results archive entry point | **GAP-thin (Theme 13)** — extend Mock module tile with "View last result →" link to existing results route once it exists. ~10 lines. |
| No tutor, no chat, no conversation on Results screen | Pure render mode | **SET (Theme 13)** — results route is its own page; no chat shell. |
| Score exists per criterion per part — none null/zero | Per-segment validation | **PARTIAL (Theme 6)** — write-then-validate in PROSODY; retry on null |
| Scores shown on Results screen only, never in conversation | Suppress flag + render gate | **PARTIAL** — same as Assessment suppressLearnerFacingScores |
| Tester can view full transcript / per-part scores / overall band / Results screen content / Results email content | Tester review surface | **PARTIAL** — transcript (SET), per-part scores (Theme 6), Results screen (Theme 13). Results email content review = render the template in admin, ~15 lines. |
| Tester direct link + fresh/return toggle | Tester entry | **GAP (Theme 12)** — `/x/test/ielts/mock` |

---

## Cross-cutting

| Original story / AC | Our interpretation | Gap plan / existing setting |
|---|---|---|
| Tester direct link per session-type, without setup | Single tester route family | **GAP (Theme 12)** — `/x/test/ielts/[session]?learnerMode=fresh\|return` |
| Continue same learner vs start fresh new learner toggle | Caller-clone helper | **GAP (Theme 12)** — `cloneDemoCaller` blanks CallerAttribute + CallerModuleProgress |
| Tester review surfaces after every run (transcript / scores / delta / plan / cue card / email content) | Admin review composite | **PARTIAL** — AttainmentTab + Snapshot v3 cover scores + delta. Add: lesson-plan render (~20 lines), cue-card replay (~5 lines on Theme 3), email template render (~15 lines). |

---

## Gap themes referenced

| # | Theme | Approx size |
|---|---|---|
| 1 | Module-scoped settings layer (G8 group, `AuthoredModule.settings` registry extension) | 1 day registry + Inspector filter |
| 2 | Time-based tutor/examiner cue scheduling + stall detector | ~60 lines client (Phase 1), provider-side later |
| 3 | Pinned chat card primitive (`<PinnedCardSlot>` above SimChat) | ~30 lines, no schema |
| 4 | Mock dual-waveform exam-mode shell (`<ExamModeShell>` + WebRTC analyser) | ~80 lines, no schema |
| 5 | Module unlock gates (`prerequisites` widened, `LOCKED` enum state) | ~50 lines + 1-row enum migration |
| 6 | Per-part Mock scoring (`CallScore.segmentKey` column, reuses existing `segment-mock-transcript.ts`) | ~40 lines + 1-column migration |
| 7 | Tutor talk-time stats (post-call telemetry only) | ~30 lines, no schema |
| 8 | Question count targets per module (settings + EXTRACT count) | ~50 lines |
| 9 | Incomplete-attempt counter on `CallerModuleProgress` | ~25 lines + 1-column migration |
| 10 | IELTS profile capture via typed CallerAttribute keys | ~30 lines, no schema |
| 11 | Per-session score-delta narrator (read-side) | ~40 lines |
| 12 | Tester direct-link + fresh/returning toggle | ~60 lines |
| 13 | Results screen + permanent archive + email | ~80 lines screen + email infra probe |

---

## Probe results (verified 2026-06-15)

| # | Probe | Status | Impact on plan |
|---|---|---|---|
| 1 | **Email infrastructure** | **EXISTS** — `lib/messaging/` (#1141). Typed `MessagingAdapter.send()` interface (`lib/messaging/types.ts`), `email-resend.ts` adapter live, channel `"email"` + `"sms"`, secret-ref'd via Secret Manager, `MessagingProvider` DB row with `adapterKey`. Sister call site: `issueFirstCallPin` already uses the pattern. | **Theme 13 email is PARTIAL (not unverified GAP).** Build a Resend HTML template + look up the Mock-results `MessagingProvider` row + call `adapter.send({channel:"email", to, secretRef, body, plainTextBody})`. **~30 lines confirmed.** |
| 2 | **`Playbook.config.trialPolicy`** | **DOES NOT EXIST.** Inverse-probed: `trialPolicy`, `trial_policy`, `trialState`, `isTrial`, `TrialPolicy`, `trialing`, `cohort.*trial`, `trial.*cohort` — all empty in `lib/`, schema, `app/`, `lib/types/json-fields.ts`, `lib/config.ts`. | **Mock CTA "Trial ongoing vs Trial complete" is a real GAP — no backing today.** Lift to **Theme 13b**: `Playbook.config.trialState: "active" \| "complete"` + `trialCompleteSurveyUrl: string`. Renderer branches on it in results route. ~15 lines + Json shape extension (no migration). |
| 3 | **`Session.metadata Json?` field** | **DOES NOT EXIST** on the `Session` model (lines 865–960 of `prisma/schema.prisma`). Closest fields: `voiceConfigSnapshot Json?` (purpose-specific), `skipStages String[]` (pipeline-only). No general-purpose metadata bag. | **Themes 3 (pinned card) and 11 (focus delta) need a write target.** Three options: (a) add `Session.metadata Json?` 1-column migration — cleanest, matches existing Json-bag pattern across schema; (b) extend `voiceConfigSnapshot` with non-voice keys — pollutes semantics; (c) sibling `SessionMetadata` table — overkill for ≤2 fields. **Recommend (a).** Adds +5 lines to Theme 3 sizing (migration + writer); ~10 lines to Theme 11. |
| 4 | **`Playbook.config.suppressLearnerFacingScores`** | **DOES NOT EXIST** as a settable knob. Inverse-probed: `suppressLearnerFacingScores`, `suppressScores`, `hideLearnerScores`, `showScores`, `hideScores`, `learnerVisibleScore`, `displayScore`, `scoresHidden`, `scoreVisibility`, `presentScoresTo` — all empty. Behaviour is prompt-hard-coded in `lib/prompt/composition/transforms/pedagogy.ts` (examiner branch). | **GAP — not the implicit-default I assumed.** Lift to **new Theme 14**: `Playbook.config.scoreVisibilityToLearner: "never" \| "endOfSession" \| "always"` (default `"never"` for IELTS). Composer reads it in pedagogy + offboarding sections. Mock Results screen overrides to render scores regardless (results page is a different surface, not "conversation"). ~25 lines + Json shape extension. |

### Net change to the plan

- **Theme 13** stays a Partial (email infra confirmed). Splits into **13a** (results screen) + **13b** (trial-state CTA branching) + **13c** (Resend email send).
- **New Theme 14** — `scoreVisibilityToLearner` flag. Small (~25 lines).
- **Themes 3 + 11** absorb a 1-column `Session.metadata Json?` migration; size estimates updated to **~35 lines** (Theme 3) and **~45 lines** (Theme 11) respectively.

No GAP rows in the unit tables flip to SET on these results — but Theme 13 now sizes credibly, Theme 14 is new, and the Json-bag store for Themes 3 + 11 is decided.

---

## Build-time estimates

Person-day estimates per theme. Includes: schema work + tests + types + ESLint discipline + scaffold for existing CLAUDE.md guards (factual-grounding intercept for any AI-emitted prose, scope-enforcer for commits, `arch-checker` for new pipeline touchpoints). Excludes promptfoo evals (separate bucket — add ~0.5 day per AI-touched composer change).

| # | Theme | Effort | Schema impact | Notes |
|---|---|---|---|---|
| 1 | Module-scoped settings layer (G8) | **2 d** | Json shape extension to `AuthoredModule.settings`, no migration | Foundation for Themes 5/8/9 — get this in early or those slip |
| 2 | Cue scheduler + stall detector (client-side Phase 1) | **2 d** | None | Phase 2 (VAPI server-tools) is +2 d, defer if voice-test scope permits |
| 3 | Pinned chat card (`<PinnedCardSlot>` + `Session.metadata Json?` migration) | **1 d** | 1-col migration | Slot is single-content; renders cue card OR topic+focus banner |
| 4 | Mock dual-waveform exam shell | **2 d** | None | WebRTC remote analyser node is the fiddly bit; otherwise straight UI |
| 5 | Module unlock gates | **1.5 d** | `LOCKED` enum value + `prerequisites` widened shape | Bypass for OPERATOR+ — testers must not be locked out |
| 6 | Per-part Mock scoring | **1.5 d** | `CallScore.segmentKey ENUM` nullable column | Reuses existing `segment-mock-transcript.ts` — highest leverage in the list |
| 7 | Tutor talk-time stats (post-call only) | **0.5 d** | None | Yellow-chip flag in AttainmentTab only; no runtime intervention |
| 8 | Question count target per module | **1 d** | Json shape on `AuthoredModule.settings` (already migrated under Theme 1) | EXTRACT counter is the work |
| 9 | Incomplete-attempt counter | **0.5 d** | `CallerModuleProgress.incompleteAttempts INT` column | Trivial migration; reader in picker is 5 lines |
| 10 | IELTS profile capture (typed CallerAttribute keys) | **0.5 d** | None | Extends `extract-callerMemory` with 4 typed keys |
| 11 | Per-session score-delta narrator + focus delta | **1 d** | Writes to `Session.metadata` (already migrated under Theme 3) | Pure read-side at the composer layer |
| 12 | Tester direct-link + fresh/returning toggle | **1 d** | None | `cloneDemoCaller` helper + 1 route family |
| 13a | Mock Results screen | **1.5 d** | None | Reuses Snapshot v3 block primitives |
| 13b | Trial-state CTA branching | **0.5 d** | Json shape on `Playbook.config` | Render-side branch |
| 13c | Resend HTML template + send | **0.5 d** | None | Pattern from `issueFirstCallPin`; pick a `MessagingProvider` row |
| 14 | `scoreVisibilityToLearner` flag | **0.5 d** | Json shape on `Playbook.config` | Composer reads, results screen overrides |

**Total (all themes, all phases): ~17 person-days.**
**Two parallel engineers (with shared schema work upfront): ~9 calendar days.**
**Single engineer: ~3 calendar weeks.**

Schema migrations bundle cleanly:
- Migration A — `Session.metadata Json?` (Theme 3 + 11)
- Migration B — `CallerModuleProgress.incompleteAttempts INT DEFAULT 0` (Theme 9)
- Migration C — `CallerModuleProgress.status` enum: add `LOCKED` (Theme 5)
- Migration D — `CallScore.segmentKey ENUM('p1','p2','p3') NULL` (Theme 6)

Run all four in one `/vm-cpp` cycle to avoid four separate migration rounds.

---

## Items we DON'T think we need (deferrable from pre-voice testing scope)

The checklist is the full target spec. Pre-voice testing is a narrower bar: **every unit must be runnable end-to-end by a tester and produce verifiable output.** Things that don't block that bar can defer to post-voice-test polish.

| Item | Where it appears | Why deferrable for pre-voice testing |
|---|---|---|
| **Auto-results email (Theme 13c)** | Unit 5 Mock close | Tester reads scores in admin; learner-facing email is post-voice-test polish. Save **0.5 d**. |
| **Trial-state CTA branching (Theme 13b)** | Unit 5 results screen | The CTA is a learner-flow nicety; tester clicks anywhere. Save **0.5 d**. |
| **First-time orientation gating (Part 2)** | Unit 3 first-time line | The orientation script is needed; the *gating* (only-on-first-time) is not — show it every time during voice testing. Save **~0.3 d** of orientation-shown bookkeeping. |
| **Permanent results-screen archive link on home** | Unit 5 close | Admin tab access is enough for tester review. Save **~0.2 d**. |
| **"Reviewing your exam…" processing screen** | Unit 5 close | Pipeline runs server-side; tester polls admin. Skip the UI placeholder. Save **~0.5 d**. |
| **PPF (Past/Present/Future) scaffold inserts** | Unit 3 prep | Soft scaffold for learner; verifying the prep state machine + cue card matters more for voice testing. Save **~0.3 d**. |
| **Note-taking instruction insert** | Unit 3 prep | Same — soft scaffold. Save **~0.2 d**. |
| **Subtle 10s visual nudge during monologue** | Unit 3 monologue | Stall is silently tolerated; voice testing verifies monologue completion + scoring path. Save **~0.5 d**. |
| **Re-speak phase (Part 2 post-monologue)** | Unit 3 post-monologue | Nice-to-have re-do flow; not on the critical scoring path. Save **~1 d**. |
| **<60s monologue → LLM-only feedback gate** | Unit 3 incomplete | Edge case. Default scoring will error/null; admin can spot it. Save **~0.3 d**. |
| **Examiner vocab lexicon as configurable knob** | Unit 5 examiner mode | Prompt-baked "Thank you" / "I see" is fine for voice testing. Save **~0.3 d**. |
| **`scoreVisibilityToLearner` (Theme 14)** | Unit 1 + 2 + 3 close | Pre-voice testing tester IS the learner — showing scores is fine. The flag matters for real learners. Save **0.5 d**. |
| **Tutor talk-time runtime intervention** | All units | Measurement post-call (Theme 7, kept) is enough for testing. Runtime intervention is post-voice polish. Save **~1 d**. |
| **Module unlock gate enforcement against tester role** | Unit 5 Mock locked | Tester (OPERATOR+) must bypass; the LOCKED tile rendering still ships (Theme 5) but enforcement is role-gated. No saving — just don't lock testers out. |
| **Cross-session Mock prerequisite count tracking** | Unit 5 background | Same — tester bypass via role. Picker still shows the chip ("Complete 2× Part 1 + 2× Part 3" copy) for verification but doesn't block. Save **~0.5 d** vs full enforcement. |
| **Per-LO mastery drilldown in tester Attainment view (for IELTS specifically)** | Cross-cutting tester review | Already exists for structured courses (SP4-C). IELTS skill bands are PARAMETER-grain not LO-grain — no LO drill needed for voice testing. Save **~0 d** (don't build, don't surface). |

**Total deferrable: ~6 person-days saveable from the ~17-day full scope.**
**Pre-voice testing bar: ~11 person-days (single engineer: ~2.5 weeks; two engineers: ~6 days).**

---

## Dependency graph

```
                Migration bundle (A/B/C/D) — half-day, ship first
                       │
        ┌──────────────┼───────────────┬────────────────┐
        ▼              ▼               ▼                ▼
    Theme 3        Theme 9         Theme 5          Theme 6
   (Pin slot)   (Incomplete)     (Unlock gate)   (Per-part score)
        │              │               │                │
        │              ▼               ▼                │
        │          Theme 1 (Module-scoped settings registry)
        │              │
        │              ├────────────┬──────────────┐
        │              ▼            ▼              ▼
        │          Theme 8      Theme 2        Theme 11
        │       (Q count)    (Cue scheduler)  (Score delta)
        │              │            │              │
        ▼              ▼            ▼              ▼
    Theme 4 (Exam shell) ────────► Theme 13a (Results) ──► Theme 13c (Email)
                                          │
                                          └──► Theme 13b (Trial CTA)
                                          │
                                          └──► Theme 14 (Score visibility)

    Theme 7  (Talk-time stats)    — independent
    Theme 10 (Profile capture)    — independent
    Theme 12 (Tester direct link) — independent
```

**Critical path (longest chain):** Migration → Theme 1 → Theme 2 → Theme 13a → Theme 13c ≈ **6 d** of serial work.
**Floor with two engineers running parallel:** ≈ **5–6 calendar days** after the migration bundle lands.

---

## Minimum-viable subset to start voice testing

If voice testing must start ASAP, this is the absolute floor. Everything else can ship in a fast-follow.

| # | Theme | Effort | Why it's floor |
|---|---|---|---|
| - | Migration bundle (A/B/C/D) | 0.5 d | Unblocks everything |
| 1 | Module-scoped settings layer | 2 d | Without it, 6 themes can't write their settings |
| 3 | Pinned chat card | 1 d | Part 2 / Part 3 / Mock literally cannot show what the spec requires |
| 6 | Per-part Mock scoring | 1.5 d | Mock without per-part scores is unverifiable |
| 10 | Profile capture | 0.5 d | Assessment Part A persists nothing without it |
| 12 | Tester direct-link + clone | 1 d | Testers can't iterate without it |

**Floor: ~6.5 person-days.** Plus existing infrastructure (firstCallMode, recommendNextModule, examiner mode, PROSODY 4-criteria, lesson-plan store, `lib/messaging/`) handles the rest.

What you LOSE at the floor:
- Cue-card timer cues (45s/60s tutor speech) — Part 2 prep happens but learner doesn't get the "15 seconds left" cue
- Stall detector — Part 3 silence is just silence
- Exam-mode visual isolation — Mock still shows chat feed
- Question-count enforcement — composer asks N questions ~loosely~
- Incomplete-attempt waiver — second early-exit is processed but not marked done
- Talk-time stats — no chip warning if tutor over-speaks
- Score delta narrator — "Last call you got 5.5" line absent
- Results screen + email — admin-only review of Mock scores

**Recommended:** ship the floor + Theme 5 (unlock-gate visible-but-locked, role-bypassed for testers) + Theme 13a (results screen) ≈ **9 person-days**. Below that, voice testing exposes too many "this isn't there yet" gaps that aren't about the voice integration itself.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Theme 2 client-side cue scheduler doesn't survive WebRTC tab-blur / audio focus changes** | Medium | Voice-test invalid — tutor cues miss | Pin a vitest using `vi.useFakeTimers()` + a manual hf-dev VM smoke run with intentional blur. Fallback: VAPI server-tools (Phase 2). |
| **Theme 4 examiner WebRTC analyser node doesn't capture VAPI remote track on Safari** | Medium | Mock dual-waveform missing in Safari | Test on Safari early. Fallback: amplitude derived from the prompt `responseText` length (rough proxy) — same visual effect. |
| **Theme 6 segmentation depends on transcript boundary detection being reliable in real voice transcripts** | Medium | Per-part scores mis-attributed | Verify on 3 hf-dev Mock runs before treating as done. `segment-mock-transcript.ts` was built on simulated text — the voice boundaries may be looser. |
| **Migration bundle (A/B/C/D) needs `/vm-cpp` — risks dev/staging schema drift** | Low | Migration rollback | Standard `/vm-cpp` flow + `npm run db:reset` on hf-staging if needed. |
| **Theme 1 module-scoped settings might over-engineer for IELTS-only use case** | Medium | 2 d slip turns into 4 d if scope creeps to "general module settings framework" | Time-box: ship only the 5–6 IELTS-required keys in Phase 1 (`questionTarget`, `minSpeakingSec`, `cueCardPool`, `closingLine`, `firstTimeOrientationLine`, `scheduledCues`). Refactor later if other courses need it. |
| **Tester role bypass on Theme 5 unlock gate creates "works on tester / breaks on learner" risk** | Low | Real-learner regression | Add a vitest pinning the STUDENT role gets blocked when prereqs unmet, and OPERATOR+ does not. |
| **Email infra (Theme 13c) assumes a working `MessagingProvider` row for IELTS results** | Low | Email silent-fails | Reuse the row already used by `issueFirstCallPin` if no IELTS-specific provider needed; document the row key in the story. |
| **Per-LO mastery NOT shown in IELTS Attainment tab might confuse testers used to other courses** | Low | "Where's the LO grid?" — minor confusion | Add a single helper-text line: "IELTS scores at criterion grain; no per-LO drill." Save the ~0 d on the deferral. |

---

## Self-audit: robustness + reuse of existing chains

Added 2026-06-15 after a self-audit pass. The 14 themes were re-checked against existing HF reusable patterns (compose chain, ESLint rule family, messaging adapter, setting contracts, Snapshot v3 blocks). 4 themes were caught with IELTS-shaped corners; all 14 were re-mapped to lean harder on existing primitives.

### Robustness audit — IELTS-shaped corners found and fixed

| # | Theme | Original shape | Robust shape | Cost delta |
|---|---|---|---|---|
| 6 | Per-part Mock scoring | `CallScore.segmentKey ENUM('p1','p2','p3')` — IELTS labels in Postgres | `CallScore.segmentKey String?` (nullable text) + `Session.metadata.segmentLabels: Array<{key,label,ordinal}>` so labels are data | 0 d — same migration |
| 10 | IELTS profile capture | Hand-coded `ielts:reason` / `ielts:targetBand` keys in `extract-callerMemory` | Generic `AuthoredModule.settings.profileFieldsToCapture: Array<{key,prompt,type}>` walked by a generic EXTRACT routine | +1 d (0.5 → 1.5) — every future course reuses |
| 12 | Tester direct link | `/x/test/ielts/[session]` — IELTS in URL | `/x/test/[playbookSlug]/[moduleSlug]?learnerMode=fresh\|return` | 0 d — pure refactor |
| 7 | Talk-time stats | Hardcoded 30s / 20% thresholds in chip | `Playbook.config.talkTimeBudgets: {maxTutorTurnSec, maxTutorRatio}` knobs | +0.25 d |
| 2 | Cue scheduler | Phase 1 client-side `useEffect` + browser TTS | Skip Phase 1 hack — do VAPI server-tool dispatcher from day 1 | +2 d (2 → 4) — but ships zero debt |

Net delta to full scope after robustness fixes: **+3.25 d → ~20 d full scope**.

### Reusable patterns + extendable chains leveraged per theme

A theme is "robust" only when it plugs into chains other features already extend. The grid below shows what each theme picks up from existing infrastructure — not what it has to build from scratch.

| # | Theme | Existing chain / pattern leveraged |
|---|---|---|
| **1** | Module-scoped settings (G8) | Setting-contracts registry (#1676/#1679/#1684/#1690/#1692) — Phase 1 control library shipped, Slice A storage applier + staleness bridge shipped, Slice B Inspector renderers shipped. `composeImpact.sections` auto-derives via `lib/compose/affecting-keys.ts`. Writes call `bumpPlaybookComposeTimestamp` (`lib/compose/bump-timestamp.ts`); cross-Curriculum fanout via `bumpCurriculumComposeFanout`. `writeGate: "operator-only"` honored by PATCH route. **G8 entries plug into all of this for free.** |
| **2** | Cue scheduler | `lib/voice/providers/vapi/` provider adapter is the right home for server-tool dispatch. No existing scheduler primitive — Theme 2 builds + registers. **New chain — but registers under the existing voice-provider adapter shape.** |
| **3** | Pinned chat card | `Session.metadata Json?` (new column following `voiceConfigSnapshot Json?` pattern). Render uses Snapshot v3 block primitives (Wave A/B/C — Hero proof points, Engagement, Mock card all use the same shape). |
| **4** | Mock exam shell | Discriminator already exists: `AuthoredModule.mode === "examiner" && sessionTerminal`. Wraps `useVoiceMode` hook (existing). |
| **5** | Unlock gates | `recommend-next-module.ts` already loads `CallerModuleProgress`. STUDENT-scope guard pattern (`resolveCallerScopeForReading`) is the sibling primitive for role-based bypass. |
| **6** | Per-part scoring | `lib/curriculum/segment-mock-transcript.ts` already segments. `writeCallScore` from `lib/measurement/write-call-score` is the canonical writer (extends with `segmentKey` arg). **ESLint `no-bare-call-score-write.mjs` already exists** (#1539) — blocks bypass automatically. |
| **7** | Talk-time stats | AppLog "loud-skip" pattern (just shipped — `feat(curriculum): promote silent lo_mastery skip to AppLog`). Write `voice.talk_time.over_budget` AppLog when threshold exceeded. Setting-contracts G7 entry for thresholds. |
| **8** | Question count target | `AuthoredModule.settings.questionTarget` via Theme 1. Composer template renders into INSTRUCTIONS section. EXTRACT counter is a generic interrogative-form detector. |
| **9** | Incomplete-attempt counter | `endSession` builder (#1342) — extend with module-scope incomplete eval (it already evaluates `DEFAULT_MIN_LEARNER_DURATION_SECONDS`). Pattern of `no-bare-call-create.mjs`: introduce `markModuleIncomplete()` helper + paired ESLint rule blocking bare `prisma.callerModuleProgress.update`. |
| **10** | Profile capture (generic) | `extract-callerMemory` extension. `validate-manifest.ts` pattern (ai-to-db-guard) validates AI output before write. **arch-checker Class B classification** (`@ai-call` annotation) since this extends EXTRACT-stage AI work. |
| **11** | Score-delta narrator | `loadPriorCallFeedback` already runs in composer — extends to emit `priorCriterionScores`. Reads `tierPresetId` for criterion naming. AttainmentTab block primitive for the delta UI. |
| **12** | Tester direct link | Existing sim-runner (`lib/test-harness/sim-runner.ts`). `cloneDemoCaller` follows existing demo-caller pattern. OPERATOR+ role gate via `requireAuth`. |
| **13a** | Results screen | Snapshot v3 block primitives (Wave A1 folds, Wave B insights, Wave C1 hero/engagement) — same render shape. `useTaskPoll` for async-pipeline progress (blocked-by-`no-bespoke-async-polling.mjs` — already enforced). |
| **13b** | Trial-state CTA | `Playbook.config` Json + setting-contracts entry. Blocked from drift by `no-direct-playbook-config-write.mjs` (already enforced). |
| **13c** | Results email | `MessagingAdapter.send()` interface (`lib/messaging/`) + `email-resend.ts` adapter. `issueFirstCallPin` is the working precedent. Best-effort don't-break-on-fail contract (#1101 pattern). |
| **14** | scoreVisibilityToLearner | Setting-contracts G7 entry with `writeGate: "operator-only"`. Composer pedagogy + offboarding transforms read it. `composeImpact.sections` auto-bumps staleness. |

### Cross-cutting reuse opportunities

These are patterns every theme should respect — not theme-specific, but discipline-enforcing.

1. **ESLint rule sibling discipline.** Every new shared helper (Theme 6 `writeCallScore` extension, Theme 9 `markModuleIncomplete`, Theme 10 generic profile-capture writer) ships **with** its paired ESLint rule blocking bare-write competitors. Pattern is durable: `no-bare-call-create.mjs` (#1333), `no-bare-call-score-write.mjs` (#1539), `no-bare-strategy-key.mjs` (#1599), `no-direct-playbook-config-write.mjs`, `no-direct-spec-config-write.mjs`. **Cost: +0.25 d per new helper.**

2. **Section-staleness derivation contract.** Every Theme 1 G8 entry whose `composeImpact.sections[]` is non-empty triggers automatic staleness bumping via `lib/compose/affecting-keys.ts`. No hand-rolled cache invalidation — register in the affecting-keys map and the rest is free. Sister-shipped via #1690/#1692.

3. **Loud-skip AppLog pattern.** Where a theme has a "silent skip" branch (Theme 6 missing-segment, Theme 8 question-count-undershoot, Theme 9 incomplete-attempt, Theme 14 score-suppress-overridden), promote to AppLog write. Pattern matches today's `feat(curriculum): promote silent lo_mastery skip to AppLog`. **Cost: ~5 lines per branch.**

4. **`arch-checker @ai-call` Class B classification.** Theme 10's generic profile-capture EXTRACT extension qualifies as Class B (transcript analysis producing AI-derived structured data). Needs grounding contract in system prompt + the classifier checklist from `.claude/rules/ai-read-grounding.md`. **Cost: +0.25 d for the classification work.**

5. **`## Verified by` PR-body discipline.** Every theme's PR carries a live citation (SQL query result, log subject, curl probe, or vitest). Enforced by `scripts/gh-pr-create.sh`. No exemption.

6. **Registry-completeness vitest pattern.** Theme 1 G8 entries pinned by extending `tests/lib/journey/registry-completeness.test.ts` (already exists from #1676). Theme 10 `profileFieldsToCapture` shape pinned by a new sibling vitest matching the registry-completeness pattern. **Cost: ~0.5 d total across both.**

### Risk register additions (post-self-audit)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Theme 2 server-tool dispatcher doesn't exist yet** — only `auth.ts` + `index.ts` in `lib/voice/providers/vapi/` | High | Theme 2 scope balloons | Spike day 1 — confirm VAPI supports the `vapi.say()` + scheduled-event pattern or fall back to provider-specific server-message contracts. May need to file a separate primitive story. |
| **Theme 1 G8 entries multiply Inspector renderer count** | Medium | Phase 1 control library may not cover all 5–6 new key shapes | Validate the 13 primitives in `apps/admin/components/journey-controls/` cover the key shapes BEFORE registering G8 entries. Missing primitives = +0.5 d each. |
| **Theme 6 `writeCallScore` extension drifts if not all callers updated atomically** | Low | Per-part scoring writes inconsistent rows | Single-commit migration: column + writer + every consuming reader in one PR. `no-bare-call-score-write.mjs` blocks the regression class structurally. |
| **Theme 10 EXTRACT extension doesn't classify as Class B in arch-checker** | Low | `@ai-call` audit flags new surface | Add classification when writing the EXTRACT extension; satisfies arch-checker Check G at PR time. |

### Revised totals (after robustness + reuse pass)

| Scope | Initial estimate | After robustness | After reuse-leverage | Net delta |
|---|---|---|---|---|
| Full scope (all 14 themes) | 17 d | 20 d | **~20 d** (reuse offsets some adds) | +3 d for honest robustness |
| Pre-voice-testing target | 11 d | 13 d | **~12.5 d** (reuse saves 0.5 d on results screen + email) | +1.5 d |
| Absolute floor | 6.5 d | 7 d | **~6.75 d** | +0.25 d |

The reuse pass shows that **Themes 1, 6, 13a, 13b, 13c, 14** all plug into chains where the structural enforcement is already shipped — they cost what they say. **Themes 2, 9, 10** still carry net-new infrastructure (cue scheduler, incomplete helper + ESLint, profile-capture EXTRACT extension) but each adds <1 d of cross-cutting cost (paired ESLint + arch-checker + AppLog) that gets amortised by the next course that lands.
