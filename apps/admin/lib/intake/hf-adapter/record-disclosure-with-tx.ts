/**
 * record-disclosure-with-tx — forward-compat wrapper for Tallyseal Drop 1.
 *
 * Enforces CHAIN-CONTRACTS.md §6a I-PR1 (epic #1915 child #1919) —
 * intake-path disclosure writes become atomic with intake-state mutation
 * once both Tallyseal Drop 1 (Ask #2: `opts?: { tx?: PrismaTxLike }` on
 * `*Store.record()` / `markAcknowledged()`) AND Drop 2 / Ask #4
 * (`PrismaEventStore.writeEvent` adoption guidance) have landed.
 *
 * Today (pre-Drop-1):
 *   - `record(...)` passes through to `store.record(...)` best-effort
 *   - `markAcknowledged(...)` passes through to `store.markAcknowledged(...)` best-effort
 *   - `tx` argument is accepted for type-shape forward-compat but IGNORED
 *     until Tallyseal-side accepts it
 *
 * Post-Drop-1 (target 2026-06-25, drop-dead 2026-06-30):
 *   - Replace `store.record(payload)` with `store.record(payload, { tx })`
 *   - Replace `store.markAcknowledged(...)` with the tx-accepting variant
 *   - Atomicity is now enforced when callers pass `tx`
 *
 * Post-Drop-2 + Phase 1.5 (Ask #4 (a) docs land — late June / early July):
 *   - Bootstrap route wraps its intake-state mutation + this helper's
 *     call in a single `prisma.$transaction`, passing the tx to both
 *
 * Until then the I-PR1 invariant is documented as PENDING in
 * CHAIN-CONTRACTS.md §6a (PR #1938). The wrapper makes the future swap
 * a one-line change at the call site rather than a refactor.
 *
 * The wrapper deliberately preserves the existing best-effort semantics
 * — see `disclosure-store.ts` JSDoc + Q-BRIDGE-RECORDER-DURABILITY for
 * the "Postgres hiccup must not block a learner mid-intake" rationale.
 *
 * @see github.com/.../issues/1919 (this scaffold)
 * @see Tallyseal TKT-HF-DISCLOSURE-STORE-TX (Drop 1 ticket)
 * @see Tallyseal TKT-HF-PHASE-1-5-PRISMA-EVENT-STORE (Drop 2 ticket)
 */

import type { PrismaClient } from "@prisma/client";
import { getDisclosureStore } from "./disclosure-store";

/**
 * Prisma transaction client shape — matches the type yielded inside
 * `prisma.$transaction(async (tx) => ...)`. Kept structural rather
 * than importing the full `Prisma.TransactionClient` because the
 * exact type-name varies across Prisma versions and we only need
 * "something Prisma-tx-shaped" for forward-compat.
 */
export type PrismaTxLike = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface RecordDisclosureArgs {
  /** Synthetic `DisclosureId` from `deriveDisclosureId(intentId, requirementId)`. */
  id: string;
  /** Tallyseal tenant identifier. */
  tenantId: string;
  /** Data subject identifier (`intake-subject-{chatSessionId}`). */
  subject: string;
  /** Regulatory citation, e.g. `gdpr.art13.privacy-notice`. */
  requirementId: string;
  /** Resolved disclosure content shape from `loadDisclosureCopy`. */
  content: unknown;
  /** SHA-256 content hash of the canonical-JSON disclosure body. */
  contentHash: string;
  /** Timestamp the notice was shown to the subject. */
  deliveredAt: Date;
  /** Delivery method enum: in-app / email / sms / mail / api. */
  deliveryMethod: "in-app" | "email" | "sms" | "mail" | "api";
  /** Forward-compat: Prisma transaction client. IGNORED pre-Drop-1. */
  tx?: PrismaTxLike;
}

export interface MarkAcknowledgedArgs {
  tenantId: string;
  disclosureId: string;
  acknowledgedAt: Date;
  /** Forward-compat: Prisma transaction client. IGNORED pre-Drop-1. */
  tx?: PrismaTxLike;
}

/**
 * Record a disclosure delivery to `tallyseal_disclosure`.
 *
 * Best-effort by design: failure logs to console but does NOT throw.
 * The intake-path callers ARE expected to catch any rethrow if a future
 * Drop-1-aware caller chooses to escalate failures.
 *
 * The `tx` argument is accepted for forward-compat and IGNORED today.
 * When Tallyseal Drop 1 ships, change the inner call to pass `, { tx }`
 * — see file header.
 */
export async function recordDisclosure(args: RecordDisclosureArgs): Promise<void> {
  try {
    const store = await getDisclosureStore();
    // FORWARD-COMPAT MARKER: when Tallyseal Drop 1 lands, change to
    //   await store.record({ ... } as never, args.tx ? { tx: args.tx } : undefined);
    await store.record({
      id: args.id,
      tenantId: args.tenantId,
      subject: args.subject,
      requirementId: args.requirementId,
      content: args.content,
      contentHash: args.contentHash,
      deliveredAt: args.deliveredAt,
      deliveryMethod: args.deliveryMethod,
      acknowledgedAt: null,
      retractedAt: null,
    } as never);
  } catch (err) {
    console.error(
      "[intake] recordDisclosure best-effort write failed (continuing):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Stamp `tallyseal_disclosure.acknowledged_at` for the given disclosure.
 *
 * Best-effort by design (same rationale as `recordDisclosure`). The
 * `tx` argument is accepted for forward-compat and IGNORED today.
 */
export async function markDisclosureAcknowledged(
  args: MarkAcknowledgedArgs,
): Promise<void> {
  try {
    const store = await getDisclosureStore();
    // FORWARD-COMPAT MARKER: when Tallyseal Drop 1 lands, change to
    //   await store.markAcknowledged(args.tenantId, args.disclosureId, args.acknowledgedAt, args.tx ? { tx: args.tx } : undefined);
    await store.markAcknowledged(
      args.tenantId as never,
      args.disclosureId as never,
      args.acknowledgedAt as never,
    );
  } catch (err) {
    console.error(
      "[intake] markDisclosureAcknowledged best-effort write failed (continuing):",
      err instanceof Error ? err.message : err,
    );
  }
}

