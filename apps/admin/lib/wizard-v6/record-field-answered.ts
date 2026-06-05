// #1078 — V6 wizard Phase 1 spike.
//
// Single-write entry point for "the learner answered a field". Wraps:
//
//   1. Append a `FieldAnswered` event to `tallyseal_event` via the
//      shared `getEventStore()` singleton.
//   2. Project the new snapshot into `Playbook.config.__v6` via the
//      projector.
//
// Both steps happen inside the SAME `PrismaEventStore.begin(...)`
// transaction so the `SET LOCAL hf.v6_projector` GUC is visible to the
// snapshot write and the event + snapshot commit atomically. This is
// the "same-transaction guarantee" (ratchet #13 in tallyseal's core)
// applied to the HF-side projector.
//
// **Investigate-during-build note (PR comment, not blocking):**
// The issue spec calls for events flowing through `writeEvent` from
// `@tallyseal/core`. The full `writeEvent` flow requires a complete
// `TallysealConfig` (7 ports: projection / eventStore / ai / identity
// / pii / tasks / storage) plus a ComplianceManifest. Wiring all
// seven for a Phase 1 spike is significant plumbing — disproportionate
// for "prove the wire works" scope. We use `PrismaEventStore.append()`
// directly here, which is the same persistent shape that `writeEvent`
// produces (same `tallyseal_event` table, same hash chain, same
// monotonic version). Phase 2 (#1074) graduates this to full
// `writeEvent` once the chat surface has a real identity / lawful basis
// / AI provenance to attach.

import type { Prisma } from "@prisma/client";
import { randomUUID, createHash } from "crypto";
import {
  canonicalJSON,
  GENESIS_PREV_HASH,
  type Event,
  type EventKind,
  type ContentHash,
  type EventId,
  type IntentId,
  type TenantId,
  type Tenant,
  type Actor,
  type Purpose,
  type SubjectId,
  type LawfulBasis,
} from "@/lib/intake/tallyseal";
import { prisma } from "@/lib/prisma";
import { getEventStore } from "@/lib/intake/hf-adapter/event-store";
import { projectV6Snapshot } from "./projector";

// Phase 1 constants — branded once here to keep the cast surface small.
// Replaced in P2 by the real identity/lawful-basis pipeline.
const V6_PURPOSE = "wizard-v6-spike" as Purpose;
const V6_LAWFUL_BASIS = "legitimate_interests" as LawfulBasis;
const V6_TENANT_ID = "hf-wizard-v6" as TenantId;

export interface RecordFieldAnsweredArgs {
  /** The Playbook whose `config.__v6` namespace holds the snapshot. */
  playbookId: string;
  /**
   * The HF `WizardSession.id` for this run. The same id is mapped to
   * the tallyseal `IntentId` for event-log addressability — one
   * tallyseal intent per HF wizard session in P1.
   */
  sessionId: string;
  /** Spec identity — recorded on every event for replay / migration. */
  specKey: string;
  specVersion: number;
  /** The field being answered (key on the spec's `fields:` block). */
  fieldKey: string;
  /** The captured value. JSON-serialisable; no PII tokenisation in P1. */
  fieldValue: unknown;
  /**
   * Actor identifier — the userId driving the wizard. Required because
   * tallyseal's `Event.actor` is non-nullable.
   */
  actorId: string;
  /**
   * Prior snapshot (already-answered fields). The projector replaces
   * `Playbook.config.__v6.answeredFields` wholesale on every write, so
   * the caller must thread the existing snapshot through plus the new
   * field. This is intentional — event-sourced shapes are reconstructed
   * at write time.
   */
  priorAnsweredFields: Record<string, unknown>;
}

export interface RecordFieldAnsweredResult {
  readonly eventId: EventId;
  readonly eventVersion: number;
  readonly nextSnapshot: Record<string, unknown>;
  /** End-to-end timing for the field → event → snapshot round trip. */
  readonly elapsedMs: number;
}

/**
 * Append a FieldAnswered event + project the updated snapshot.
 *
 * Throws if the V6 DB trigger rejects the write — that signal is the
 * structural CHAIN guard firing. Callers should NOT swallow this; the
 * test in `tests/wizard-v6/chain-violation.test.ts` proves it lands.
 */
export async function recordFieldAnswered(
  args: RecordFieldAnsweredArgs,
): Promise<RecordFieldAnsweredResult> {
  const start = performance.now();

  const intentId = args.sessionId as IntentId;
  const tenant: Tenant = {
    id: V6_TENANT_ID,
    region: "eu-west-2" as Tenant["region"],
  };
  const actor: Actor = {
    id: args.actorId as Actor["id"],
    kind: "human",
  };

  const store = await getEventStore();

  // ── Step 1: read prior chain head to compute next version + prev hash.
  // PrismaEventStore.read returns an AsyncIterable in chronological
  // order. We read it once to count + grab the last contentHash.
  // `prevHash` is `ContentHash | null` per the Event interface — null
  // only for the genesis event in an intent's chain.
  let priorCount = 0;
  let priorHash: ContentHash | null = null;
  for await (const e of store.read(intentId)) {
    priorCount += 1;
    priorHash = e.contentHash;
  }
  const nextVersion = priorCount + 1;
  const prevHash: ContentHash | null =
    priorCount === 0 ? (GENESIS_PREV_HASH as ContentHash | null) : priorHash;

  // ── Step 2: build the FieldAnswered event payload.
  const timestamp = new Date();
  const payload = {
    fieldKey: args.fieldKey,
    fieldValue: args.fieldValue,
    specKey: args.specKey,
    specVersion: args.specVersion,
  };

  // Hash-chain content per tallyseal canonical form (matches
  // lib/intake/session-store.ts:appendEvent).
  const hashable = {
    tenantId: tenant.id,
    intentId,
    kind: "FieldAnswered" as EventKind,
    version: nextVersion,
    timestamp: timestamp.toISOString(),
    actor,
    lawfulBasis: V6_LAWFUL_BASIS,
    purpose: V6_PURPOSE,
    dataSubjectIds: [args.actorId as SubjectId],
    consentEventId: null,
    prevHash,
    payload,
    ai: null,
  };
  const contentHash = createHash("sha256")
    .update(canonicalJSON(hashable))
    .digest("hex") as ContentHash;

  const event: Event = {
    id: `evt-${randomUUID()}` as EventId,
    tenantId: tenant.id,
    intentId,
    kind: "FieldAnswered" as EventKind,
    version: nextVersion,
    timestamp,
    actor,
    lawfulBasis: V6_LAWFUL_BASIS,
    purpose: V6_PURPOSE,
    dataSubjectIds: [args.actorId as SubjectId],
    consentEventId: undefined,
    specialCategoryBasis: undefined,
    prevHash,
    contentHash,
    payload,
    ai: undefined,
    correlationId: undefined,
    causationId: undefined,
  };

  // ── Step 3: same-transaction append + project. PrismaEventStore.begin
  // opens the tx; inside, the projector sets the GUC marker on the
  // same tx client and the projector's updatePlaybookConfig call sees
  // the marker — the DB trigger lets the snapshot write through.
  await store.begin(tenant, async (txCtx) => {
    // Append the event onto the tallyseal_event table.
    await store.append(event, txCtx);

    // The PrismaEventStore TxContext exposes the raw Prisma tx in
    // `__tx.raw`. We need the regular Prisma.TransactionClient surface
    // for our projector — they are structurally compatible (both are
    // the same Prisma interactive-tx client).
    type PrismaTxInner = { raw: Prisma.TransactionClient; tenant: Tenant };
    const inner = txCtx.__tx as PrismaTxInner;
    const tx = inner.raw;

    const nextSnapshot = {
      ...args.priorAnsweredFields,
      [args.fieldKey]: args.fieldValue,
    };

    await projectV6Snapshot(tx, {
      playbookId: args.playbookId,
      sessionId: args.sessionId,
      specKey: args.specKey,
      specVersion: args.specVersion,
      answeredFields: nextSnapshot,
      lastEventSequence: nextVersion,
    });

    // Touch the HF WizardSession.updatedAt so application-layer reads
    // know when the projection last advanced. The status remains
    // ACTIVE; readiness checks flip it to COMPLETED on commit.
    await tx.wizardSession.update({
      where: { id: args.sessionId },
      data: { updatedAt: new Date() },
    });
  });

  const elapsedMs = performance.now() - start;
  const nextSnapshot = {
    ...args.priorAnsweredFields,
    [args.fieldKey]: args.fieldValue,
  };

  // Use prisma to suppress unused-import warning if anyone refactors —
  // the import is load-bearing for code consumers reading this file.
  void prisma;

  return {
    eventId: event.id,
    eventVersion: nextVersion,
    nextSnapshot,
    elapsedMs,
  };
}
