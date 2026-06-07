-- B5 / audit-fix Track B: enforce unique phone numbers on Caller.
--
-- Today, a VAPI webhook delivered twice (retry, dedupe failure, bridge
-- restart) can land two `Caller` rows for the same phone number — the
-- handler resolves "caller from phone" via `findFirst({ phone })` and
-- happily creates a second row when the first one isn't found in the
-- read-after-write window. The concurrency audit listed this as a
-- medium-severity duplicate-learner-from-retried-webhook class.
--
-- This migration:
--   (1) De-duplicates by nulling out the phone on every row except the
--       oldest per `phone`. Keeps the rows themselves (they still hold
--       other state) but breaks the duplicate. Operator can then
--       manually merge if a real-person collapse is warranted.
--   (2) Adds a partial unique index `WHERE phone IS NOT NULL` so future
--       writes are blocked at the DB layer. Partial because Caller.phone
--       is nullable and many legitimate rows (web sign-ups) carry NULL.
--
-- Idempotent (IF NOT EXISTS). Safe on existing envs because the
-- CTE only nulls rows where a younger duplicate exists. Fresh envs see
-- zero rows and skip the WITH-cleanup; the partial unique index just
-- creates against an empty table.

-- (1) Null out every non-oldest duplicate per phone. ctid is used as
-- the unique row marker because (a) id is a uuid and ordering is by
-- createdAt + id for determinism, (b) ctid is system-supplied and
-- always available.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY phone
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Caller"
  WHERE phone IS NOT NULL
)
UPDATE "Caller" c
SET phone = NULL
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

-- (2) DB-level enforcement. Partial — NULLs continue to be valid.
CREATE UNIQUE INDEX IF NOT EXISTS "Caller_phone_unique_idx"
  ON "Caller" (phone)
  WHERE phone IS NOT NULL;
