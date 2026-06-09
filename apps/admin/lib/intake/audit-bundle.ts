// Audit bundle composer for the Phase 1 enrolment intake.
//
// Wraps @tallyseal/core's composeAuditBundle with HF-specific
// context binding (compliance manifest, current spec, derived Intent
// + chainProof from the session store).

import {
  composeAuditBundle,
  customEventKind,
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

/**
 * #1340 (epic #1338 Slice 1) — Tallyseal event-kind brand for
 * FailureLog rows piping into the audit-bundle hash chain.
 *
 * Per the Tallyseal reply on #1340 (2026-06-08): no allowlist needed;
 * the `customEventKind` brand satisfies the `EventKind` discriminated
 * union, passes through `appendEvent` unchanged, hashes correctly via
 * `computeContentHash`, and `isSystemEventKind(kind)` returns `false`
 * so any future dispatcher routes to a host-side projection registry.
 *
 * Exported so the Slice 2 PrismaEventStore writer can attach the brand
 * when an intake-side FailureLog (INTAKE_SCHEMA_FAIL) needs to land in
 * the bundle's event sequence. Slice 1 wires the brand but defers the
 * call-site to Slice 2 (intake still uses the in-memory IntakeSession
 * Map — see `lib/intake/session-store.ts`).
 */
export const FAILURE_LOG_EVENT_KIND = customEventKind("FailureLog");

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
