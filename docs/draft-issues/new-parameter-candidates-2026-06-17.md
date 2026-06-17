# New Parameter candidates — voice + non-voice (draft)

> **Filed:** 2026-06-17 (this session)
> **Status:** draft for BA + Tech Lead grooming
> **Driver:** operator request after the 6-vitest Coverage pillar landed
> (PRs #1849 / #1854 / #1855 / #1856). Operator asked: "Add new voice
> parameters, look for non-voice candidates, ensure all parameters reach
> the prompt and are educator-visible in the cascade."

## TL;DR

12 parameter candidates across 4 surfaces:
- **5 voice parameters** for the new voice primitives (sayMessage,
  cue-card writer, stall detector, pinned slot, IELTS cue wiring)
- **3 pedagogy parameters** filling supervisor / scaffolding gaps
- **2 engagement parameters** for turn-taking + enthusiasm signal
- **2 memory parameters** for specific-fact recall + trend

Each candidate names the consumer surface it'd wire to (compose
transform / pipeline runner / cascade resolver) so it can pass the
`parameter-coverage.test.ts` gate that just shipped (PR #1856).

## Background

The 2026-06-17 Parameter coverage audit found 154 parameters in the
canonical registry but only 36 (23%) with runtime consumers. The
118 producer-only parameters are tech debt for a separate workstream.

This doc proposes 12 NEW parameters tied to capabilities that have
landed (voice primitives 2026-06-15 → 2026-06-17) or behaviours we
already measure informally but don't surface as educator knobs.

Per the Coverage gate, every new parameter MUST land with a consumer
(or join the exempt list with documented reason). This doc names the
intended consumer for each.

## Voice parameters (5)

These pair with the voice primitives that landed via #1742 / #1733 /
#1734 / #1735 / #1743 / #1744 / #1839.

| Parameter ID | What it measures | Producer (write path) | Consumer (read path) |
|---|---|---|---|
| `BEH-SAY-CADENCE` | Tutor speak-vs-listen ratio per turn (0=mostly listen, 1=mostly speak) | Pipeline PROSODY stage from transcript turn-timing | `targets.ts` directive: "Speak/listen balance: aim for X" |
| `BEH-CUE-CARD-HIT-RATE` | Did the tutor say the cue at the right moment? (0..1 success rate) | Pipeline SUPERVISE — compare emitted cue-card timestamps vs scheduled | `targets.ts` directive: "Cue-card adherence target X" |
| `BEH-STALL-RECOVERY-MS` | Median ms from learner-stall to tutor recovery prompt | Pipeline EXTRACT from transcript event timing | `targets.ts` directive: "Recover learner stalls within Xms" |
| `BEH-PINNED-CARD-ADHERENCE` | Time fraction tutor stayed on the pinned cue-card slot | Pipeline SUPERVISE from cue-scheduler tick log | `targets.ts` directive: "Stay on pinned slot ≥ X%" |
| `BEH-IELTS-PART-DRIFT` | Did the tutor stay in the current IELTS Part (1/2/3)? | Pipeline EXTRACT from transcript topic detection | `targets.ts` directive: "Part-drift tolerance ≤ X" |

Cascade family: all 5 join the existing BEH-* family — system default
in seed, domain override possible, course-level tunable, per-caller
adaptation via REWARD/ADAPT.

## Pedagogy parameters (3)

Filling supervisor / scaffolding gaps surfaced by the Parameter
coverage audit (`supervision` category had 12 gaps; this proposes
filling the most operator-meaningful 3).

| Parameter ID | What it measures | Producer (write path) | Consumer (read path) |
|---|---|---|---|
| `BEH-SCAFFOLD-DECAY` | How fast scaffolding intensity drops as learner masters (0..1 — 0 = static heavy, 1 = aggressive fade) | Pipeline ADAPT computes from session-over-session mastery slope | `targets.ts` + `instructions.ts` directive: "Scaffold fade rate X" |
| `BEH-QUESTION-QUALITY` | Open-vs-closed ratio + cognitive level distribution per session | Pipeline EXTRACT classifies tutor questions by Bloom's level | `targets.ts` directive: "Question quality mix X" |
| `BEH-FORMATIVE-FEEDBACK-DEPTH` | Mean tokens of formative feedback per learner attempt (calibration metric) | Pipeline EXTRACT from transcript feedback-block detection | `targets.ts` directive: "Feedback depth target X tokens" |

Cascade family: existing BEH-* family.

## Engagement parameters (2)

| Parameter ID | What it measures | Producer (write path) | Consumer (read path) |
|---|---|---|---|
| `BEH-TURN-TAKING-BALANCE` | (Tutor turns − learner turns) / total — operator targets ≈0 (balanced) | Pipeline PROSODY from turn counts | `targets.ts` directive: "Aim for balanced turn-taking ±X" |
| `BEH-ENTHUSIASM-SIGNAL` | Learner enthusiasm proxy from prosody (pitch variance, response latency, volume) | Pipeline PROSODY composite | `targets.ts` + `personality.ts` adaptation: increase encouragement when low |

Cascade family: BEH-*.

## Memory parameters (2)

| Parameter ID | What it measures | Producer (write path) | Consumer (read path) |
|---|---|---|---|
| `BEH-SPECIFIC-FACT-RECALL` | Did the tutor recall a specific prior-session fact correctly? (0..1 per session) | Pipeline SUPERVISE compares `CallerMemory` reads against transcript citations | `priorCallFeedback.ts` directive: "Use specific recall when context fits" |
| `BEH-LONGITUDINAL-TREND` | Was tutor narrative aligned with the learner's multi-session trajectory? | Pipeline SUPERVISE compares Goal.progressMetrics against narrative content | `priorCallFeedback.ts` + `instructions.ts`: "Reference trend when narrating" |

Cascade family: BEH-*.

## Wire plan — what each parameter needs to ship

Per the `parameter-coverage.test.ts` gate, each parameter needs:

1. **Registry entry** in `behavior-parameters.registry.json` with
   `parameterId` + `name` + `definition` + `domainGroup` +
   `defaultTarget`.
2. **Producer wire** (per "Producer" column above):
   - Pipeline EXTRACT additions where transcript parsing changes
   - Pipeline PROSODY additions where audio metrics need extracting
   - Pipeline SUPERVISE additions for compare-and-score
   - Pipeline ADAPT additions for adaptive recomputation
3. **Consumer wire** (per "Consumer" column above):
   - `lib/prompt/composition/transforms/targets.ts` reads
     BehaviorTarget for the parameter, emits a prompt directive
   - For voice-specific parameters, the directive may instead surface
     in `lib/voice/build-assistant-config.ts`
4. **Cascade resolver** entry: BEH-* family already exists in
   `lib/cascade/effective-value.ts::FAMILIES`. Each new BEH-* ID
   automatically gets cascade resolution; no resolver change needed.
5. **Educator UI**:
   - Auto-surfaced in the BehaviorTarget Tuning tab (existing
     AgentTuner surface) once seeded.
   - For first-class Inspector exposure, a `JourneySettingContract`
     entry in `setting-contracts.entries.ts` with
     `storagePath: "behaviorTargets[<parameterId>]"` and appropriate
     `menuGroupKey` (likely `J_pacing` for cadence/stall and
     `M_end_of_course` for retention/feedback).

## Sequencing (proposed)

| Phase | Scope | Effort |
|---|---|---|
| 1 | Ship 5 voice parameters: registry + producers in pipeline + targets.ts consumer + Inspector entries | 2 days — 1 PR per parameter |
| 2 | Ship 3 pedagogy parameters: same wire-plan | 1.5 days |
| 3 | Ship 2 engagement parameters: same | 1 day |
| 4 | Ship 2 memory parameters: same | 1.5 days |

Total: ~6 days at 1 dev. Each parameter is independent → parallelisable.

## What needs BA + Tech Lead review

For each parameter:
- **BA**: is this knob educator-meaningful? Does it map to a
  pedagogical decision someone actually makes? What's the
  educator-facing label vs the technical `parameterId`?
- **Tech Lead**: is the producer wire mechanically reasonable? Does the
  pipeline stage already have the inputs needed, or do we need new
  loaders? Is the cascade family choice right?

Open per-parameter questions:
1. `BEH-CUE-CARD-HIT-RATE` — needs cue-scheduler tick log to be
   queryable post-call. Is it persisted today, or will Phase 2 voice
   work need to add a `CueCardTick` table?
2. `BEH-IELTS-PART-DRIFT` — needs in-call IELTS Part detection. Does
   the existing IELTS module-cue wiring (#1839) emit Part transitions
   to AppLog?
3. `BEH-ENTHUSIASM-SIGNAL` — composite of pitch + latency + volume.
   Which prosody fields are already extracted? Anything missing?

## Out of scope

- **Wiring the 118 existing producer-only parameters** — separate
  workstream tracked by the `parameter-coverage` ratchet.
- **Cohort-level analytics** for these parameters — once data flows,
  Skills Framework / cohort dashboards can extend on the new metrics.
- **AnalysisSpec definitions for each parameter** — these need a
  separate design pass: rubric prompts, scoring criteria. Each one is
  a ~1-day BA + Tech Lead exercise.

## Activation checklist

- [ ] BA grooming pass to validate educator-meaningfulness per
  parameter
- [ ] Tech Lead review of producer wire feasibility
- [ ] Decision: ship the voice 5 first as a feature flag, or all 12 at
  once?
- [ ] Per-parameter PR with the canonical wire-plan checklist
- [ ] Each PR drops the `parameter-coverage` ratchet — confirms the
  gate is working as intended
