-- #1951 — Add Parameter.skipInterpretationLengthCheck for the
-- interpretation-coverage ratchet's escape hatch.
--
-- Per epic #1946 S4: when an interpretation is legitimately short
-- (binary state, single-token axis label), operator marks the row
-- with this flag so the coverage ratchet doesn't fail on the length
-- check. The interpretation STILL must be non-null and meaningful —
-- the flag relaxes only the >=20-char rule.
--
-- Default false — every existing row gets the full ratchet
-- enforcement after backfill.

ALTER TABLE "Parameter"
ADD COLUMN "skipInterpretationLengthCheck" BOOLEAN NOT NULL DEFAULT false;
