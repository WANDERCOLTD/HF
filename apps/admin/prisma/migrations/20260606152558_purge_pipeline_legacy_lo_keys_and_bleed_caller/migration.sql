-- Batch 2 / Step 2 — purge the pipeline's hardcoded curriculum:* lo: keys
-- and the cross-playbook bleed-evidence caller.
--
-- Two cleanups, both safe given the explicit operator decision (2026-06-06)
-- that live caller data is disposable while courses must be perfect:
--
-- (a) DELETE every CallerAttribute keyed `curriculum:*:lo:*`.
--     These rows were written by app/api/calls/[callId]/pipeline/route.ts:3097
--     (legacy shape, pre-batch-2). The code change in this PR rekeys that
--     writer to `playbook:{playbookId}:lo:{loRef}` so no new legacy keys are
--     produced. The matching READER (composed-prompt assembly) was already
--     reading via the new playbook: prefix (no reader change in this PR).
--
--     NOTE: this does NOT touch `curriculum:*:lo_mastery:*` keys written by
--     the contract-driven track-progress.ts writer — that contract rekey is
--     its own piece of work, queued as Epic #1177 Slice 3 proper.
--
-- (b) DELETE caller `4413a1f8-c91f-4577-b801-1e7e7e98697a` (the cross-playbook
--     FK-leak evidence — 5 CallerModuleProgress rows + 6 Call rows referencing
--     modules in a curriculum belonging to a different playbook than the
--     caller's active enrolment). Cascades clean via Caller's onDelete:
--     Cascade relations. Confirms zero-leak baseline post-Slice 3.
--
-- Both operations are idempotent at this level — re-running this migration
-- after it has applied is a no-op (rows already deleted).

-- (a) Purge the legacy pipeline lo: keys.
DELETE FROM "CallerAttribute"
WHERE key LIKE 'curriculum:%:lo:%';

-- (b) Purge the bleed-evidence caller (cascades to all child rows).
DELETE FROM "Caller"
WHERE id = '4413a1f8-c91f-4577-b801-1e7e7e98697a';
