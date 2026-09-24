-- #2031 — S3c: Postgres CHECK constraint on Parameter.domainGroup
-- (Final structural backstop for the multi-pillar Lattice discipline.)
--
-- The canonical 12-tuple lives at:
--   apps/admin/lib/registry/canonical-domain-group.ts
--     `CANONICAL_DOMAIN_GROUPS`
--
-- This migration is the **Pillar 4 (Guards / DB-level)** backstop
-- documented in `.claude/rules/db-registry-parity.md`. The other
-- pillars in the worked-example matrix are now all in place:
--
--   Pillar 1 (Coverage source)  → #1948 tests/lib/registry/parameter-
--                                  domain-group-taxonomy.test.ts
--   Pillar 2 (Coverage DB)      → #2040 (S7) tests/lib/registry/
--                                  parameter-domain-group-db-parity.test.ts
--   Pillar 3 (Guards write-time)→ #2034 (S1) eslint-rules/
--                                  no-bare-parameter-write.mjs
--   Pillar 4 (Guards DB)        → THIS migration (S3c, #2031)
--   Pillar 7 (Rules)            → #2041 (S8) .claude/rules/
--                                  db-registry-parity.md
--
-- Audit chain (chronological):
--   1. PR #2036 (audit-block) discovered 46% / 70% off-canonical drift
--      on hf_sandbox / hf_staging — JSON source clean, DB silently
--      drifted via runtime writes that predated the canonical helper.
--   2. S3a (PR #2044, ADR docs/decisions/2026-06-19-parameter-domain-
--      group-mapping.md) ratified the canonical mapping for the 29
--      distinct off-canonical values observed in the audit.
--   3. S3b (#2039, migration 20260619150000_2039_s3b_domain_group_
--      data_migration) applied the ratified mapping to all live rows
--      across Groups A-E (Groups A+B mechanical, Group C ratified
--      single-row clusters, Group D learner-model populate, Group E
--      deprecate-and-bucket for SYSTEM/CONFIG rows).
--   4. #2248 closed the remaining bypass write surfaces that were
--      able to re-introduce drift after #2034 landed.
--   5. Normalisation pass (this session, today) cleared 7 stale rows
--      that survived the migration cadence — both DBs now at 0
--      off-canonical.
--   6. THIS migration (S3c) locks the gate: any future write of an
--      off-canonical value fails at the DB layer.
--
-- Pre-migration verification (this session, today — both DBs CLEAN):
--   - hf_sandbox  : 336 rows, 0 off-canonical (verified via direct
--                   Prisma query against canonical 12-tuple)
--   - hf_staging  : 206 rows, 0 off-canonical (verified via direct
--                   Prisma query against canonical 12-tuple)
--   - Combined    : 0 off-canonical rows → CHECK constraint applies
--                   cleanly with zero violations.
--
-- Idempotency: the constraint is named (`Parameter_domainGroup_check`)
-- so re-running this migration would fail at `ADD CONSTRAINT` with a
-- duplicate-name error — Prisma's `migrate deploy` will not re-apply
-- a migration whose entry is in `_prisma_migrations` already, so
-- this is the desired shape.
--
-- The CHECK admits NULL deliberately. `Parameter.domainGroup` is a
-- non-nullable `String` column today (schema.prisma:232), so the
-- `OR IS NULL` clause is structurally inert on the current schema —
-- but it documents the contract that future nullability changes
-- (should they ever happen) do not need to refuse legitimate
-- absent values. CHECK constraints in PostgreSQL evaluate to
-- "satisfied" when the predicate is NULL, so the OR clause is
-- belt-and-braces for the constraint's intent rather than for
-- today's behaviour.
--
-- Sibling-writer survey (Lattice MANDATORY per .claude/rules/
-- lattice-survey.md):
--   - DB column mutation: YES — adds a structural constraint to
--     `Parameter.domainGroup`. The 4 risk shapes:
--       * Sibling-writer drift   → addressed by canonical helper
--                                   `resolveCanonicalDomainGroup()`
--                                   (#2029, #2030) + ESLint
--                                   `hf-spec/no-bare-parameter-write`
--                                   (#2034 S1). Every write site now
--                                   routes through the canonical set.
--       * Default-deny gates     → THIS constraint IS the default-deny.
--       * Cascade respect        → N/A — `domainGroup` is presentation
--                                   metadata per PARAMETER-TAXONOMY.md
--                                   "Customer override boundary"; it is
--                                   NOT cascadable.
--       * Convention conflict    → N/A — single canonical 12-tuple at
--                                   `lib/registry/canonical-domain-group.ts`.
--                                   No competing conventions.
--   - Chain-stage boundary: NO — Parameter is a registry table; this
--     constraint operates within the registry layer only.
--   - New guard/contract: YES (structural). Documented in
--     `.claude/rules/db-registry-parity.md` Pillar 4.
--   - AI write/read path: NO.
--   - Cascade-eligible knob: NO.
--
-- Rollback: if a partner integration legitimately needs to write a
-- 13th canonical group in an emergency, the explicit rollback is:
--
--     ALTER TABLE "Parameter" DROP CONSTRAINT "Parameter_domainGroup_check";
--
-- (i.e. a separate migration that drops this CHECK). DO NOT extend
-- the canonical 12-tuple by hand — that's a curation decision
-- documented in PARAMETER-TAXONOMY.md, NOT a CHECK-expansion decision.
-- The canonical-helper at `lib/registry/canonical-domain-group.ts` is
-- the single source of truth; expand IT first, then rewrite this
-- migration's set, then re-create the constraint.
--
-- Deploy command: `/vm-cpp` (migration needed).

ALTER TABLE "Parameter"
ADD CONSTRAINT "Parameter_domainGroup_check"
CHECK (
  "domainGroup" IN (
    'behavior-core',
    'learning-adaptation',
    'curriculum-adaptation',
    'personality-adaptation',
    'supervision',
    'companion',
    'engagement',
    'reinforcement',
    'onboarding',
    'voice-delivery',
    'learner-model',
    'affect-motivation'
  )
  OR "domainGroup" IS NULL
);
