# Runbook RB-1117 — LO Ref Migration (Deploy Precondition)

**Owner:** operator (you) · **Created:** 2026-06-05 · **Source PRs:** #1123 #1125 #1127 #1134 · **Issue:** [#1117](https://github.com/WANDERCOLTD/HF/issues/1117)

## Why this runbook exists

#1117 shipped universal per-LO mastery scoring across every Curriculum-anchored course. Two of the four defence layers are RUNTIME — they reject bad LO refs at the write boundary. The other two are AUTHORING — the AI prompt + parser produce good refs going forward, and the publish gate hard-blocks bad ones from shipping.

But **existing rows on prod / staging may already carry placeholder `LO\d+` refs** that pre-date the gate. Those rows pass the gate (it only runs at *publish* time), but they trip the runtime guard silently: per-LO mastery is rejected, qualification rollups stay at zero, and the dashboard sits at "Not yet assessed" forever even after real calls.

This runbook is a **deploy precondition** — run it on prod and staging before the first deploy that includes any of PRs #1123 / #1125 / #1127 / #1134.

## The precondition check (~30s)

```sql
SELECT
  c.slug   AS curriculum,
  m.slug   AS module,
  lo.ref,
  LEFT(lo.description, 60) AS description
FROM "LearningObjective" lo
JOIN "CurriculumModule" m ON m.id = lo."moduleId"
JOIN "Curriculum"        c ON c.id = m."curriculumId"
WHERE lo.ref ~ '^LO[0-9]+$'
ORDER BY c.slug, m."sortOrder", lo."sortOrder";
```

### Result interpretation

| Result | Verdict |
|---|---|
| **Zero rows** | Deploy proceeds. No action needed. |
| **N > 0 rows** | Apply the rename SQL below BEFORE the deploy ships, OR confirm the orphan-safety check passes (next section) and re-seed instead. |

## The rename SQL (when rows are present)

The pattern: rebrand the placeholder `LOn` to `{moduleSlug}-LO{n}` so the ref is globally unique AND no longer trips the placeholder guard. The Slice-A sandbox used a per-Standard scheme (`STD-{unit}-{lo}`); the general form below is safer because it doesn't assume the moduleSlug carries an extractable identifier.

```sql
-- Idempotent — safe to re-run; matches only refs that still look like LOn.
UPDATE "LearningObjective" lo
SET ref = m.slug || '-' || lo.ref
FROM "CurriculumModule" m
WHERE lo."moduleId" = m.id
  AND lo.ref ~ '^LO[0-9]+$';
```

Verify the rename produced what you expect:

```sql
SELECT c.slug, m.slug, lo.ref
FROM "LearningObjective" lo
JOIN "CurriculumModule" m ON m.id = lo."moduleId"
JOIN "Curriculum"        c ON c.id = m."curriculumId"
WHERE lo.ref LIKE '%-LO%'   -- sanity: refs now carry the module prefix
ORDER BY c.slug, m."sortOrder", lo."sortOrder"
LIMIT 30;
```

## Orphan-safety check (do BEFORE running the rename)

If any `CallerAttribute lo_mastery:*` rows already reference the old refs, the rename leaves them orphaned (the readiness-rollup reader keys on the catalog refs; orphans won't drain into the new keys). Check first:

```sql
-- Count lo_mastery:* rows that reference placeholder refs across ALL learners.
SELECT COUNT(*) AS orphan_risk_rows
FROM "CallerAttribute"
WHERE scope = 'CURRICULUM'
  AND key ~ ':lo_mastery:[^:]+:LO[0-9]+$';
```

| Result | Verdict |
|---|---|
| **Zero rows** | Rename is non-destructive — proceed. |
| **N > 0 rows** | Real learner mastery exists against the placeholder refs. Use the #614 drain pattern (`scripts/migrate-caller-attribute-lo-mastery-keys.ts`) BEFORE the rename. Soft-delete via `validUntil`; the live readers continue to honour both forms during the grace window. |

The drain pattern was built for exactly this class of migration during the #611 / #614 dual-key incident — re-use it rather than inventing a new one.

## Why not just "let the gate catch it"

The publish gate (`POST /api/playbooks/:id/publish` rule 7) only fires when an operator re-publishes a Playbook. Existing PUBLISHED Playbooks with bad refs don't re-validate themselves. So the gate is forward-looking; it doesn't migrate historical data.

Without this runbook, the failure mode on prod is:
- Real learner takes a call on (e.g.) the CIO/CTO Standard
- AGGREGATE runs the universal LO scoring (Path 2.5 — #1125)
- AI returns `outcomes: { LO1: 0.7, LO2: 0.5, ... }`
- `validateLoScores` at write boundary (#1127) rejects every key
- Zero `lo_mastery:*` writes
- Qualification dashboard stays at "Ready to start" forever

Silent failure. No exception, no alert, no AppLog entry beyond a single console.warn. The dashboard looks intentional ("learner hasn't started yet"). Found this exact symptom on Emma Richardson's sandbox call during #1117 smoke test.

## Apply order (per environment)

For each of: **staging** → **prod**

1. `gcloud sql connect ...` (or your usual psql path to the env's DB)
2. Run the **precondition check** SQL.
3. If 0 rows → done; deploy.
4. If N > 0 rows → run the **orphan-safety check** SQL.
5. If 0 orphan rows → run the **rename SQL**, verify with the post-rename sanity SQL, then deploy.
6. If N > 0 orphan rows → run the #614 drain script first, wait until `callerAttributeOldKeyFormCount` audit counter reaches 0, THEN rename.

## After deploy

Once on the new code:
- Re-publish any Playbook whose Curriculum had renamed refs (UI: `Publish` button on the DRAFT version after `Unpublish → DRAFT` toggle). This re-runs rule 7 and persists `validationPassed: true` + the green checkmark on the admin UI.
- Spot-check a real learner call on the affected course: SQL probe `SELECT key, "numberValue" FROM "CallerAttribute" WHERE "callerId" = '<id>' AND key LIKE 'curriculum:%lo_mastery:%' ORDER BY "updatedAt" DESC LIMIT 5;` should now show writes against the new ref form (e.g. `standard-unit-04-it-operations-infrastructure-LO1`, not `LO1`).

## Sandbox status as of 2026-06-05

Sandbox DB (`hf_sandbox` on hf-dev VM) — **already renamed** during the #1117 smoke test. Standard's refs are now `STD-{unit}-{lo}` (not the general `{moduleSlug}-LO{n}` form documented above, because the sandbox used a hand-crafted regex to extract the unit number — a one-off cosmetic choice). Functionally equivalent; both pass the gate and run cleanly.

## Discoverability hooks

- Linked from `docs/CLOUD-DEPLOYMENT.md` "Pre-Deploy Preconditions" section.
- Linked from `apps/admin/docs/mastery-store-migration.md` (sibling drain doc for #611 / #614 — pattern reused here).
- Memory pointer in `prod-launch-checklist.md` → "Defaults to flip / migrations to run".
