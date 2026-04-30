# ADR: Session Flow — one canonical model for all course types and delivery methods

**Date:** 2026-04-29
**Status:** Proposed
**Deciders:** Paul W
**Related:** [scheduler-owns-the-plan](2026-04-14-scheduler-owns-the-plan.md), [outcome-graph-pacing](2026-04-14-outcome-graph-pacing.md), [survey-rethink-state-machine](2026-04-16-survey-rethink-state-machine.md)

## Context

Four overlapping terms describe the same pedagogical surface in the codebase: **Onboarding**, **Session Flow**, **Welcome Flow**, and **Discovery**. A fifth, also called **Discovery**, is an unrelated educator-facing tool (`workflow.classify`). The result is configuration drift, three priority cascades for the same data, two flags gating the same probe, and an NPS feature whose runtime trigger does not exist.

The 2026-04-13 Boaz tests and the welcome-flow followup chain (#210/#212/#213) surfaced these as user-visible bugs (toggle propagation, redundant chips, double-gating). The fixes have stabilised the runtime, but the underlying model is still tangled. The educator-facing toggles are good — Paul has confirmed "Session Flow flags are simple and easy to understand and fit into wizard." The cleanup is not in the toggles; it is in the names, cascades, and runtime delivery beneath them.

This ADR documents what runs today and proposes a canonical model that covers every course type (knowledge / comprehension / practice / syllabus / revision / confidence-build) and every delivery method (voice, chat, future modalities) without introducing new abstractions.

## What happens today

### Configuration sources (4 layers, 3 cascades)

```
INIT-001 spec (DB seed, fallback)
  ↑
Domain.onboardingFlowPhases (institution default)
  ↑
Playbook.config.onboardingFlowPhases (course override)
  +
Playbook.config.welcome.{goals,aboutYou,knowledgeCheck,aiIntroCall}.enabled (toggles)
Playbook.config.nps.{enabled,trigger,threshold}
Playbook.config.offboarding.{triggerAfterCalls,bannerMessage,phases}
Playbook.config.surveys.{pre,post}        ← legacy, kept for back-compat
Playbook.config.assessment.{personality,preTest,postTest}  ← parallel surface
```

Three of these (`welcome`, `surveys`, `assessment`) overlap. `surveys` is marked legacy. `assessment.preTest/postTest` is functional but parallel to `welcome.knowledgeCheck`.

### Runtime selection (composition transforms)

Every prompt is assembled by `CompositionExecutor` (21 parallel loaders, 27 ordered transforms). The two transforms that drive learner-flow decisions:

- **`pedagogy.ts`** (`lib/prompt/composition/transforms/pedagogy.ts:19`)
  - Branch on `isFirstCall`:
    - **First call:** read `Playbook.config.onboardingFlowPhases` → `Domain.onboardingFlowPhases` → INIT-001. Filter out the `discovery` phase if all welcome toggles are off (`pedagogy.ts:84–87`).
    - **Subsequent calls:** scheduler-mode branch (teach/review/assess/practice) → fallback returning-caller flow. Mandatory review-before-new-material (`pedagogy.ts:152–192`). Post-coverage hardfall (`pedagogy.ts:223–250`).
  - Final-session branch activates an offboarding section.

- **`quickstart.ts`** (`lib/prompt/composition/transforms/quickstart.ts:200`)
  - Reads `WelcomeToggles` from `Playbook.config.welcome` (`quickstart.ts:26–51`).
  - `detectPersonalisationMode()` → `PRE_LOADED` | `COLD_START` | `OPT_OUT` (`quickstart.ts:91–95`).
  - Renders `discovery_guidance` per-toggle (`quickstart.ts:498–514`): "Do NOT ask about goals…", etc.
  - Greeting cascade: identity-spec instruction → `Playbook.config.welcomeMessage` → `Domain.onboardingWelcome` → generic.

### Assessments

- MCQ pool generated post-extraction by `maybeGenerateMcqs()`. Two strategies: Bloom (knowledge) vs PIRLS 6-skill (comprehension).
- **Course-level shape:**
  - Non-comprehension: `[Onboarding] → [PRE-TEST 5Q] → [Sessions] → [POST-TEST same 5Q] → [Offboarding]`. Uplift = post − pre.
  - Comprehension: pre-test skipped → mid-test at N/2 → post-test at N (independent question pools).
- **Trigger:** scheduler `mode === "assess"` OR transcript classifier detects skill was tested. Event-gated scoring fixes Boaz S1–S4 fabricated scores.
- **Knowledge Check toggle** double-duty: gates the MCQ pre-test *and* the Socratic "Probe existing knowledge" first-call step. Same flag, two delivery modes.

### NPS

- Configured: `Playbook.config.nps = {enabled, trigger, threshold}` (`json-fields.ts:137–142`).
- Triggers in the type system: `"mastery"` (≥80% mastery) or `"session_count"` (after N calls).
- **Runtime delivery does not exist.** No transform reads `nps.trigger`. No journey-stop rule evaluates the threshold. NPS is data-modelled but not wired. Likely intended to fire via `Playbook.config.offboarding.phases` — but that path is also not visible from the composition layer for NPS specifically.

### Terminology audit

| Term | Where | Meaning in that context | Overlaps |
|---|---|---|---|
| **Onboarding** | `Domain.onboardingFlowPhases`, `Playbook.config.onboardingFlowPhases`, `OnboardingPhase`, INIT-001, `OnboardingSession` entity | The configurable first-call template (phases, durations, goals, content, surveySteps) | Session Flow |
| **Session Flow** | `wizard-hints.ts:81–84` ("conversation phases"), educator-facing UI label for welcome toggles | Two senses overloaded: (a) phases inside one session, (b) sequence of session types across course | Onboarding, Welcome Flow, Discovery |
| **Welcome Flow** | `Playbook.config.welcome`, `WelcomeConfig`, `WelcomeToggles` | The 4 boolean toggles (goals/aboutYou/knowledgeCheck/aiIntroCall) | Session Flow |
| **Discovery (phase)** | `quickstart.ts:469`, `onboardingFlowPhases.phases[].phase==="discovery"` | The 2nd phase of first call — learner profiling | Onboarding |
| **Discovery (tool)** | `workflow.classify` ("Discovery & Planning") | Educator-facing AI intake tool | None (just shares the word) |

Three labels, one concept. One label, two concepts. One feature configured, not delivered.

## Decision

**Adopt one canonical vocabulary, one configuration surface per concern, and one runtime resolver. Keep the toggles Paul likes; rename the rest.**

### 1. Canonical vocabulary

| Canonical name | Replaces | Definition |
|---|---|---|
| **Session Flow** | "Welcome Flow", "conversation phases" (educator-facing only) | The educator-facing toggles that shape *what happens around teaching* — pre, mid, post. |
| **Onboarding Flow** | (kept) | The structural template for the *first* session: phases, durations, goals. |
| **Discovery** | (kept, scoped) | A *phase* inside the first session where the AI profiles the learner. Not a flow. Not a tool. |
| **Course Intake** | "Discovery (workflow.classify)" | The educator-facing AI tool that captures course intent. Renamed to end the collision. |
| **Journey Stop** | "auto-include stops", ad-hoc surveys | A *gated, optional moment* the system inserts before/after a session: pre-test, mid-test, post-test, NPS, reflection. |

### 2. One configuration surface per concern

Collapse the parallel surfaces into a single Session Flow shape on `Playbook.config`:

```typescript
interface SessionFlowConfig {
  // Pre-course (before any teaching session)
  intake: {
    goals: { enabled: boolean };
    aboutYou: { enabled: boolean };
    knowledgeCheck: { enabled: boolean; deliveryMode: "mcq" | "socratic" };
    aiIntroCall: { enabled: boolean };
  };

  // First session structure (was: onboardingFlowPhases)
  onboarding: {
    source: "course" | "domain" | "default";  // resolver hint, not config
    phases: OnboardingPhase[];                  // when source === "course"
  };

  // Steady-state behaviour is owned by the scheduler — no config needed here

  // Journey stops — gated insertions across the course
  stops: JourneyStop[];

  // End-of-course
  offboarding: {
    triggerAfterCalls: number;
    bannerMessage?: string;
    phases: OnboardingPhase[];
  };
}

interface JourneyStop {
  id: string;                          // "pre-test", "mid-test", "post-test", "nps"
  kind: "assessment" | "survey" | "nps" | "reflection";
  trigger: JourneyStopTrigger;
  delivery: { mode: "voice" | "chat" | "either"; component: string };
  payload: SurveyStepConfig[] | { source: "mcq-pool"; count: number };
  enabled: boolean;
}

type JourneyStopTrigger =
  | { type: "first_session" }
  | { type: "before_session"; index: number }       // 0 = before session 1
  | { type: "after_session"; index: number }        // -1 = after final
  | { type: "midpoint" }                            // calculated: ceil(N/2)
  | { type: "mastery_reached"; threshold: number }
  | { type: "session_count"; count: number }
  | { type: "course_complete" };
```

Deprecate (with one release of dual-read): `Playbook.config.welcome` (folded into `intake`), `Playbook.config.surveys` (folded into `stops`), `Playbook.config.assessment.{preTest,postTest}` (folded into `stops`), `Playbook.config.nps` (folded into `stops`), `Playbook.config.onboardingFlowPhases` (folded into `onboarding.phases`).

Result: one shape, one source of truth, one place an educator looks.

### 3. One runtime resolver

Replace the three priority cascades scattered across `pedagogy.ts:73–78`, `quickstart.ts:406–436`, and the (pending) NPS path with a single resolver:

```typescript
// lib/session-flow/resolver.ts
function resolveSessionFlow(playbook, domain, init001): SessionFlowResolved {
  return {
    intake:       playbook.sessionFlow?.intake       ?? defaultIntake(domain),
    onboarding:   playbook.sessionFlow?.onboarding?.phases
                  ?? domain.onboardingFlowPhases
                  ?? init001.phases,
    stops:        mergeStops(defaultStops(playbook.teachingMode), playbook.sessionFlow?.stops),
    offboarding:  playbook.sessionFlow?.offboarding   ?? domain.offboarding ?? defaults.offboarding,
  };
}
```

Composition transforms read from the resolved object, not from `Playbook.config` directly. The cascade lives in one file with one test.

### 4. One delivery surface per stop

Today, surveys deliver via `ChatSurvey`, MCQs deliver via the MCQ generator + chat survey, NPS has no delivery. Define one `JourneyStop` runner that:

- Evaluates each stop's `trigger` against the current pipeline event (call start, call end, mastery threshold cross, session count cross, course complete).
- Picks the `delivery.mode` (voice/chat/either) based on the active call's modality. `"either"` falls back to chat when voice is unavailable.
- Renders `payload` through the existing `ChatSurvey` component or, for voice, injects a section into the next composition pass.

This is the missing wire for NPS. It also opens the door cleanly for future delivery modes (video, in-person companion app) without re-modelling.

## Extensibility — how this covers every course type and delivery method

### Course types (six, all covered by the same model)

| Type | `teachingMode` | Default `JourneyStop` set | Notes |
|---|---|---|---|
| Knowledge (history, science) | `recall` | pre-test, post-test, nps | Bloom MCQs. Uplift = post − pre. |
| Comprehension (literacy, reading) | `comprehension` | mid-test, post-test, nps | Pre-test skipped (passage required). PIRLS 6-skill MCQs. Independent pools. |
| Skill practice (maths, language) | `practice` | post-test, nps | Interleave/spacing carry the load; less reliance on stops. |
| Syllabus (exam-prep) | `syllabus` | pre-test, mid-test, post-test, nps | Heavier stop cadence — exam pressure rewards retrieval practice. |
| Revision | (preset only) | post-test, nps | Returning learners; minimal new content; light scaffolding. |
| Confidence-build | (preset only) | post-test, nps (mastery-gated) | NPS only fires after mastery threshold to avoid surveying anxious learners early. |

The course type does not introduce new code paths; it picks a different default `stops` set. Educators can override per-stop in the wizard.

### Delivery methods

`JourneyStop.delivery.mode` controls *how* the stop is delivered. Today: `voice` (VAPI) and `chat` (ChatSurvey). Tomorrow: any modality that implements the `JourneyStopRunner` interface. The trigger logic and payload are modality-agnostic — only the renderer changes.

This also resolves the Knowledge Check double-gating: the toggle decides whether the stop exists; `delivery.mode` (or `intake.knowledgeCheck.deliveryMode`) decides whether it runs as MCQ batch or Socratic probe. One flag, two clean delivery options, no overload.

### Adding a new course type

1. Add a `teachingMode` value.
2. Add a scheduler preset.
3. Add a default `stops` set in `defaultStops(teachingMode)`.

No new config surfaces, no new resolvers, no new transforms. The model absorbs new course types as data, not as code.

### Adding a new stop type (e.g., reflection journal, peer-feedback)

1. Add a `JourneyStop.kind` value.
2. Implement a `JourneyStopRunner` for it.
3. Optionally add a default trigger.

No changes to the resolver or to existing transforms.

## Consequences

### Positive

- **One vocabulary** — wizard, code, docs, and ADRs use the same names. Onboarding ≠ Session Flow ≠ Discovery.
- **One config surface** — `Playbook.config.sessionFlow` is the only place an educator (or developer) configures learner-facing structure outside the scheduler.
- **One resolver** — three cascades collapse to one. Easier to test, easier to debug, easier to evolve.
- **NPS actually fires** — the `JourneyStop` runner closes the missing-wire gap.
- **Knowledge Check unambiguous** — `deliveryMode: "mcq" | "socratic"` ends the double-gating.
- **Course-type-agnostic** — same model handles knowledge, comprehension, practice, syllabus, revision, confidence-build.
- **Modality-agnostic** — voice / chat / future modalities plug into `JourneyStopRunner` without touching trigger or payload code.
- **Forward-compatible with the scheduler** — stops are *outside* the per-exchange decision; the scheduler still owns "what happens this exchange." Stops own "what wraps around exchanges."

### Negative / Trade-offs

- **Migration cost.** Five legacy config surfaces (`welcome`, `surveys`, `assessment.preTest/postTest`, `nps`, `onboardingFlowPhases`) need a dual-read shim and a one-shot data migration. Not destructive, but not free.
- **Wizard refresh.** The Course Design wizard step that surfaces these toggles needs to point at the new shape. Behaviour stays the same; bindings move.
- **Renames are visible.** "Workflow Discovery" → "Course Intake" touches the educator-facing UI. Small but noticeable.
- **Default stops are opinionated.** Comprehension defaults to `mid-test + post-test + nps`; some educators may want to disable mid-test. Toggles in wizard cover this, but the *default* is a choice.
- **JourneyStop runner is new code.** Modest scope (~1 file + tests), but it's the first time we've centralised stop delivery — small bug surface to watch in early rollout.

### Compatibility

- **Existing courses:** dual-read for one release. Resolver reads new shape if present, falls back to legacy fields. After the data migration, legacy fields are removed.
- **In-flight calls:** unaffected. Resolver runs at composition time; switching the source field does not change prompt output for any call already configured under the legacy shape.
- **Scheduler integration:** unchanged. The scheduler still owns per-exchange selection. Stops are pipeline-event-driven, not exchange-driven.

## Ship plan

### Phase 1 — Vocabulary + types (no behaviour change)

- Add `SessionFlowConfig` and `JourneyStop` types to `lib/types/json-fields.ts`.
- Add `lib/session-flow/resolver.ts` with `resolveSessionFlow()` reading legacy fields (back-compat).
- Rename `WelcomeToggles` → `IntakeToggles` in code (educator-facing UI keeps "Session Flow flags" label).
- Rename `workflow.classify` → "Course Intake" in UI strings (the route stays, only labels change).

Estimated: 1 story, ~1 day. No schema changes. Tests for resolver precedence.

### Phase 2 — Single resolver, transforms read from it

- Refactor `pedagogy.ts:73–78` to read `resolved.onboarding.phases` instead of cascading inline.
- Refactor `quickstart.ts:26–51` to read `resolved.intake` instead of `Playbook.config.welcome`.
- Refactor first-line greeting cascade (`quickstart.ts:406–436`) into `resolved.welcomeMessage` resolution inside the resolver.

Estimated: 1 story, ~1 day. Composition tests cover regressions.

### Phase 3 — JourneyStop runner + NPS wiring

- Add `lib/session-flow/journey-stop-runner.ts` with `evaluateStops(state, stops)` returning the next stop to fire.
- Wire NPS via a default `JourneyStop` derived from `Playbook.config.nps` (back-compat) or `sessionFlow.stops` (new shape).
- Wire pre-test, mid-test, post-test as `JourneyStop`s replacing `Playbook.config.assessment.preTest/postTest` and the comprehension mid-test branch.

Estimated: 1 story, ~2 days. Integration test against a comprehension course (mid-test fires at session N/2) and a knowledge course (NPS fires on mastery threshold).

### Phase 4 — Wizard refresh

- Course Design step writes to `sessionFlow` (currently writes to `welcome`/`assessment`/`nps`/`offboarding`).
- Stop-level toggles surfaced in wizard for educator override of defaults.
- Educator-facing UI labels canonicalised: "Session Flow flags," "Onboarding Flow," "Journey Stops."

Estimated: 1 story, ~1–2 days. UI snapshot tests + e2e.

### Phase 5 — Deprecate legacy fields

- One-shot migration script copies legacy fields to `sessionFlow`.
- Resolver dual-read removed; reads only `sessionFlow`.
- Legacy fields deleted from `PlaybookConfig`.

Estimated: 1 story, ~half day. Migration + cleanup.

**Total: ~5 stories, 5–7 days. No schema migration; this is JSON-shape consolidation under `Playbook.config`.**

## Alternatives considered

### A. Leave it alone (current state)

Rejected. Five config surfaces, three resolver cascades, one missing runtime wire, four overloaded names. The recent fix chain (#210/#212/#213) shows the cost compounds: every new educator-facing toggle now has to navigate the existing tangle.

### B. Rename only (vocabulary cleanup, leave runtime)

Rejected as half-measure. Renames help readability but do not fix the missing NPS wire, the double-gated Knowledge Check, or the duplicated `welcome` / `surveys` / `assessment` shapes. The runtime model needs consolidation regardless.

### C. Extract Session Flow to its own DB table

Rejected. Adds schema cost without solving the actual problem. The `Playbook.config` JSON shape is fine; what is broken is the *number of shapes*, not the storage. Dropping into a relational table also breaks the spec-driven seed pattern that already works for the rest of `Playbook.config`.

### D. Drive everything through the scheduler

Rejected for v1. The scheduler owns *per-exchange* decisions inside a session. Stops are *between* sessions, fired by pipeline events (call complete, mastery threshold cross). Conflating the two muddies the scheduler's contract and gives it dependencies (e.g., NPS UI delivery) it should not own. Stops and scheduler complement each other; they should not merge.

### E. Move Journey Stops to a separate "stops" spec

Tempting and forward-compatible, but premature. Stops are a small, well-bounded concept and live cleanly under `Playbook.config.sessionFlow.stops`. If they grow (multiple stop authors, per-cohort overrides, A/B testing) we can promote them to a spec then. Premature extraction is the bigger risk.

## Success criteria

1. **One vocabulary** — `grep` for "welcome flow" / "conversation phases" returns zero hits in code (educator UI label "Session Flow flags" is the canonical surface).
2. **One config shape** — `Playbook.config.sessionFlow` is the only field educators or wizard code touch for learner-flow structure. Legacy fields removed after Phase 5.
3. **One resolver** — `resolveSessionFlow()` is the only place that does priority cascades. `pedagogy.ts` and `quickstart.ts` do not read from `Playbook.config` directly for these fields.
4. **NPS fires** — at least one course type has an end-to-end test where `nps.trigger="mastery"` causes the stop to deliver after the mastery threshold is crossed.
5. **Knowledge Check unambiguous** — `intake.knowledgeCheck.deliveryMode` decides MCQ vs Socratic. No flag does double-duty.
6. **All six course types covered** — default `stops` sets exist for knowledge, comprehension, practice, syllabus, revision, confidence-build. Educator overrides via wizard toggles.
7. **No regressions** — Boaz S1–S4 stay fixed. Welcome-flow followup chain (#210/#212/#213) does not reopen.

## Appendix: Business summary for testers and partners

*Plain-English version for course builders, business partners, and non-technical testers. What you experience today, what changes, what stays the same.*

### The short version

**Today** — when you build a course, you flip toggles in the wizard ("ask the learner about their goals," "do a knowledge check"). Those toggles work. The problem is *behind the curtain*: the same idea is configured in four different places under three different names ("Welcome Flow," "Onboarding," "Session Flow," "Surveys"). When something behaves oddly, it's hard to know which switch is in charge.

**New** — same toggles, same wizard, one name: **Session Flow**. Behind the scenes, every "moment" in the learner's journey — pre-test, mid-test, post-test, NPS satisfaction survey, end-of-course wrap-up — lives in one place called **Journey Stops**. You see fewer concepts, the system makes fewer mistakes, and we can add new things (like reflection prompts) without rewiring everything.

### What the learner experiences today

```
[Sign up]
   ↓
[First session]
   - AI greets them
   - Asks about goals (if Goals toggle on)
   - Asks about confidence (if About You toggle on)
   - Probes prior knowledge (if Knowledge Check toggle on)
   - Starts teaching
   ↓
[Sessions 2 → N]
   - Reconnect, recall last session, teach new material
   ↓
[Final session]
   - Wrap up, summarise, celebrate
   ↓
[After course]
   - NPS satisfaction survey ← configured but doesn't actually fire today
```

The two things that are broken or fragile:

1. **Knowledge Check is doing two jobs from one switch.** When you turn it on, it controls *both* a Socratic spoken probe in the first call *and* a written multiple-choice pre-test. If you only wanted one, you can't choose.
2. **NPS doesn't fire.** You can configure it ("send NPS when learner reaches 80% mastery") and the setting gets saved — but the system never actually delivers the survey. It's a wire that was never connected.

### What you experience as a course builder today

When you configure a course, you touch settings spread across several screens:

| Screen | What you set | Internal name |
|---|---|---|
| Welcome flow toggles | Goals, About You, Knowledge Check, AI Intro | "Welcome" |
| Onboarding tab | First-call phases | "Onboarding Flow Phases" |
| Survey config | Pre-test / post-test | "Surveys" |
| Assessment config | Personality + pre/post tests | "Assessment" |
| NPS config | When to fire NPS | "NPS" |
| Offboarding | End-of-course flow | "Offboarding" |

Some of these overlap. "Pre-test" can be configured in two different places. "Knowledge Check" overlaps with the pre-test. Different course types need different combinations and there's no clear default per course type.

### What's the same after the cleanup

- **The toggles you like stay.** Goals, About You, Knowledge Check, AI Intro Call — same names, same behaviour, same wizard step.
- **The first-session structure stays.** Welcome → Discovery → First topic → Wrap-up.
- **Course types stay.** Knowledge, Comprehension, Practice, Exam-prep, Revision, Confidence-build.
- **Pre-test / mid-test / post-test logic stays.** Same questions, same scoring, same uplift calculation.

### What's different after the cleanup

| Before | After | Why it matters |
|---|---|---|
| 4 different names for "what wraps the teaching" | One name: **Session Flow** | You stop guessing which screen owns what |
| 5 parallel configuration surfaces | One: **Session Flow Settings** | One place to look, one place to test |
| Knowledge Check = MCQ + Socratic probe (one switch, two behaviours) | Knowledge Check toggle + delivery choice (MCQ *or* Socratic) | You pick the experience, not get both by accident |
| NPS configured but doesn't fire | NPS fires via Journey Stops | The feature actually works |
| Pre-test, mid-test, post-test, NPS, surveys each modelled differently | All are **Journey Stops** with the same shape | New stop types become a small data change, not a big project |
| Default behaviour depends on which screen you used | Each course type has a sensible **default Journey Stop set** | Less configuration; better starting point |
| Workflow tool also called "Discovery" | Renamed **Course Intake** | Stops the word "Discovery" from meaning two different things |

### Default Journey Stops by course type (after cleanup)

| Course type | Stops the system gives you out-of-the-box |
|---|---|
| **Knowledge** (history, science) | Pre-test → Post-test → NPS |
| **Comprehension** (reading, literacy) | Mid-test → Post-test → NPS *(no pre-test — needs the passage first)* |
| **Practice** (maths, language drills) | Post-test → NPS |
| **Exam-prep** (syllabus) | Pre-test → Mid-test → Post-test → NPS |
| **Revision** (returning learners) | Post-test → NPS |
| **Confidence-build** (anxious / first-time) | Post-test → NPS *(NPS only after mastery, to avoid surveying anxious learners early)* |

You can override any of these per course in the wizard. The defaults are just the starting point.

### What testers should look for after the change ships

1. **Setting up a course feels simpler** — you only navigate one Session Flow area, not five.
2. **NPS actually arrives** — set the trigger, complete the conditions, see the survey delivered.
3. **Knowledge Check does what you picked** — choose MCQ, get MCQ. Choose Socratic, get Socratic. Not both.
4. **Switching course type changes the defaults** — change a course from "Knowledge" to "Comprehension" and the right pre/mid/post tests appear automatically.
5. **No regressions** — the welcome toggle behaviour Paul has been ironing out (#210/#212/#213) keeps working.

### Risk for testers during rollout

- **Old courses keep working.** During the rollout, the system reads both the old settings and the new ones. Nothing breaks for existing courses.
- **A short window of dual labels.** You may see "Welcome Flow" in some screens and "Session Flow" in others until the wizard is updated. Same toggles underneath.
- **One label change is visible:** the *educator-facing* "Discovery" tool becomes "Course Intake." Same tool, clearer name.

## References

- [scheduler-owns-the-plan](2026-04-14-scheduler-owns-the-plan.md) — per-exchange decisions, complements this ADR
- [survey-rethink-state-machine](2026-04-16-survey-rethink-state-machine.md) — survey state machine, prerequisite for Journey Stop runner
- [outcome-graph-pacing](2026-04-14-outcome-graph-pacing.md) — what courses are made of
- `lib/types/json-fields.ts:79–198` — current `Playbook.config` shape
- `lib/prompt/composition/transforms/pedagogy.ts:19` — current first-call branch
- `lib/prompt/composition/transforms/quickstart.ts:26–514` — current welcome toggle handling and discovery guidance
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-journey-stops.md` — auto-include stop history
- Issues #210, #212, #213 — welcome flow followup chain that motivated this consolidation
