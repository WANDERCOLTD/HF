-- #2304 — Drop 4 stale IELTS skill BehaviorTarget rows left over from the
-- pre-#2138 rename. The canonical IELTS skill parameter ids are now the
-- suffixed `_fc/_lr/_gra/_p` shapes (per the #2138 rename); the four
-- un-suffixed shapes below are stale rows from the wizard projection
-- regression closed by this PR:
--
--   skill_fluency_and_coherence            (canonical: skill_fluency_and_coherence_fc)
--   skill_lexical_resource                  (canonical: skill_lexical_resource_lr)
--   skill_grammatical_range_and_accuracy    (canonical: skill_grammatical_range_and_accuracy_gra)
--   skill_pronunciation                     (canonical: skill_pronunciation_p)
--
-- Live evidence (hf_sandbox, 2026-06-23):
--   IELTS Speaking Practice playbook had 8 skill BehaviorTargets where
--   the operator authored 4. The 4 new (canonical, targetValue=0.5)
--   coexisted with 4 OLD (un-suffixed, targetValue=0.65). All 4 stale
--   rows came from `apps/admin/lib/wizard/project-course-reference.ts::
--   skillNameToParameterName()` slugifying display names to the
--   un-suffixed form. This PR fixes the wizard write path; the
--   migration removes the historical rows that pre-date the fix.
--
-- TL confirmed by grep that no runtime code under `lib/**` / `app/**`
-- references the un-suffixed ids — every current consumer of IELTS
-- skill mastery / scoring / cascade-lookup uses the `_fc/_lr/_gra/_p`
-- suffixed form. Dropping the rows is safe.
--
-- Sibling story: #2305 (stale IELTS skill CallerTargets — same
-- rename leftover on a different surface).
--
-- Operator verify after migrate deploy:
--
--   SELECT bt."parameterId", bt."targetValue", bt.scope
--   FROM "BehaviorTarget" bt
--   JOIN "Playbook" p ON p.id = bt."playbookId"
--   WHERE p.name = 'IELTS Speaking Practice'
--     AND bt."parameterId" LIKE 'skill_%';
--   -- Expected: 4 rows, all suffixed (_fc/_lr/_gra/_p), targetValue=0.5
--
-- This DELETE is global across all environments (sandbox / staging /
-- prod) — every environment carries the same stale-row class because
-- the wizard projection regression was course-agnostic. Any non-IELTS
-- course that happened to ship the same un-suffixed ids by name
-- collision will also lose those rows; the operator confirmed at
-- grooming that no such collision exists (no other course shipped
-- BehaviorTargets at these exact parameter ids).
--
-- Per .claude/rules/db-registry-parity.md, this is migration-time
-- cleanup of stale soft-FK rows; the canonical chokepoint (the wizard
-- fix in this PR) prevents resurrection. ESLint `no-bare-behavior-
-- target-write.mjs` (#2042) continues to gate runtime writes.

DELETE FROM "BehaviorTarget"
WHERE "parameterId" IN (
  'skill_fluency_and_coherence',
  'skill_lexical_resource',
  'skill_grammatical_range_and_accuracy',
  'skill_pronunciation'
);
