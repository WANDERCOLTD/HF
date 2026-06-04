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
import type { ProjectionPort } from "@tallyseal/core";
import type { Intent } from "@tallyseal/crawcus-spec";

let projectionSingleton: ProjectionPort<Intent> | null = null;

export function getProjection(): ProjectionPort<Intent> {
  if (!projectionSingleton) {
    // PrismaNoopProjection `implements ProjectionPort` (T defaults to
    // `unknown`). The bridge requires `ProjectionPort<Intent>`. The
    // cast is safe in Phase 1 because the bridge only calls
    // `current()`, which returns `null` regardless of T. Phase 2
    // replaces this with a real `ProjectionPort<Intent>` implementation
    // (depends on tallyseal TKT-PRISMA-ADAPTER-PRIMITIVES-10-14).
    projectionSingleton = new PrismaNoopProjection() as unknown as ProjectionPort<Intent>;
  }
  return projectionSingleton;
}

/** Test-only: reset the singleton between fixtures. */
export function __resetProjectionForTests(): void {
  projectionSingleton = null;
}
