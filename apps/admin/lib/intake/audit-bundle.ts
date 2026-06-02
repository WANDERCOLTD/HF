// Audit bundle composer for the Phase 1 enrolment intake.
//
// Wraps @tallyseal/core's composeAuditBundle with HF-specific
// context binding (compliance manifest, current spec, derived Intent
// + chainProof from the session store).

import {
  composeAuditBundle,
  type AuditBundle,
  type Disclosure,
  type Consent,
  type HumanOversight,
} from "./tallyseal";
import { compliance } from "./compliance";
import { EnrollmentIntake } from "./specs/enrollment.intent";
import {
  buildIntent,
  buildChainProof,
  getSession,
  type IntakeSession,
} from "./session-store";
import type { IntentId } from "./tallyseal";

interface ComposeOptions {
  readonly intentId: IntentId;
  readonly disclosures?: readonly Disclosure[];
  readonly consents?: readonly Consent[];
  readonly oversights?: readonly HumanOversight[];
  readonly generatedAt?: Date;
}

export class SessionNotFoundError extends Error {
  constructor(public readonly intentId: IntentId) {
    super(`No session found for intentId="${intentId}"`);
    this.name = "SessionNotFoundError";
  }
}

export function composeIntakeAuditBundle(opts: ComposeOptions): AuditBundle {
  const session = getSession(opts.intentId);
  if (!session) throw new SessionNotFoundError(opts.intentId);
  return buildBundleFromSession(session, opts);
}

/**
 * Test helper — bypass the session-store lookup when a test wants to
 * compose a bundle from a freshly-constructed in-memory session.
 */
export function composeBundleFromSession(
  session: IntakeSession,
  opts: Omit<ComposeOptions, "intentId">,
): AuditBundle {
  return buildBundleFromSession(session, opts);
}

function buildBundleFromSession(
  session: IntakeSession,
  opts: Pick<ComposeOptions, "disclosures" | "consents" | "oversights" | "generatedAt">,
): AuditBundle {
  return composeAuditBundle({
    tenant: session.tenant,
    intent: buildIntent(session),
    spec: EnrollmentIntake,
    compliance,
    events: session.events,
    chainProof: buildChainProof(session),
    disclosures: opts.disclosures ?? [],
    consents: opts.consents ?? [],
    oversights: opts.oversights ?? [],
    generatedAt: opts.generatedAt,
  });
}
