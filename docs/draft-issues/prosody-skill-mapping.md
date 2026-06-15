# DRAFT STORY: Playbook.config.voice.prosodySkillMap — per-course routing for prosody signals

> **Status:** parked until at least one of the prosody vendor adapters
> (SpeechAce / SpeechSuper) exposes general-mode signals (`paceWpm`,
> `hesitationRate`) with non-zero values. Filing without that prerequisite
> ships config plumbing for an empty signal — premature.
> **Activation trigger:** vendor-extension story merges + a non-IELTS
> course has a SpeechAssessmentProvider connected on hf-dev / hf-staging.
> **Draft author:** 2026-06-15 session "VerfiyLearning".

## TL;DR

Add a Playbook-config knob that lets a non-IELTS course route prosody
vendor signals into ITS OWN `skill_*` parameter family, instead of (or
in addition to) the system-default `prosody_pace_wpm` /
`prosody_hesitation_rate` slots shipped on 2026-06-15
(commit `02e2dcaf`).

Generalises the IELTS pattern — where prosody signals already flow into
4 dedicated `skill_*` params (FC, P, LR, GRA) — so any course with an
authored skills framework (e.g. a "Conversational Skills" family with
`skill_conv_fluency`, `skill_conv_pace`, `skill_conv_pronunciation`)
can have its skill slots fed by the vendor signal without code changes.

## Why this exists

Today (post 2026-06-15 split):

- IELTS courses (`Playbook.config.tierPresetId === "ielts-speaking"`)
  → vendor signals land on 4 dedicated `skill_*` params via the IELTS
  branch in `lib/pipeline/prosody-consumer.ts:107-141`.
- Non-IELTS courses → vendor signals land on `prosody_pace_wpm` and
  `prosody_hesitation_rate` (generic system slots). Useful for trend
  visibility but not connected to any course's skills framework.

An educator authoring a "Conversational Skills" framework
(see `docs/draft-issues/prosody-skill-mapping.md` for the format) has
no way to say "route the vendor pace signal to MY `skill_conv_pace`
param instead of the generic slot". The signal lands but doesn't drive
the course-specific banding / dashboards.

## Proposed shape

```jsonc
{
  "voice": {
    "prosodyMode": "general",
    "prosodySkillMap": {
      "paceWpm":         "skill_conv_pace",
      "hesitationRate":  "skill_conv_hesitation"
    }
  }
}
```

When the map is present, `lib/pipeline/prosody-consumer.ts::writeGeneralCallScores`
reads from `Playbook.config.voice.prosodySkillMap` instead of the
hardcoded `GENERAL_PARAM_IDS` constant. When absent, falls back to the
generic system slots (today's default).

Either-or — not both. If a course wants prosody signals on BOTH the
generic slot AND a course skill, that's a second story.

## Acceptance criteria

1. Schema: `PlaybookConfig.voice.prosodySkillMap?: Record<"paceWpm" | "hesitationRate", string>`
   added to `lib/types/json-fields.ts`. Type-check passes.
2. Consumer reads the map from `Playbook.config.voice.prosodySkillMap` —
   if set, every entry's value MUST correspond to an existing `Parameter`
   row (FK-restricted; consumer logs a warn and falls back to the generic
   slot if not). If absent, falls back to `GENERAL_PARAM_IDS` (existing
   behaviour).
3. Cmd+K `update_voice_config` tool accepts `prosodySkillMap` as a writable
   field and validates the parameterIds exist via the AI-to-DB write guard
   pattern (see `.claude/rules/ai-to-db-guard.md` row "no-ai-forbidden-fields").
4. UI tooltip at `app/x/courses/[courseId]/page.tsx:2094` shows the
   mapped param IDs when present, falls back to the generic slot names
   when not.
5. Vitests in `tests/lib/pipeline/prosody-consumer.test.ts`:
   - With map → routes to mapped params, NOT the generic slots
   - Without map → routes to generic slots (existing behaviour)
   - With map pointing at a non-existent parameterId → warn-logs + falls
     back to generic slot (FK-safety)
6. Promptfoo eval `evals/voice/prosody-skill-routing.yaml` pins the
   educator-facing behaviour for a representative "Conversational Skills"
   course config.

## Out of scope

- The vendor adapter extension itself (separate story — see
  `lib/pipeline/prosody-runner.ts:367-373` for the hardcoded-zero
  surface).
- "Conversational Skills" rubric authoring (educator content, not
  engineering).
- BOTH generic slot + skill slot write (second story if needed).

## Effort

S-M. The consumer-side read is a one-line `Playbook.config` lookup with
a fallback. The validation + ESLint allow-list updates are mechanical.
The bulk of the time is the eval + the educator-facing docs + the small
UI change.

## Dependencies

- This story (prosodySkillMap) is decoupled from "Conversational Skills"
  rubric authoring — an educator can author a skills framework today
  via the wizard, get `skill_*` params created, and route prosody at
  them once this story ships.
- Blocked on the vendor-extension story (filing prosodySkillMap before
  the vendor signals are real would ship plumbing for zero values).

## Related

- 2026-06-15 audit + the slot-split commit (`02e2dcaf`) that motivated
  this story.
- IELTS handling at `lib/pipeline/prosody-consumer.ts:43-48` —
  reference implementation for "route vendor signals into a course's
  skill_* params".
- ADR `docs/decisions/2026-06-15-agent-report-verification.md` — the
  audit-verification methodology that surfaced the original overwrite.
