// NextAuth session → tallyseal TenantCtx mapping.
//
// The enrolment intake is a LEARNER-FACING surface — most callers are
// unauthenticated. For authenticated callers (admin testing the flow),
// we resolve TenantCtx from the session. For anonymous learners we
// mint a synthetic anonymous actor scoped by the chat session ID.
//
// Phase 1 tenancy model: single tenant per HF Institution. The
// session.user.institutionId is the tallyseal TenantId. Anonymous
// learners get the default institution.

import { auth } from "@/lib/auth";
import type {
  TenantCtx,
  Tenant,
  Actor,
  TenantId,
  ActorId,
  Region,
} from "../tallyseal";

// HF Cloud Run region — matches lib/intake/compliance.ts residency.
const HF_REGION = "europe-west2" as Region;

const DEFAULT_TENANT_ID = "hf-default" as TenantId;

/**
 * Resolve TenantCtx from the active NextAuth session, or null if no
 * session exists. Use this when the action requires an authenticated
 * actor (e.g. admin sign-off on enrolment).
 */
export async function getAuthenticatedTenantCtx(): Promise<TenantCtx | null> {
  const session = await auth();
  if (!session?.user) return null;
  return buildTenantCtx(session.user);
}

/**
 * Resolve TenantCtx from the active session OR mint a synthetic
 * anonymous actor identified by the chat session ID. Use this for the
 * learner-facing enrolment route where most callers are unauthenticated.
 *
 * The synthetic actor records `kind: 'human'` — it IS a human, we just
 * don't know which one yet (the enrolment IS the identity-establishing
 * event). The chatSessionId persists across the conversation so all
 * events from one intake intent share an actor.
 */
export async function resolveTenantCtx(chatSessionId: string): Promise<TenantCtx> {
  const session = await auth();
  if (session?.user) return buildTenantCtx(session.user);
  return {
    tenant: { id: DEFAULT_TENANT_ID, region: HF_REGION },
    actor: {
      id: `intake-anon-${chatSessionId}` as ActorId,
      kind: "human",
    },
  };
}

function buildTenantCtx(user: SessionUser): TenantCtx {
  const tenant: Tenant = {
    id: ((user.institutionId ?? DEFAULT_TENANT_ID) as TenantId),
    region: HF_REGION,
  };
  const actor: Actor = {
    id: user.id as ActorId,
    kind: "human",
    displayName: user.name ?? user.email ?? undefined,
  };
  return { tenant, actor };
}

interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly institutionId: string | null;
}
