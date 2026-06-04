// Tallyseal DisclosureStorePort wiring against HF's existing PrismaClient.
//
// Pairs the in-memory `DisclosureDelivered` / `DisclosureAcknowledged` /
// `DisclosureSignal` events HF intake emits (session-store) with persisted
// rows in `tallyseal_disclosure` + `tallyseal_disclosure_signal`. The Q-CR9
// SIGNAL-not-gate canon is structurally enforced by the two-table split —
// `recordSignal()` writes only to `tallyseal_disclosure_signal`; it never
// touches `tallyseal_disclosure.acknowledged_at`.
//
// Failure semantics: typed-table writes are best-effort. Per Q2 founder
// guidance + Q-BRIDGE-RECORDER-DURABILITY, a Postgres hiccup must not
// block a learner mid-intake. Routes wrap calls in try/catch + console.error;
// the in-memory session-store remains the canonical record for the intake
// session duration.
//
// Discipline: HF-concrete bindings live in hf-adapter/, NOT re-exported
// through lib/intake/tallyseal/ (see that facade's README — thin re-export
// only).

import {
  PrismaDisclosureStore,
  type PrismaClientLike,
} from "@tallyseal/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { ensureMigrated } from "./event-store";

let singleton: PrismaDisclosureStore | null = null;

export async function getDisclosureStore(): Promise<PrismaDisclosureStore> {
  await ensureMigrated();
  if (!singleton) {
    singleton = new PrismaDisclosureStore(
      prisma as unknown as PrismaClientLike,
    );
  }
  return singleton;
}

/**
 * Deterministic synthetic `DisclosureId` from `(intentId, requirementId)`.
 *
 * Same algorithm is used by `bootstrap` (at `record()` time) +
 * `disclosure-acknowledge` (at `markAcknowledged()` time) +
 * `disclosure-signal` (at `recordSignal()` time) so all three call sites
 * agree on the row identity without needing to thread state through
 * session-values. Per-intent scoping prevents collisions between two
 * concurrent EnrollmentIntake intents emitting the same `requirementId`.
 */
export function deriveDisclosureId(
  intentId: string,
  requirementId: string,
): string {
  return `disc_${intentId}_${requirementId}`;
}

/** Test-only: reset the singleton between fixtures. */
export function __resetDisclosureStoreForTests(): void {
  singleton = null;
}
