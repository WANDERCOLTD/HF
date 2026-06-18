# Parameter De-duplication Decisions — #1949 (epic #1946 S1)

> Audit + dedup decisions for the canonical-spec curation. Each duplicate cluster identifies the **canonical winner** (the parameter that survives), the **losers** (rows marked `deprecatedAt`, with their ids written into the winner's `aliases[]`), and any `BehaviorTarget` rows migrated by the accompanying SQL migration.

**Pedagogy review required before merge** of the migration PR. This document is the artefact pedagogy signs off on.

## Methodology

1. Grouped registry entries by root concept using qmd + jq lexical clustering.
2. Identified clusters with 2+ canonical-form-overlapping parameters.
3. For each cluster, picked the canonical winner using:
   - **Naming convention** — BEH-* kebab preferred (the newest, post-#1948 convention)
   - **Domain group fit** — winner sits in the cluster the operator would expect
   - **Existing consumer coverage** — prefer the param that runtime code already reads
4. Other cluster members become aliases on the winner's row.

## Dedup decisions

### Cluster: Warmth (3 → 1)

| Role | parameterId | domainGroup | Reason |
|---|---|---|---|
| **Winner** | `BEH-WARMTH` | engagement | Kebab convention; reaches `targets.ts` consumer |
| Loser | `warmth_actual` | behavior-core (was `style`) | `*_actual` measurement sibling; folded as alias |
| Loser | `BEH-CONVERSATIONAL-TONE` | engagement | Conceptual overlap with warmth; tone IS warmth-expression |

### Cluster: Pace (4 → 1)

| Role | parameterId | domainGroup | Reason |
|---|---|---|---|
| **Winner** | `BEH-PACE-MATCH` | companion | Kebab convention; "match the learner's pace" is the canonical adaptive read |
| Loser | `CONV_PACE` | engagement | Legacy hybrid-case sibling |
| Loser | `adapt_to_pace_preference` | learning-adaptation | Conceptually identical |
| Loser | `pace_indicators` | learning-adaptation | Pre-#1948 measurement sibling |
| Loser | `pacing_actual` | behavior-core (was `style`) | `*_actual` measurement sibling |

### Cluster: Formality (2 → 1)

| Role | parameterId | domainGroup | Reason |
|---|---|---|---|
| **Winner** | `BEH-FORMALITY` | personality-adaptation | Kebab convention; existing consumer |
| Loser | `formality-level` | learning-adaptation (was `learning`) | Snake-hybrid sibling |
| Loser | `formality_actual` | behavior-core (was `style`) | `*_actual` measurement sibling |

### Cluster: Directness (2 → 1)

| Role | parameterId | domainGroup | Reason |
|---|---|---|---|
| **Winner** | `BEH-DIRECTNESS` | personality-adaptation | Kebab convention |
| Loser | `directness_actual` | behavior-core (was `style`) | `*_actual` measurement sibling |

### Cluster: Empathy (3 → 1)

| Role | parameterId | domainGroup | Reason |
|---|---|---|---|
| **Winner** | `BEH-EMPATHY-RATE` | companion | Kebab convention |
| Loser | `empathy_expression` | behavior-core (was `style`) | Expression IS rate-of-expression |
| Loser | `response_empathy_score` | supervision | Measurement sibling; folded as alias |

### VARK / Learning Styles (4 deprecations — per pedagogy review of PR #1959)

These four parameters are based on the VARK / learning-styles matching hypothesis, which has no empirical support (Pashler 2008; 2024 meta-analysis d = 0.04). Deprecated without canonical replacement — they're dead IP. See [`docs/PARAMETER-TAXONOMY.md`](./PARAMETER-TAXONOMY.md) "Note on learning styles" for the framework rationale + research citations.

| parameterId | domainGroup | Disposition |
|---|---|---|
| `adapt_to_learning_style` | learning-adaptation | Deprecated; no canonical replacement |
| `auditory_adaptation` | learning-adaptation | Deprecated; no canonical replacement |
| `kinesthetic_adaptation` | learning-adaptation | Deprecated; no canonical replacement |
| `visual_adaptation` | learning-adaptation | Deprecated; no canonical replacement |

Existing `BehaviorTarget` rows on these four are nulled-out by the migration (no winner to re-point to). Pedagogy follow-on #1966 retires the VARK UI surface.

## Summary

- **5 clusters consolidated** (warmth + pace + formality + directness + empathy)
- **11 losers re-pointed** to 5 winners (2+4+2+1+2)
- **4 VARK deprecations** with no replacement
- **Total parameters deprecated: 15**

Post-migration parameter count: **154 − 15 = 139 active** (the 15 deprecated rows remain in the table with `deprecatedAt` set, for audit + alias resolution).

## Migration sequencing

1. Re-key all `BehaviorTarget.parameterId` rows that point to a loser → winner via single `UPDATE` per cluster, inside a `$transaction`. Pre-flight check: confirm no unique-constraint collision on winner's existing rows; if collision, take MAX value (same convention as multi-identity caller merge).
2. UPDATE Parameter SET deprecatedAt = NOW(), aliases = aliases || ARRAY[loserId] FOR EACH loser
3. Emit `parameter.deprecation.migrated` AppLog rows: `{ fromId, toId, behaviorTargetRowsUpdated, scope }`
4. The 4 VARK params get `deprecatedAt` set without any target re-pointing (their existing BehaviorTarget rows are dropped via `UPDATE effectiveUntil = NOW()`).

## Verification

- `loadAdjustableParameters` already filters `deprecatedAt: null` (per the foundation PR commit) — deprecated params no longer reach the Tune sidebar
- `getEffectiveBehaviorTargetsForCaller` follows aliases AND filters deprecation (same foundation PR)
- `parameter-coverage.test.ts` ratchet drops 18 from the producer-only gap count (those rows are now correctly classified as deprecated)
