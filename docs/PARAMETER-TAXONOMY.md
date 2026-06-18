# Parameter Taxonomy — Canonical Spec v1.0

> Companion to `apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`. This document defines the 10 canonical `domainGroup` names — part of HF's intellectual property surface (epic #1946 "Foundation = Spec, Storage = DB").

## Background

Before #1948, `Parameter.domainGroup` carried 18 distinct spellings across three naming cohorts (snake_case, kebab-case, mixed). Examples of drift: `learning-adaptation` AND `learning_adaptation` AND `learning` all referenced the same conceptual cluster.

This taxonomy consolidates to 10 canonical groups. The Tune sidebar's Graphic Equalizer renders parameters grouped by `domainGroup`; consolidation makes the educator UI legible and the IP surface coherent.

**Pedagogy review status:** REQUIRED. This document must be reviewed by a named pedagogy reviewer before merge of the #1948 PR. Mapping decisions are encoded in the migration `20260618130000_1948_domain_group_taxonomy`.

## Canonical groups

### 1. `behavior-core`

Fundamental tutor-behaviour dimensions — warmth, formality, directness, tone. These are the bedrock axes any AI tutor adjusts along regardless of subject matter or learner type.

**Pre-#1948 source:** `style` (6 entries — `*_actual` measured siblings of canonical `BEH-*` params; some will be deprecated by S1 dedup #1949).

### 2. `learning-adaptation`

How the tutor adapts to the learner's preferred learning style, pace, modality, and engagement patterns. The "meet the learner where they are" axes.

**Pre-#1948 sources:** `learning-adaptation` (24) + `learning_adaptation` (4) + `learning` (15) + `interaction_adaptation` (4) + `pacing_adaptation` (2). Total: **49 entries**.

### 3. `curriculum-adaptation`

How the tutor adapts curriculum depth, sequence, scaffolding, and content presentation to the learner's progress and mastery signals.

**Pre-#1948 sources:** `curriculum-adaptation` (25) + `curriculum` (7). Total: **32 entries**.

### 4. `personality-adaptation`

How the tutor adapts to the learner's personality dimensions — Big Five traits, companion preferences, social register. The "match the learner's personality fit" axes.

**Pre-#1948 sources:** `personality-adaptation` (9) + `personality` (5). Total: **14 entries**.

### 5. `supervision`

Oversight, error handling, intervention, and meta-tutoring behaviour. How the tutor monitors its own performance and the learner's session arc.

**Pre-#1948 source:** `supervision` (12). Total: **12 entries** (unchanged).

### 6. `companion`

Rapport, encouragement, narrative continuity across sessions, relational warmth. The "ongoing companion" axes that turn a tutor into a sustained learning partner.

**Pre-#1948 sources:** `companion` (15) + `companion-behavior` (2). Total: **17 entries**.

### 7. `engagement`

Challenge level, novelty injection, momentum maintenance, motivational arcs. How the tutor keeps the learner mentally engaged through a session.

**Pre-#1948 sources:** `engagement` (10) + `engagement_adaptation` (3). Total: **13 entries**.

### 8. `reinforcement`

Feedback timing, praise frequency, correction style, mistake recovery. The closed-loop axes that shape how the learner experiences their own progress.

**Pre-#1948 sources:** `reinforcement` (5) + `feedback_adaptation` (1). Total: **6 entries**.

### 9. `onboarding`

First-call and intake-flow behaviours. How the tutor introduces itself, discovers learner goals, and sets the relational tone.

**Pre-#1948 source:** `onboarding` (5). Total: **5 entries** (unchanged).

### 10. `voice-delivery`

Voice-surface behavioural dimensions — interrupt sensitivity, backchannel rate, opening-recap policy, recap-synthesis policy, speaking-rate target, filler-use rate, affirmation rate. These currently live as flags or VoiceProvider config; epic #1946 S5 (#1952) promotes them into canonical parameters.

**Pre-#1948 source:** none. **Placeholder for #1952.** Total at #1948 merge time: **0 entries**.

## Post-#1948 distribution

| Canonical group | Count |
|---|---|
| learning-adaptation | 49 |
| curriculum-adaptation | 32 |
| companion | 17 |
| personality-adaptation | 14 |
| engagement | 13 |
| supervision | 12 |
| reinforcement | 6 |
| behavior-core | 6 |
| onboarding | 5 |
| voice-delivery | 0 (S5 placeholder) |
| **Total** | **154** |

Future epic #1946 S5 (#1952) will add ~7 entries to `voice-delivery`.

## Naming convention

- All canonical group names use **kebab-case**.
- No underscores, no camelCase, no mixed.
- Hyphens separate concept tokens (`personality-adaptation`, not `personality_adaptation`).

A new parameter MUST land in exactly one of these 10 groups. New groups require an epic-level decision — the taxonomy is itself canonical spec.

## Customer override boundary

`Parameter.domainGroup` is presentation metadata. Customers cannot override it. The cascade overrides parameter VALUES via `BehaviorTarget`; SEMANTICS (definition + interpretation + domain) are HF-canonical per #1947's auth tightening.

## Data-driven UI invariant

Both the Tune sidebar Graphic Equalizer (`PlaybookBuilder.tsx:3184`) and the compose layer (`targets.ts:193`) read `domainGroup` dynamically. Changing a parameter's group in the registry + running `db:seed` reshapes the Tune sidebar without code change. This invariant is asserted in the #1948 PR's acceptance criteria.

## Versioning

This taxonomy is `v1.0`. Future versions bump with the same `vX.Y` pattern as other canonical specs (`COMP-001`, `PIPELINE-001`, `TOOLS-001`). Old major versions stay reproducible — a customer pinned to `taxonomyVersion: v1.0` continues to see the v1 grouping after HF ships v2.

The `taxonomyVersion` field appears in the registry JSON header (`docs-archive/bdd-specs/behavior-parameters.registry.json`).
