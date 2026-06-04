// HF ProjectionPort singleton for Phase 1 admin-bridge wiring.
//
// Binds @tallyseal/prisma-adapter's PrismaNoopProjection. The Phase 1
// admin-bridge router only calls projection.current() (for intent-kind
// scope filtering); apply() is never invoked. PrismaNoopProjection's
// current() returns null, so the bridge's scope filter denies all
// /intent/:id/* requests in Phase 1 by design — see Q-A B1/B2 in
// tallyseal docs/notebook/08-design-partner/
// hf-tkt-admin-bridge-1-phase1-qa-20260604.md.
//
// Phase 2 replaces this with a real ProjectionPort backed by the
// CRAWCUS primitives-10-14 Prisma models — depends on tallyseal
// TKT-PRISMA-ADAPTER-PRIMITIVES-10-14.
//
// Discipline: HF-concrete bindings live in hf-adapter/, NOT
// re-exported through lib/intake/tallyseal/ — see that facade's
// README ("thin re-export only").

import { PrismaNoopProjection } from "@tallyseal/prisma-adapter";

let projectionSingleton: PrismaNoopProjection | null = null;

export function getProjection(): PrismaNoopProjection {
  if (!projectionSingleton) {
    projectionSingleton = new PrismaNoopProjection();
  }
  return projectionSingleton;
}

/** Test-only: reset the singleton between fixtures. */
export function __resetProjectionForTests(): void {
  projectionSingleton = null;
}
