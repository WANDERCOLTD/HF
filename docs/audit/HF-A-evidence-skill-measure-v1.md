# HF-A — Live evidence for SKILL_MEASURE_V1 classification

Post-merge correction to commit `602e3ad` ("fix(skill): call
`ContractRegistry.getContract`, not nonexistent `.get()`"), which landed the HF-A
fix and classified the bug as **LATENT** ("no seeder for SKILL_MEASURE_V1 exists
anywhere — contract loads from `SystemSetting` JSON and is never written, so the
bug is LATENT today (defaults == correct behaviour) but a landmine the moment a
contract is seeded. DB confirmation pending (VM tunnel).")

## Query

Run on hf-dev VM against the bound database (canonical for that VM:
`hf_sandbox` via `DATABASE_URL_SANDBOX`):

```sql
SELECT key,
       value::jsonb -> 'thresholds'  AS thresholds,
       value::jsonb -> 'tierBands'   AS tier_bands,
       value::jsonb -> 'config'      AS config
FROM "SystemSetting"
WHERE key LIKE 'contract:%'
  AND value::jsonb ->> 'contractId' = 'SKILL_MEASURE_V1';
```

## Result (2026-06-11, hf_sandbox)

One row returned:

| key                       | thresholds                                              | tier_bands                                  | config (extracted) |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------- | ------------------ |
| contract:SKILL_MEASURE_V1 | `{secure: 1.0, emerging: 0.55, developing: 0.7, approachingEmerging: 0.3}` | `{secure: 7, emerging: 4, developing: 5.5, approachingEmerging: 3}` | `emaHalfLifeDays: 14`, `minCallsToFull: 4` |

The contract IS seeded on hf_sandbox with **tuned** values that diverge from the
hardcoded defaults in `lib/goals/track-progress.ts` and
`lib/pipeline/aggregate-runner.ts` (defaults: `thresholds.secure = 0.85`,
`tierBands.secure = 7`, `emaHalfLifeDays = 7`, `minCallsToFull = 3`).

## Reclassification: LATENT → **LIVE** (on hf_sandbox / hf-admin-dev)

Every call routed through hf_sandbox between the day SKILL_MEASURE_V1 was seeded
and `602e3ad` (the HF-A fix) was silently using the hardcoded defaults instead of
the tuned thresholds. Per MEMORY.md the canonical mapping during this window is:

> VM `localhost:3000` AND `dev.humanfirstfoundation.com` (Cloud Run `hf-admin-dev`)
> BOTH → **hf_sandbox** (`DATABASE_URL_SANDBOX`, v2 has A3 pool params).

So the bug was LIVE on the only DB the dev / sandbox cloud-run revisions read
from. The audit fix is therefore behaviour-changing on hf_sandbox, not merely a
pre-emptive landmine clearance.

**Other environments — not verified.** The query has not been run against
`hf_staging` or `hf_prod`. If those databases hold a row with `contractId =
'SKILL_MEASURE_V1'` carrying tuned values that diverge from the hardcoded
defaults, the bug was LIVE there too. If the contract is unseeded there, it
remains latent until first seeded. The conservative interpretation is to expect
LIVE on at least one production environment, since the seeding pattern on
hf_sandbox suggests an intentional tuning step rather than an accidental row.

## Implication for deploy

`602e3ad` is **not** a no-op against hf_sandbox: post-deploy, `getSkillTierMapping`
will start honouring the seeded `thresholds` + `tierBands`, and
`getEMAHalfLifeDays()` / `getMinCallsToFull()` will start honouring the seeded
`emaHalfLifeDays = 14` (vs default 7) and `minCallsToFull = 4` (vs default 3).
This means:

1. **Mastery progression slows by ~2×** — `emaHalfLifeDays` doubled means new
   evidence carries half the weight on the EMA, so tier promotions/demotions
   damp twice as slowly. The intent of the tuned value matters here; the doc
   string on the contract's `config.notes` block reads:

   > "14-day half-life for skill EMA […] suits IELTS-style learning where
   > improvement is gradual"

   so the slowdown is the intended behaviour for the IELTS playbooks on
   hf_sandbox, not a regression. But pre-fix learners had a faster EMA than the
   educator configured.

2. **Per-call contribution cap tightens** — `minCallsToFull = 4` (vs default 3)
   means a single high-scoring call gives an even smaller fraction of the path
   to Secure than before. Same direction as #1.

3. **Tier bands shift** — `secure` band threshold moves from 0.85 (default) to
   1.0 (seeded), so the bar for "Secure" tier rises. Previously some learners
   on hf_sandbox were being promoted to Secure on 0.85+; post-fix they need 1.0.

Operator should expect a one-off tier-distribution shift on the next pipeline
run after deploy; the shift is the system finally honouring the seeded contract.

## Why this matters for the audit

This is a **verify-before-fix** discipline note (see
`.claude/rules/verify-before-fix.md`). The HF-A commit's classification was a
plausible reading from grep alone (no seeder file → assumed unseeded
everywhere). One DB query disproved it for hf_sandbox. For the next audit, fold
this query into the HF-A loop earlier: a SystemSetting check should be a
standard step for any "contract X loaded but maybe never seeded" finding.

## Operator follow-up

Run the same query against `hf_staging` and `hf_prod` after the next deploy:

```bash
# hf-dev VM has psql access only to hf_sandbox (its bound DATABASE_URL).
# For hf_staging / hf_prod, either bind the VM via /db-switch (when /db-route is
# rebuilt — see MEMORY.md monday-plan-phase4-db-cutover.md) or run via Cloud SQL
# proxy from a workstation with the staging / prod role.
psql "$DATABASE_URL_STAGING" -c "$QUERY"
psql "$DATABASE_URL_PROD"    -c "$QUERY"
```

If both rows are absent: HF-A was latent on staging + prod, and the deploy is a
no-op there. If either row is present with tuned values: expect the same
one-off tier-distribution shift on that environment too.
