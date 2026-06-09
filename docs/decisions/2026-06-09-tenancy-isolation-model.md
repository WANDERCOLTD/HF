# ADR: Multi-tenant isolation model — shared database with row-level security

**Date:** 2026-06-09
**Status:** Proposed
**Deciders:** Paul W

## Context

HF is to become a "proper cloud multi-tenant app" that a serious professional business
runs — data safe, system stable. Today it is effectively single-tenant: one Cloud SQL
Postgres database per environment (dev / test / prod), `requireAuth` role-gating but no
tenant boundary. The isolation model is the one **irreversible** decision in the hardening
program — you cannot retrofit a tenant boundary cleanly once two customers' rows share a
table — so it is recorded here before anything keys off it.

This decision is **pre-emptive**: there is no signed multi-tenant customer yet (the drivers
are unmaintainable-cruft, data-safety, and wanting the right foundation). It must be settled
before the first real tenant is onboarded, not before the codebase is mapped.

Evidence from the capture phase (`docs/kb/generated/`):

- **`model-map.json`** — of 105 models, ~89 are proposed tenant-scoped, 8 global/platform,
  8 join tables, and only **1** already carries a tenant-ish FK. The tenant-scoping surface
  is large but mechanical.
- **`route-inventory.json`** — of 501 API routes, ~130 are flagged `possiblyUnscoped`
  (accept a `callerId` param with no scope helper) and ~80 have no detected auth gate.
  This is the #977-class leak surface (a STUDENT reading a foreign caller via `?callerId=`)
  generalised to a cross-tenant risk.

Options considered:

1. **Shared DB, shared schema, `tenantId` column + Postgres Row-Level Security (RLS).**
   Cheapest ops; one schema, one migration stream. RLS makes isolation a *database*
   guarantee, not an application convention — a forgotten `WHERE tenantId = …` physically
   cannot leak across tenants.
2. **Shared DB, schema-per-tenant.** Middle ground; heavier migration fan-out (one per
   schema), awkward cross-tenant platform queries.
3. **Database-per-tenant.** Strongest isolation; heaviest ops (N databases, N migration
   runs, connection routing, backup sprawl). Justified only for enterprise customers with
   contractual data-residency / isolation requirements.

## Decision

Adopt **Option 1 — shared database, shared schema, `tenantId` column enforced by Postgres
RLS** as the default isolation model. Reserve **Option 3 (DB-per-tenant)** as an explicit
escape hatch for future enterprise customers, behind the same connection-routing seam the
app already uses for per-environment `DATABASE_URL` binding (`/db-route`, `/db-switch`).

Mechanics:

- Add `tenantId` to every model classified tenant-scoped in `model-map.json` (ratify each
  row first — `reviewed:true`). Global/platform and join tables are handled per their class.
- Resolve the active tenant in middleware and set a Postgres session variable
  (`SET app.tenant_id`); RLS policies key off it.
- Turn RLS on in **log-only / permissive mode first** — it surfaces every query that *would*
  leak (feeding the `possiblyUnscoped` worklist) before it starts blocking.
- Promote "no tenant-scoped query without a tenant predicate" to a class-**a** invariant
  (`docs/kb/invariants.md`) backed by an RLS policy + a fitness-function test
  (`docs/kb/guard-registry.md`).

## Consequences

**Positive:**
- Isolation is a DB guarantee, not an app convention — the safety net survives any
  application bug or future refactor.
- One schema and one migration stream — no per-tenant fan-out for the common case.
- RLS log-only mode gives a concrete, measurable migration path (a ratchet: drive
  `possiblyUnscoped` to zero).
- The existing per-env `DATABASE_URL` routing seam extends cleanly to DB-per-tenant whales.

**Negative / costs:**
- Every tenant-scoped query depends on the session variable being set — middleware
  correctness is load-bearing (mitigated by RLS default-deny).
- `tenantId` backfill across ~89 models is a large, careful migration (data-safety gated;
  needs `migration-checker` as a hard CI gate first).
- Noisy-neighbour and per-tenant backup/restore are weaker than DB-per-tenant — acceptable
  for SMB, hence the enterprise escape hatch.

**Follow-ups:**
- Ratify `model-map.json` (classify all 105 models; flip `reviewed:true`).
- ADR for tenant resolution (subdomain vs. header vs. JWT claim) — separate one-way door.
- Wire `migration-checker` as a blocking CI gate before the first `tenantId` migration.
