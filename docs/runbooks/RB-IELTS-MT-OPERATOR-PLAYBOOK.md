# RB-IELTS-MT-OPERATOR-PLAYBOOK — Operator runbook for the IELTS Market Test

> Operator-facing checklist for the IELTS Speaking Practice market-test
> window (~20–100 supervised prospects). Covers the manual verification
> gates that mitigate the producer-only client-side module-unlock
> render shipped in #2318 until the full server-side enforcement
> lands via #2320.

## When this runbook applies

You're driving the IELTS market test (MT) — emailing modular practice
URLs (Baseline / Part 1 / Part 2 / Part 3 / Mock) to prospects and
supervising their sessions. Every prospect runs through Baseline →
Part 1 / Part 2 / Part 3 (in any order) → Mock, in that progression.

## The unlock invariant

```
baseline   ← entry gate (no prereqs)
part1/2/3  ← requires 1× COMPLETED baseline
mock       ← requires 1× baseline + 2× part1 + 2× part3 COMPLETED
```

The FOH home page renders 🔒 + tooltip on locked modules, but the
SERVER does NOT enforce the gate during MT. A curious prospect could
deep-link `/sim?module=mock` and bypass the lock. Mitigation: you
verify completion counts via SQL BEFORE emailing the Mock URL.

## Pre-Mock-URL checklist

Before emailing a prospect their Mock URL, run this SQL against the
DB the MT is pointed at (typically `hf_staging` → `dev.humanfirstfoundation.com`):

```sql
SELECT
  m.module_id,
  COUNT(*) FILTER (WHERE cmp.status = 'COMPLETED') AS completed_count
FROM (VALUES ('baseline'), ('part1'), ('part3')) AS m(module_id)
LEFT JOIN "CallerModuleProgress" cmp
  ON cmp."moduleSlug" = m.module_id
 AND cmp."callerId" = '<PROSPECT_CALLER_ID>'
GROUP BY m.module_id;
```

Replace `<PROSPECT_CALLER_ID>` with the prospect's `Caller.id` UUID.

Expected output:

| module_id | completed_count |
|---|---|
| baseline | ≥ 1 |
| part1 | ≥ 2 |
| part3 | ≥ 2 |

If any row is below the threshold, do NOT email the Mock URL. Send
the appropriate Part 1 or Part 3 practice URL instead so the prospect
can complete the remaining attempts. The FOH home page's 🔒 +
tooltip will explain the gap to the prospect when they next visit.

## How to find the prospect's `Caller.id`

Two paths:

1. **Email-based** — `SELECT id FROM "Caller" WHERE "email" = '<prospect@example.com>';`
2. **Session-based** — find a recent Session in `dev.humanfirstfoundation.com`
   admin under `/x/student/progress` and copy the `callerId` from the URL.

## Auth flow during MT

Per the live demo binding:

- `dev.humanfirstfoundation.com` → `hf_staging` DB
- Operator login: `admin@test.com` / `admin123` (one of 5 SUPERADMINs)
- Prospect login: their email-magic-link or their pre-provisioned PIN
  flow (check the cohort assignment under `/x/cohorts/[id]`)

## The deferred Lattice cluster (#2320)

This runbook closes the MT-essential gap. Production-scale rollout
REQUIRES the deferred server-side enforcement to ship:

- `app/api/callers/[callerId]/calls/route.ts` POST gate returns 403
  on unmet prereqs
- `lib/curriculum/check-module-unlock.ts:208-220` fix counts only
  `status === "COMPLETED"` rows (the resolver's pre-existing
  `callCount` over-count bug is OUT OF SCOPE for MT)
- ESLint chokepoint blocks `createSession` without `isModuleUnlocked`
- Coverage gate vitest pins both directions of the pairing

Until #2320 lands, this runbook is the structural mitigation.

## Related

- [`docs/CHAIN-CONTRACTS.md#link-l10`](../CHAIN-CONTRACTS.md) — the architectural contract row
- [`.claude/rules/module-unlock-gate.md`](../../.claude/rules/module-unlock-gate.md) — the pattern + bypass semantics
- [`apps/admin/lib/curriculum/check-module-unlock.ts`](../../apps/admin/lib/curriculum/check-module-unlock.ts) — the canonical resolver
- [`apps/admin/prisma/seed-ielts-course.ts`](../../apps/admin/prisma/seed-ielts-course.ts) — IELTS prereq data declaration
- [`apps/foh/app/page.tsx`](../../apps/foh/app/page.tsx) — MT-essential FOH lock UI
- Story [#2318](https://github.com/WANDERCOLTD/HF/issues/2318) — this runbook + the FOH render
- Follow-on [#2320](https://github.com/WANDERCOLTD/HF/issues/2320) — server-side enforcement
