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

**Note on learning styles (pedagogy-review flag, 2026-06-18).** ~6 parameters currently in this group are based on the VARK / learning-styles framework, which lacks empirical support. Pashler et al. (2008) reviewed 70+ studies and found no evidence for the matching hypothesis [Ref 5]; a 2024 meta-analysis aggregating 21 studies found an effect size of d = 0.04 [Ref 6]. The 3 modality params (`auditory_adaptation`, `kinesthetic_adaptation`, `visual_adaptation`) plus `adapt_to_learning_style` are dead IP — candidates for deprecation in S1 (#1949). This cluster's research-validated dimensions are pace, challenge level, cognitive load, and scaffolding contingency — aligned with Vygotsky's Zone of Proximal Development [Ref 1].

### 3. `curriculum-adaptation`

How the tutor adapts curriculum depth, sequence, scaffolding, and content presentation to the learner's progress and mastery signals.

**Grounded in:** Vygotsky's Zone of Proximal Development — contingent + graduated + reversible scaffolding [Ref 1]. Sweller's cognitive load theory. Anderson's ACT-R cognitive tutors [Ref 2].

**Pre-#1948 sources:** `curriculum-adaptation` (25) + `curriculum` (7). Total: **32 entries**.

### 4. `personality-adaptation`

How the tutor adapts to the learner's personality dimensions — Big Five traits, companion preferences, social register. The "match the learner's personality fit" axes.

**Grounded in:** Big Five (OCEAN) — strong psychometric basis, reproducible across cultures and decades.

**Pre-#1948 sources:** `personality-adaptation` (9) + `personality` (5). Total: **14 entries**.

### 5. `supervision`

Oversight, error handling, intervention, and meta-tutoring behaviour. How the tutor monitors its own performance and the learner's session arc.

**Grounded in:** Metacognitive scaffolding + error handling in the ITS Tutor/Pedagogical Model [Ref 2][Ref 3].

**Pre-#1948 source:** `supervision` (12). Total: **12 entries** (unchanged).

### 6. `companion`

Rapport, encouragement, narrative continuity across sessions, relational warmth. The "ongoing companion" axes that turn a tutor into a sustained learning partner.

**Grounded in:** Self-Determination Theory's "relatedness" need [Ref 4] — the sense that the learner is connected to the tutor. SDT establishes relatedness as one of three necessary and sufficient psychological needs for intrinsic motivation; it cannot be substituted by autonomy or competence support.

**Pre-#1948 sources:** `companion` (15) + `companion-behavior` (2). Total: **17 entries**.

### 7. `engagement`

Challenge level, novelty injection, momentum maintenance, motivational arcs. How the tutor keeps the learner mentally engaged through a session.

**Grounded in:** Self-Determination Theory's "autonomy" and "competence" needs [Ref 4]. Bloom's challenge level. ZPD's "just right" challenge boundary [Ref 1].

**Pre-#1948 sources:** `engagement` (10) + `engagement_adaptation` (3). Total: **13 entries**.

### 8. `reinforcement`

Feedback timing, praise frequency, correction style, mistake recovery. The closed-loop axes that shape how the learner experiences their own progress.

**Grounded in:** AutoTutor's "short feedback" dialogue moves (positive / neutral / negative) [Ref 3]. The most-researched single dimension in education (Hattie's effect-size work).

**Pre-#1948 sources:** `reinforcement` (5) + `feedback_adaptation` (1). Total: **6 entries**.

### 9. `onboarding`

First-call and intake-flow behaviours. How the tutor introduces itself, discovers learner goals, and sets the relational tone.

**Pre-#1948 source:** `onboarding` (5). Total: **5 entries** (unchanged).

### 10. `voice-delivery`

Voice-surface behavioural dimensions — interrupt sensitivity, backchannel rate, opening-recap policy, recap-synthesis policy, speaking-rate target, filler-use rate, affirmation rate. These currently live as flags or VoiceProvider config; epic #1946 S5 (#1952) promotes them into canonical parameters.

**Pre-#1948 source:** none. **Placeholder for #1952.** Total at #1948 merge time: **0 entries**.

### 11. `learner-model` (placeholder per pedagogy review)

Knowledge tracing, mastery state, misconceptions, learner-internal state. Parameters describing what the learner KNOWS and BELIEVES — distinct from how the tutor BEHAVES.

**Grounded in:** The ITS 4-component standard (Anderson; Sleeman & Brown) [Ref 2] mandates a separate Student/Learner Model alongside the Tutor/Pedagogical Model. Anderson's Cognitive Tutors expose this as the "skillometer". HF currently lacks a dedicated cluster for learner-state parameters — a few sit in `learning-adaptation` (e.g. `aggregate_profile`, `pace_indicators`) and would migrate here in a future curation pass.

**Pre-#1948 source:** none. **Placeholder.** Total at #1948 merge time: **0 entries**.

### 12. `affect-motivation` (placeholder per pedagogy review)

Real-time affect detection (frustration, confusion, boredom, flow), motivation state, emotional context. Parameters describing the learner's affective trajectory through a session.

**Grounded in:** D'Mello & Graesser established affect as a distinct ITS dimension in the AutoTutor lineage [Ref 3]. Self-Determination Theory's "intrinsic motivation" construct [Ref 4] depends on affective experience. Currently HF treats this implicitly within `engagement`; a separate cluster acknowledges the research distinction.

**Pre-#1948 source:** none. **Placeholder.** Total at #1948 merge time: **0 entries**.

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
| learner-model | 0 (pedagogy-review placeholder) |
| affect-motivation | 0 (pedagogy-review placeholder) |
| **Total** | **154** |

Future epic #1946 S5 (#1952) will add ~7 entries to `voice-delivery`. The `learner-model` and `affect-motivation` placeholders were added per the 2026-06-18 pedagogy review to acknowledge the ITS 4-component standard; populating them is future curation work.

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

## References

The v1.0 taxonomy is grounded in the following published sources. Pedagogy reviewers should consult these when proposing changes.

1. **Vygotsky, Zone of Proximal Development.** Murray & Arroyo, "Toward Measuring and Maintaining the Zone of Proximal Development in Adaptive Instructional Systems." Foundational frame for `curriculum-adaptation` and the `engagement` challenge-level dimension. https://link.springer.com/chapter/10.1007/3-540-47987-2_75
2. **ITS 4-component architecture.** Anderson's ACT-R Cognitive Tutors + Sleeman & Brown's foundational ITS structure: Domain/Expert + Student/Learner + Tutor/Pedagogical + Interface. Foundational frame for the overall HF taxonomy structure and the `learner-model` placeholder. https://www.sciencedirect.com/topics/psychology/intelligent-tutoring-system
3. **AutoTutor dialogue moves.** Graesser et al., "AutoTutor: An Intelligent Tutoring System with Mixed-Initiative Dialogue." Operationalises tutoring strategies as a finite move set (main question, short feedback, pumps, prompts, hints, assertions, corrections, summaries). Foundational frame for `supervision`, `reinforcement`, and the `affect-motivation` placeholder. https://www.researchgate.net/publication/3051047_AutoTutor_An_Intelligent_Tutoring_System_With_Mixed-Initiative_Dialogue
4. **Self-Determination Theory.** Ryan & Deci, "Self-Determination Theory and the Facilitation of Intrinsic Motivation." The three psychological needs (autonomy, competence, relatedness) are necessary AND sufficient for intrinsic motivation. Foundational frame for `engagement` (autonomy + competence) and `companion` (relatedness). https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf
5. **Learning styles myth — landmark review.** Pashler, McDaniel, Rohrer & Bjork, "Learning Styles: Concepts and Evidence." Reviewed 70+ studies; concluded no empirical evidence for the matching hypothesis. Reference for the `learning-adaptation` cluster's pedagogy-review flag. https://pmc.ncbi.nlm.nih.gov/articles/PMC5366351/
6. **Learning styles myth — 2024 meta-analysis.** "Is it really a neuromyth? A meta-analysis of the learning styles matching hypothesis." Effect size d = 0.04 across 21 studies; matching hypothesis supported in only 26% of measures. Confirms VARK / modality-based parameters are dead IP. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1428732/full
