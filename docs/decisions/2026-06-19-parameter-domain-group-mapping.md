# `Parameter.domainGroup` off-canonical → canonical mapping (S3a)

**Date:** 2026-06-19
**Story:** [#2038](https://github.com/WANDERCOLTD/HF/issues/2038) (S3a of epic [#2031](https://github.com/WANDERCOLTD/HF/issues/2031))
**Audit:** [PR #2036](https://github.com/WANDERCOLTD/HF/pull/2036) (audit-block, OPEN until S3c lands)
**Taxonomy:** v1.0 — [`docs/PARAMETER-TAXONOMY.md`](../PARAMETER-TAXONOMY.md) + [`lib/registry/canonical-domain-group.ts`](../../apps/admin/lib/registry/canonical-domain-group.ts)
**Status:** Proposed — operator-pending rows block S3b

## Context

PR #2036 audited `Parameter.domainGroup` on both live DBs and found
significant off-canonical populations:

| DB | Rows | Canonical | Off-canonical | % drift |
|---|---|---|---|---|
| hf_sandbox | 211 | 115 | 96 | 46% |
| hf_staging | 206 | 61 | 145 | 70% |

29 distinct off-canonical values combined. The pre-#1948 distribution
(documented in `prisma/migrations/20260618130000_1948_domain_group_taxonomy/migration.sql`)
covers 12 of the 29; the remaining 17 are NEW drift that landed AFTER
the #1948 normalisation migration. hf_staging additionally shows that
the #1948 migration never reached it (every pre-#1948 legacy variant is
still present at its pre-migration count).

S3a's task is to author the per-row mapping that lets S3b apply the
clean-up safely. S3c (the planned CHECK constraint) cannot land until
the off-canonical population is zero.

## Source of truth: the canonical 12-tuple

```
behavior-core | learning-adaptation | curriculum-adaptation | personality-adaptation
supervision   | companion           | engagement            | reinforcement
onboarding    | voice-delivery      | learner-model         | affect-motivation
```

`voice-delivery`, `learner-model`, `affect-motivation` are explicit
**placeholder buckets** at v1.0 — populated by future curation passes.
This mapping intentionally populates `voice-delivery` (the two `voice`
prosody rows are the textbook population per #1952 / S5) and proposes
populating `learner-model` (the four learner-side skill clusters);
both shifts are flagged operator-pending below.

## Per-row mapping table

Counts are `sandbox / staging`. Sample row evidence was collected via
live psql probe on 2026-06-19 (verified data — sample `name` +
`definition` shown where confidence was below `mechanical`).

### Group A — Mechanical normalisation (HIGH confidence)

These match either an existing #1948 migration UPDATE clause OR are
underscore / kebab variants of a canonical name with row content that
clearly matches the canonical bucket's definition.

| Off-canonical | Count (sb/st) | → Canonical | Rationale |
|---|---|---|---|
| `curriculum_adaptation` | 20 / 20 | `curriculum-adaptation` | Underscore variant. All 17 sample rows are `BEH_*` tutor-curriculum knobs (SCAFFOLDING, INTERLEAVING, ADVANCE_READINESS, PRODUCTIVE_STRUGGLE, etc.) — textbook curriculum-adaptation per the taxonomy doc's Vygotsky/ZPD framing. |
| `learning_adaptation` | 0 / 4 | `learning-adaptation` | Underscore variant. Covered by #1948 migration UPDATE clause (never reached staging). |
| `learning` | 0 / 16 | `learning-adaptation` | Truncated legacy. Covered by #1948. |
| `interaction_adaptation` | 0 / 4 | `learning-adaptation` | Covered by #1948 (interaction = sub-axis of learning style). |
| `pacing_adaptation` | 0 / 2 | `learning-adaptation` | Covered by #1948 (pace = sub-axis of learning style). |
| `curriculum` | 0 / 7 | `curriculum-adaptation` | Truncated legacy. Covered by #1948. |
| `personality` | 0 / 9 | `personality-adaptation` | Truncated legacy. Covered by #1948. |
| `style` | 0 / 6 | `behavior-core` | Covered by #1948 (warmth/formality/directness are core behaviour, not a separate "style" axis; `*_actual` measured siblings of canonical `BEH-*`, some flagged for S1 dedup #1949). |
| `companion-behavior` | 0 / 2 | `companion` | Covered by #1948. |
| `engagement_adaptation` | 0 / 3 | `engagement` | Covered by #1948. |
| `feedback_adaptation` | 0 / 1 | `reinforcement` | Covered by #1948 (feedback IS reinforcement; the underscore-suffixed split was historical drift). |
| `retention` | 1 / 1 | `behavior-core` | Single row: `BEH_WARMTH` — "Returning after break - welcome back warmly". Mis-bucketed legacy of the canonical BEH_WARMTH row. Belongs alongside other warmth/style core-behaviour params. |

**Group A total: 12 distinct values → 75 rows reclassified (sandbox 21, staging 54).**

### Group B — Pedagogy-confirmed by row inspection (HIGH-MEDIUM confidence)

These are NEW off-canonical values that did not exist at #1948 migration
time. The mapping below is grounded in the sample row content
(name + definition) and the canonical taxonomy doc — but each is a
pedagogy-significant decision that an operator should approve before S3b.

| Off-canonical | Count (sb/st) | → Canonical | Rationale |
|---|---|---|---|
| `modality_adaptation` | 16 / 16 | `learning-adaptation` | All 16 rows are `BEH_*` tutor-modality knobs (CONVERSATIONAL_TONE, SPATIAL_METAPHOR, FEELING_LANGUAGE, ACTION_VERBS, IMAGERY_DENSITY, DIAGRAM_LANGUAGE, VERBAL_ELABORATION, etc.). Same VARK-axis lineage as the #1948-handled `interaction_adaptation` + `pacing_adaptation`. Flagged in `PARAMETER-TAXONOMY.md` as S1 dedup #1949 candidates (VARK lacks empirical support per Pashler 2008 + 2024 meta-analysis). |
| `profile_adaptation` | 3 / 3 | `learning-adaptation` | All 3 rows are `BEH_*` modality-meta knobs (MODALITY_VARIETY, APPROACH_SWITCHING, MODALITY_CONSISTENCY). Same VARK lineage as `modality_adaptation`. |
| `coaching-adaptation` | 1 / 1 | `curriculum-adaptation` | Single row: "Coaching Approach Adaptation — Adjusts coaching structure based on development scores." Tutor-side curriculum-decision rule (adjusts STRUCTURE based on scores) — matches `curriculum-adaptation`'s definition (depth/sequence/scaffolding adapted to mastery). |
| `comprehension-adaptation` | 1 / 1 | `curriculum-adaptation` | Single row: "Comprehension Scaffolding Adaptation — Adjusts scaffolding level based on PIRLS/KS2-aligned comprehension scores." Explicitly scaffolding adaptation = `curriculum-adaptation`. |
| `discussion-adaptation` | 1 / 1 | `curriculum-adaptation` | Single row: "Discussion Facilitation Adaptation — Adjusts facilitation approach based on discussion skill scores." Same shape — tutor-side adaptation rule driven by learner scores. (Defensible alternative: `engagement`, since discussion facilitation is engagement-adjacent. Lean curriculum-adaptation for consistency with the two siblings above.) |
| `voice` | 2 / 2 | `voice-delivery` | Both rows: `Prosody — Pace (WPM)` + `Prosody — Hesitation Rate`. Written by `lib/pipeline/prosody-consumer.ts`. These ARE the textbook population the v1.0 `voice-delivery` placeholder was reserved for — see `PARAMETER-TAXONOMY.md` §10 (S5 / #1952). **Flag:** S5 (#1952) tracking ticket has not yet populated voice-delivery via the planned promotion path; this mapping pre-empts that work by two rows. Acceptable per the placeholder's intent. |

**Group B total: 6 distinct values → 47 rows reclassified.**

### Group C — Operator-pending, narrow pedagogy decision (BLOCK S3b)

These rows have clear row content but the canonical destination is a
**pedagogy-significant** choice (specifically: which canonical bucket
absorbs the meta-orchestration vs. CallerTarget-anchored measurement
rows). Recommended mapping shown — operator should ratify before S3b.

| Off-canonical | Count (sb/st) | → Canonical (proposed) | Rationale + alternative |
|---|---|---|---|
| `skill-assessment` | 1 / 1 | `supervision` (proposed) | Single row: "Per-Skill EMA Aggregation — Folds every new `skill_*` CallScore into the matching CallerTarget.currentScore via time-decay EMA." This is an AGGREGATE-stage pipeline rule, not a tutor behaviour. `supervision` (meta-tutoring + monitoring per the taxonomy doc) is the closest fit. Alternative: a future `learner-model` (placeholder) population for aggregation rules ABOUT learner skills. Operator decides. |
| `goal-tracking` | 1 / 1 | `supervision` (proposed) | Single row: "Strategy Resolution Rules — Ordered list of {match, strategy} rules. First match wins…" This is a goal-strategy dispatch CONFIG, not a tutor behaviour. `supervision` fits (meta-orchestration). Alternative: this is arguably system-config and may not belong in `Parameter` at all (see Group E). |
| `tolerance` | 1 / 1 | `curriculum-adaptation` (proposed) | Single row: "Mastery Threshold (Tolerance) — Per-learner or per-playbook override for the LO mastery threshold used by the scheduler and module-completion gate." A threshold used to GATE curriculum decisions belongs in `curriculum-adaptation`. Alternative: `supervision` (it's a meta-gate). Lean curriculum-adaptation because the threshold's role is curriculum-sequencing, not monitoring. |

**Group C total: 3 distinct values → 6 rows reclassified.**

### Group D — Operator-pending, populates `learner-model` placeholder (BLOCK S3b)

These four clusters all share one shape: **LEARNER-SIDE skill descriptions**
(what the learner CAN DO), not tutor behaviours. They map cleanly onto
the `learner-model` canonical placeholder bucket — which v1.0 leaves
intentionally empty per `PARAMETER-TAXONOMY.md` §11. Populating it is
explicitly future curation work; this PR proposes that S3a is the
trigger for that work, but only with operator approval (the bucket
shifts from 0 → ~80 rows in one migration).

| Off-canonical | Count (sb/st) | → Canonical (proposed) | Sample row evidence |
|---|---|---|---|
| `skill` | 25 / 21 | `learner-model` (proposed) | IELTS speaking skills ("ability to speak at length…"), Big Five trait articulation, CIO commercial skills (sponsor clarity, vendor judgement, decision velocity), Cialdini-principle spotting. All are CallerTarget-tracked learner abilities. |
| `coaching` | 5 / 5 | `learner-model` (proposed) | goal_clarity, self_awareness, action_commitment, follow_through, "Coaching Competency Aggregation". All learner-side coachee competencies. |
| `comprehension` | 7 / 7 | `learner-model` (proposed) | inference_skill, vocabulary_in_context, retrieval_skill, language_appreciation, evaluation_skill, recall_accuracy, "Comprehension Competency Aggregation". PIRLS/KS2-aligned learner reading skills. |
| `discussion` | 5 / 5 | `learner-model` (proposed) | perspective_diversity, position_shift, reflection_quality, argument_quality, "Discussion Competency Aggregation". Learner-side discussion abilities. |

**Group D total: 4 distinct values → 80 rows reclassified.**

**Why operator-pending:** Per the taxonomy doc §11, `learner-model`'s
intentional emptiness at v1.0 was a curation decision — the doc notes
"a few sit in `learning-adaptation` (e.g. `aggregate_profile`,
`pace_indicators`) and would migrate here in a future curation pass."
S3a's Group D mapping IS that future curation pass; it's a meaningful
shift in the cluster shape (from "this bucket is reserved" to "this
bucket carries the largest single-cluster population at 80 rows"). The
operator should consciously accept this, and the staging counts confirm
the data exists on both DBs (so the population reflects real authored
content, not test-only drift).

**Defensible alternative:** keep these 80 rows in `learning-adaptation`
or `engagement` instead. Each alternative weakens the taxonomy's
intended separation between "what the learner KNOWS" (`learner-model`)
and "how the tutor BEHAVES" (the other 11 buckets) per the ITS
4-component standard the v1.0 taxonomy cites. Recommendation: populate
`learner-model` now (S3b) rather than defer.

### Group E — Operator-pending, structural decision (BLOCK S3b)

These rows describe SYSTEM / TOOL / CONFIG entries rather than tutor
behaviours. They appear to be `Parameter` rows that were created as a
storage convenience but don't fit the canonical taxonomy at all.

| Off-canonical | Count (sb/st) | → Canonical (proposed) | Rows |
|---|---|---|---|
| `pedagogy` | 2 / 2 | **OPERATOR DECISION** | "Activity Catalog — All available interaction activities with formats and triggers"; "Activity Selection Strategy — How the AI should choose which activities to use." |
| `pipeline` | 1 / 1 | **OPERATOR DECISION** | "Pipeline Stage Configuration — Defines the order and grouping of pipeline stages." |
| `system` | 2 / 2 | **OPERATOR DECISION** | "Domain Readiness Checks — Ordered list of checks to evaluate domain call-readiness"; "Launch Steps — Ordered steps for the Quick Launch flow." |
| `wizard` | 1 / 1 | **OPERATOR DECISION** | "Wizard Step Definitions — Defines the sequence and configuration of classroom setup wizard steps." |

**Group E total: 4 distinct values → 12 rows. Recommendation tracks
below.**

**Three possible paths — operator should pick one:**

1. **Deprecate** — these rows pre-date a clear `Parameter`/`SystemConfig`
   separation. Mark them deprecated (set `deprecatedAt`) and migrate
   their data to a more appropriate model (e.g. seeded JSON config,
   a separate `SystemConfig` table, or absorption into existing
   spec types like `LaunchSpec`). S3b would set `domainGroup` to a
   canonical bucket (`supervision` is the least-bad pure-housekeeping
   pick) AND mark them deprecated in the same migration.
2. **Extend the canonical taxonomy** — add a 13th bucket
   `system-config` (or similar) for non-pedagogy rows that live in
   `Parameter`. Requires a v1.1 taxonomy bump + epic-level decision per
   `PARAMETER-TAXONOMY.md` §"Naming convention".
3. **Force-bucket** — pick `supervision` for all 12 rows (least-worst
   pedagogy fit; supervision IS meta-orchestration). Cleanest for S3b
   but encodes "supervision is a junk drawer" semantics that the
   taxonomy doc explicitly avoids.

**Recommendation:** Path 1 (deprecate + force-bucket to `supervision`
in the same S3b migration). Lowest operational risk; preserves the
v1.0 taxonomy's pedagogy integrity; flags the 12 rows for proper
relocation in a follow-on epic. This recommendation is **not** binding
on S3a — operator chooses at S3b authoring time.

## Summary distribution

| Group | Distinct values | Rows reclassified | Confidence | Blocks S3b? |
|---|---|---|---|---|
| A — Mechanical | 12 | 75 | High (migration precedent / row inspection) | No |
| B — Pedagogy-confirmed | 6 | 47 | High-Medium (row evidence + taxonomy doc) | No |
| C — Narrow pedagogy decision | 3 | 6 | Medium (proposal shown; needs ratification) | **Yes** |
| D — Populates placeholder | 4 | 80 | High pedagogically; structural-shift decision | **Yes** |
| E — Structural decision | 4 | 12 | Low (path choice required) | **Yes** |
| **Total** | **29** | **220** | — | — |

The combined `220 reclassified rows` exceeds the audit totals (96 sandbox
+ 145 staging = 241) because some legacy variants appear on both DBs
(e.g. `curriculum_adaptation: 20/20` is one mapping decision affecting
40 rows). The 29 distinct-value count matches the audit's combined
unique set.

## Acceptance criteria for handing off to S3b (#2039)

S3b can begin authoring its migration script when ALL of the following
are true:

- [ ] Operator has ratified Group C (3 rows — `skill-assessment`,
  `goal-tracking`, `tolerance` destinations)
- [ ] Operator has ratified Group D (decision: populate `learner-model`
  vs. keep in `learning-adaptation` vs. distribute)
- [ ] Operator has chosen Group E path (deprecate vs. extend taxonomy
  vs. force-bucket)
- [ ] Groups A + B are accepted as documented (no objections in PR
  review)

S3b's migration script will then encode the agreed mapping as an
idempotent `UPDATE "Parameter" SET "domainGroup" = ...` per legacy
variant, mirroring the #1948 migration's shape. The script SHOULD be
applied to hf_staging first (it carries the larger legacy population),
then hf_sandbox. After re-running the PR #2036 audit query on both DBs
returns **0 off-canonical rows**, S3c (the CHECK constraint migration)
can finally land.

## Sibling-writer survey (Lattice mandatory)

Per `.claude/rules/lattice-survey.md`, before touching the
`Parameter.domainGroup` column:

- **Sibling writers identified:** S1 (#2034 ESLint
  `hf-spec/no-bare-parameter-write`) blocks runtime writes outside the
  canonical chokepoints (`prisma/seed*`, `lib/wizard/apply-projection.ts`,
  `app/api/admin/sync-parameters/`, `lib/registry/sync-canonical.ts`,
  scripts/generate-registry).
- **Runtime drift since #1948:** all NEW off-canonical values in this
  doc (Groups B–E) were authored via legitimate canonical-chokepoint
  paths that historically pre-date `resolveCanonicalDomainGroup()`'s
  enforcement (PR #2029 / #2030). The chokepoint reject-on-null
  contract now blocks new drift; the audit population is incumbent
  debt only.
- **Contract catalogues:** `PARAMETER-TAXONOMY.md` §"Customer override
  boundary" — operators cannot tune `domainGroup`; this column is
  HF-canonical presentation metadata, so the mapping decisions here
  don't risk cascade misalignment.
- **4 risk shapes cross-check:** only "convention conflict" applies
  (incumbent off-canonical values are pre-#1948 + post-#1948 drift, not
  active concurrent writes). No cascade or default-deny concerns; the
  mapping is a one-way data clean-up.

## Related

- Epic [#2031](https://github.com/WANDERCOLTD/HF/issues/2031) — chokepoint guards extension (CLOSED post-#2042)
- Story [#2038](https://github.com/WANDERCOLTD/HF/issues/2038) — this S3a slice
- Story [#2039](https://github.com/WANDERCOLTD/HF/issues/2039) — S3b data migration (blocked by this)
- Story [#2040](https://github.com/WANDERCOLTD/HF/issues/2040) — S7 DB↔JSON parity Coverage test
- Story [#2041](https://github.com/WANDERCOLTD/HF/issues/2041) — S8 rule file `db-registry-parity.md`
- PR [#2036](https://github.com/WANDERCOLTD/HF/pull/2036) — audit-block (stays OPEN until S3c lands)
- PR [#2034](https://github.com/WANDERCOLTD/HF/pull/2034) / [#2042](https://github.com/WANDERCOLTD/HF/pull/2042) — S1 + S2 runtime chokepoints
- Migration `20260618130000_1948_domain_group_taxonomy` — the original normalisation that didn't reach staging
- [`docs/PARAMETER-TAXONOMY.md`](../PARAMETER-TAXONOMY.md) v1.0 — canonical taxonomy
- [`apps/admin/lib/registry/canonical-domain-group.ts`](../../apps/admin/lib/registry/canonical-domain-group.ts) — runtime source of truth

## Verified by

- Live `psql` probe against `DATABASE_URL_SANDBOX` and
  `DATABASE_URL_STAGING` (Cloud SQL via hf-dev VM, 2026-06-19) — sample
  row content for all 18 distinct values not covered by #1948 migration.
  Probe script: `/tmp/probe-domain-group.sh` (ephemeral; the SELECT
  statement is reproduced in PR #2036's body).
- PR #2036's audit data — full distinct-value distribution table
  re-cited above in the Group A–E counts.
- Cross-reference against `prisma/migrations/20260618130000_1948_domain_group_taxonomy/migration.sql` — Group A mappings preserved verbatim.
- Cross-reference against `apps/admin/tests/lib/registry/parameter-domain-group-taxonomy.test.ts` `LEGACY_VARIANTS` array — Group A's 12 mappings overlap with the test's `LEGACY_VARIANTS` set; the Group B–E NEW values are not in that array (they post-date the #1948 migration).
