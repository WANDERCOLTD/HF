# 2031 S3 — Parameter.domainGroup CHECK constraint pre-migration audit

> **Verdict:** BLOCK. The DB CHECK constraint planned by epic #2031 cannot
> land until off-canonical rows are normalised on `hf_sandbox` AND
> `hf_staging`. This audit reports the distinct values + counts so the
> follow-on data-migration story can author the UPDATE statements with
> pedagogy-led mappings.

## Context

Story #2031 S3 plans an `ALTER TABLE "Parameter" ADD CONSTRAINT
"parameter_domain_group_canonical" CHECK ("domainGroup" IN (...))` against
the canonical 12-tuple at `apps/admin/lib/registry/canonical-domain-group.ts`:

```
behavior-core | learning-adaptation | curriculum-adaptation
personality-adaptation | supervision | companion
engagement | reinforcement | onboarding
voice-delivery | learner-model | affect-motivation
```

Per `.claude/rules/migration-checker.md`-style discipline + CLAUDE.md
"MANDATORY: Use qmd", a pre-migration audit ran against both live DBs
(hf-dev VM, sandbox + staging Cloud SQL).

## Audit query

```sql
SELECT "domainGroup", COUNT(*) AS n,
       CASE WHEN "domainGroup" IN (<canonical 12>)
            THEN 'canonical'
            ELSE 'OFF-CANONICAL'
       END AS status
FROM "Parameter"
GROUP BY 1
ORDER BY status DESC, 1;
```

Executed via:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap \
  --command='URL=$(gcloud secrets versions access latest \
    --secret=DATABASE_URL_SANDBOX --project=hf-admin-prod \
    | sed "s/?.*$//"); psql "$URL" -c "..."'
```

(Staging same shape, `--secret=DATABASE_URL_STAGING`.)

## Findings — hf_sandbox

**Total Parameter rows: 211 — 115 canonical (54%) / 96 OFF-CANONICAL (46%) across 19 distinct off-canonical values.**

### Canonical (9 values, 115 rows)

| domainGroup | n |
|---|---|
| behavior-core | 6 |
| companion | 17 |
| curriculum-adaptation | 12 |
| engagement | 11 |
| learning-adaptation | 31 |
| onboarding | 5 |
| personality-adaptation | 14 |
| reinforcement | 6 |
| supervision | 13 |

### OFF-CANONICAL (19 values, 96 rows)

| domainGroup | n |
|---|---|
| coaching | 5 |
| coaching-adaptation | 1 |
| comprehension | 7 |
| comprehension-adaptation | 1 |
| curriculum_adaptation (underscore) | 20 |
| discussion | 5 |
| discussion-adaptation | 1 |
| goal-tracking | 1 |
| modality_adaptation | 16 |
| pedagogy | 2 |
| pipeline | 1 |
| profile_adaptation | 3 |
| retention | 1 |
| skill | 25 |
| skill-assessment | 1 |
| system | 2 |
| tolerance | 1 |
| voice | 2 |
| wizard | 1 |

## Findings — hf_staging

**Total Parameter rows: 206 — 61 canonical (30%) / 145 OFF-CANONICAL (70%) across 28 distinct off-canonical values.**

### Canonical (8 values, 61 rows)

| domainGroup | n |
|---|---|
| companion | 15 |
| curriculum-adaptation | 5 |
| engagement | 8 |
| learning-adaptation | 5 |
| onboarding | 5 |
| personality-adaptation | 5 |
| reinforcement | 5 |
| supervision | 13 |

Note: `behavior-core` (sandbox: 6) is absent on staging — staging was rebuilt
2026-06-18 from a different seed snapshot per MEMORY.md.

### OFF-CANONICAL (28 values, 145 rows)

| domainGroup | n |
|---|---|
| coaching | 5 |
| coaching-adaptation | 1 |
| companion-behavior | 2 |
| comprehension | 7 |
| comprehension-adaptation | 1 |
| curriculum | 7 |
| curriculum_adaptation (underscore) | 20 |
| discussion | 5 |
| discussion-adaptation | 1 |
| engagement_adaptation (underscore) | 3 |
| feedback_adaptation | 1 |
| goal-tracking | 1 |
| interaction_adaptation | 4 |
| learning | 16 |
| learning_adaptation (underscore) | 4 |
| modality_adaptation | 16 |
| pacing_adaptation | 2 |
| pedagogy | 2 |
| personality | 9 |
| pipeline | 1 |
| profile_adaptation | 3 |
| retention | 1 |
| skill | 21 |
| style | 6 |
| system | 2 |
| tolerance | 1 |
| voice | 2 |
| wizard | 1 |

## Classification of off-canonical values

| Shape | Examples | Likely normalisation |
|---|---|---|
| Underscore form of canonical | `curriculum_adaptation`, `engagement_adaptation`, `learning_adaptation`, `modality_adaptation`, `pacing_adaptation`, `profile_adaptation`, `feedback_adaptation`, `interaction_adaptation` | s/_/-/ then map to nearest canonical |
| Truncated form of canonical | `curriculum`, `learning`, `personality` | append `-adaptation` |
| Plausible legacy synonyms | `coaching`, `coaching-adaptation`, `comprehension`, `discussion`, `style`, `companion-behavior` | needs pedagogy review |
| Off-axis labels (engine internals) | `pipeline`, `system`, `wizard`, `tolerance`, `voice` | needs pedagogy review — likely re-bucket to `behavior-core` or `voice-delivery` |
| Domain-specific labels | `skill`, `skill-assessment`, `goal-tracking`, `retention`, `pedagogy`, `modality_adaptation` | needs pedagogy review |

## Why this PR does NOT land the CHECK constraint

Per `.claude/rules/verify-before-fix.md` + brief instructions for the
audit-failed case:

> **If pre-migration audit fails (off-canonical rows on live DB):**
> 1. Report what you found (distinct values + counts).
> 2. Author the data migration to normalise them OR file a follow-on story.
> 3. Do NOT land the CHECK constraint until non-canonical data is cleared.

A naive `s/_/-/` + truncation-extension mapping would cover ~70/96 sandbox
rows and ~90/145 staging rows mechanically, but the remaining categories
(`coaching`, `discussion`, `pedagogy`, `pipeline`, `skill`, `style`, etc.)
require **pedagogy-led bucketing** — they could plausibly map to any of
`behavior-core`, `learning-adaptation`, `curriculum-adaptation`,
`personality-adaptation`, `engagement`, or `companion`. Picking the wrong
bucket silently mis-tunes the BehaviorTarget cascade fan-out at
SYSTEM/DOMAIN level.

## Recommended follow-on chain

1. **#2031 S3a (new story)** — pedagogy-led normalisation mapping. Output:
   a single Markdown table mapping each off-canonical value → canonical
   target, signed off by curriculum/pedagogy owner. ~28 rows.
2. **#2031 S3b (new story)** — author the data migration applying the
   mapping. Update sandbox + staging via Prisma migration. Includes
   `UPDATE "Parameter" SET "domainGroup" = <canonical> WHERE
   "domainGroup" = <off-canonical>` per row. Re-run audit after; expect
   0 off-canonical rows.
3. **#2031 S3c (this PR's planned work)** — author the CHECK constraint
   migration. Pre-merge: re-run this audit, expect green. Then ship.

Existing S1 (PR #2034, ESLint `no-bare-parameter-write`) + S5 (PR #2033,
canonical scaleType/directionality helpers) are already merged and close
the runtime hole on the write side from today forward. The DB CHECK
constraint is the retrospective defensive sweep.

## Verified by

- Audit query result above (live data, 2026-06-19, both DBs)
- Canonical taxonomy: `apps/admin/lib/registry/canonical-domain-group.ts::CANONICAL_DOMAIN_GROUPS`
- Pinned by: `apps/admin/tests/lib/registry/parameter-domain-group-taxonomy.test.ts`
- Related rule: `.claude/rules/parameter-measurement-coverage.md`
- Related rule: `.claude/rules/spec-readonly-boundary.md`
- Related rule: `.claude/rules/lattice-survey.md` — pre-coding survey discipline
- Audit-block precedent: brief explicitly cites `.claude/rules/migration-checker.md`-style discipline + `.claude/rules/verify-before-fix.md`
